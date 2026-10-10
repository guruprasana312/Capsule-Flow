// Capsule Flow — dashboard & settings
(function () {
  'use strict';
  const Store = CFStore, Fmt = CFFormat, P = CFPlatforms, I = CFIcons;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let prefs = { ...Store.DEFAULT_PREFS };
  let capsules = [], folders = [];
  const filt = { q: '', view: 'all', folder: '', platform: '', sort: 'updatedAt' };
  let selectedId = null;   // id of capsule in the detail pane
  let draft = null;        // working copy for the detail pane
  let dirty = false;
  let detailTab = 'context';

  // ─── helpers ────────────────────────────────────────────────
  function ago(iso) {
    if (!iso) return '';
    const d = Date.now() - new Date(iso).getTime();
    if (d < 60e3) return 'just now';
    if (d < 3600e3) return Math.floor(d / 60e3) + 'm ago';
    if (d < 86400e3) return Math.floor(d / 3600e3) + 'h ago';
    if (d < 7 * 86400e3) return Math.floor(d / 86400e3) + 'd ago';
    return new Date(iso).toLocaleDateString();
  }
  const fullDate = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

  let toastTimer;
  function toast(text, kind) {
    const t = $('toast');
    t.textContent = text;
    t.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, 2800);
  }

  function confirmBox(title, text, okLabel) {
    return new Promise((resolve) => {
      const wrap = $('modal');
      $('modal-body').innerHTML = `<h3>${esc(title)}</h3><p>${esc(text)}</p>
        <div class="btn-row"><button class="btn" data-r="0">Cancel</button><button class="btn danger solid" data-r="1">${esc(okLabel || 'Delete')}</button></div>`;
      wrap.hidden = false;
      const done = (v) => { wrap.hidden = true; document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') done(false); };
      document.addEventListener('keydown', onKey);
      wrap.onclick = (e) => { if (e.target === wrap) done(false); const b = e.target.closest('[data-r]'); if (b) done(b.dataset.r === '1'); };
      $('modal-body').querySelector('[data-r="1"]').focus();
    });
  }

  function download(name, text, type) {
    const blob = new Blob([text], { type: type || 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function slug(s) { return String(s || 'capsule').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'capsule'; }

  function toMarkdown(c) {
    const lines = ['# ' + c.title, ''];
    lines.push('- Source: ' + P.nameFor(c.platform) + (c.sourceUrl ? ' (' + c.sourceUrl + ')' : ''));
    lines.push('- Created: ' + fullDate(c.createdAt));
    if ((c.tags || []).length) lines.push('- Tags: ' + c.tags.map((t) => '#' + t).join(' '));
    lines.push('', '## Context', '', c.content, '');
    if ((c.messages || []).length) {
      lines.push('## Transcript', '');
      c.messages.forEach((m) => lines.push('**' + (m.role === 'user' ? 'User' : P.nameFor(c.platform)) + ':**', '', m.text, ''));
    }
    return lines.join('\n');
  }

  function paintIcons(rootEl) {
    (rootEl || document).querySelectorAll('[data-icon]').forEach((el) => {
      const svg = I[el.dataset.icon];
      if (svg && !el.querySelector('svg')) el.innerHTML = svg;
    });
  }

  // ─── routing ────────────────────────────────────────────────
  const VIEWS = ['capsules', 'folders', 'settings', 'data', 'help'];
  function route() {
    const h = decodeURIComponent(location.hash.slice(1));
    let view = 'capsules';
    if (VIEWS.includes(h)) view = h;
    if (h === 'welcome') $('welcome').hidden = false;
    if (h === 'new') newCapsule();
    if (h.startsWith('capsule=')) select(h.slice(8));
    VIEWS.forEach((v) => { $('view-' + v).hidden = v !== view; });
    document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.view === view));
  }

  // ─── data ───────────────────────────────────────────────────
  async function load() {
    [prefs, capsules, folders] = await Promise.all([Store.getPrefs(), Store.getCapsules(), Store.getFolders()]);
    document.documentElement.setAttribute('data-theme', prefs.theme || 'aurora');
    $('nav-count').textContent = capsules.length;
    renderFilters();
    renderList();
    renderFolders();
    renderSettings();
    // Refresh the detail pane unless the user has unsaved edits.
    if (selectedId && !dirty) {
      const c = capsules.find((x) => x.id === selectedId);
      if (c) { draft = JSON.parse(JSON.stringify(c)); renderDetail(); } else { selectedId = null; draft = null; renderDetail(); }
    } else if (!draft) renderDetail();
    try {
      const bytes = await chrome.storage.local.getBytesInUse(null);
      $('usage').textContent = (bytes / 1024).toFixed(bytes > 1024 * 100 ? 0 : 1) + ' KB used';
    } catch (_) {}
    if (!capsules.length && !localStorage.getItem('cf_welcome_dismissed')) $('welcome').hidden = false;
  }

  // ─── list ───────────────────────────────────────────────────
  function renderFilters() {
    const f = $('f-folder');
    f.innerHTML = '<option value="">All folders</option>' + folders.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
    f.value = folders.some((x) => x.id === filt.folder) ? filt.folder : '';
    filt.folder = f.value;
    const used = Array.from(new Set(capsules.map((c) => c.platform)));
    const pf = $('f-platform');
    pf.innerHTML = '<option value="">All sources</option>' + used.map((p) => `<option value="${esc(p)}">${esc(P.nameFor(p))}</option>`).join('');
    pf.value = used.includes(filt.platform) ? filt.platform : '';
    filt.platform = pf.value;
    $('f-sort').value = filt.sort;
  }

  function renderList() {
    document.querySelectorAll('#chips .chip').forEach((c) => c.classList.toggle('on', c.dataset.view === filt.view));
    const opts = { folderId: filt.folder || null, platform: filt.platform || null, sortBy: filt.sort };
    if (filt.view === 'starred') opts.starred = true;
    if (filt.view === 'recent') opts.sortBy = 'recent';
    const items = Store.search(capsules, filt.q, opts);
    const list = $('clist');
    if (!items.length) {
      list.innerHTML = `<div class="none">${capsules.length ? 'No capsules match these filters.' : 'No capsules yet. Capture a chat on any AI site, or click <b>New</b>.'}</div>`;
      return;
    }
    list.innerHTML = items.map((c) => `
      <button class="citem ${c.id === selectedId ? 'on' : ''}" data-id="${esc(c.id)}">
        <div class="t">${c.starred ? '<span class="star">★</span>' : ''}${esc(c.title)}</div>
        <div class="p">${esc(Fmt.clip(c.content, 160))}</div>
        <div class="m"><span class="dot" style="background:${P.colorFor(c.platform)}"></span>${esc(P.nameFor(c.platform))} · ${esc(ago(c.updatedAt))}${c.usageCount ? ' · used ' + c.usageCount + '×' : ''}
          ${(c.tags || []).slice(0, 3).map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}</div>
      </button>`).join('');
  }

  async function select(id) {
    if (id === selectedId && draft) return;
    if (dirty && !(await confirmBox('Discard changes?', 'You have unsaved edits to this capsule.', 'Discard'))) return;
    const c = capsules.find((x) => x.id === id) || (await Store.getCapsule(id));
    if (!c) return;
    selectedId = id;
    draft = JSON.parse(JSON.stringify(c));
    dirty = false;
    detailTab = 'context';
    renderList();
    renderDetail();
  }

  async function newCapsule() {
    if (dirty && !(await confirmBox('Discard changes?', 'You have unsaved edits to this capsule.', 'Discard'))) return;
    selectedId = null;
    draft = { id: null, title: '', content: '', tags: [], folderId: filt.folder || null, starred: false, platform: 'manual', messages: [], versions: [] };
    dirty = false;
    detailTab = 'context';
    renderList();
    renderDetail();
    setTimeout(() => {
      const t = document.querySelector('.title-input');
      const a = document.activeElement;
      if (t && (!a || a === document.body || !$('detail').contains(a))) t.focus();
    }, 30);
  }

  // ─── detail ─────────────────────────────────────────────────
  function setDirty(v) {
    dirty = v;
    const el = document.querySelector('.dirty-flag');
    if (el) { el.textContent = v ? 'Unsaved changes' : (draft && draft.id ? 'Saved ' + ago(draft.updatedAt) : ''); el.className = 'dirty-flag ' + (v ? 'dirty' : 'saved'); }
  }

  function renderDetail() {
    const d = $('detail');
    if (!draft) {
      d.innerHTML = `<div class="dempty"><div class="big">${I.capsule}</div><h3>Pick a capsule</h3>
        <p>Select one on the left to view, edit or export it — or create a new one.</p>
        <button class="btn primary" id="empty-new">${I.plus}New capsule</button></div>`;
      $('empty-new').onclick = newCapsule;
      return;
    }
    const isNew = !draft.id;
    const msgs = draft.messages || [];
    const vers = draft.versions || [];
    const folderOpts = '<option value="">No folder</option>' + folders.map((f) => `<option value="${esc(f.id)}" ${draft.folderId === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
    d.innerHTML = `
      <div class="dhead">
        <input class="title-input" maxlength="120" placeholder="Untitled capsule" value="${esc(draft.title)}">
        <button class="icon-btn ${draft.starred ? 'on' : ''}" data-act="star" title="${draft.starred ? 'Unstar' : 'Star'}">${draft.starred ? I.starFill : I.star}</button>
      </div>
      <div class="dmeta">
        <span><span class="dot" style="background:${P.colorFor(draft.platform)}"></span> ${esc(P.nameFor(draft.platform))}</span>
        ${isNew ? '<span>New capsule</span>' : `<span>Created ${esc(fullDate(draft.createdAt))}</span><span>Used ${draft.usageCount || 0}×</span>`}
        ${draft.sourceUrl ? `<a href="${esc(draft.sourceUrl)}" target="_blank" rel="noopener">Open source chat ↗</a>` : ''}
      </div>
      <div class="dfields">
        <div class="field"><label>Tags</label><input class="f-tags" value="${esc((draft.tags || []).join(', '))}" placeholder="comma, separated"></div>
        <div class="field"><label>Folder</label><select class="f-folder">${folderOpts}</select></div>
      </div>
      <div class="tabs">
        <button data-tab="context" class="${detailTab === 'context' ? 'on' : ''}">Context</button>
        ${msgs.length ? `<button data-tab="transcript" class="${detailTab === 'transcript' ? 'on' : ''}">Transcript<em>${msgs.length}</em></button>` : ''}
        ${msgs.length ? `<button data-tab="brief" class="${detailTab === 'brief' ? 'on' : ''}">Brief</button>` : ''}
        <button data-tab="prompt" class="${detailTab === 'prompt' ? 'on' : ''}" title="Exactly what gets pasted into the other AI">Prompt preview</button>
        ${vers.length ? `<button data-tab="history" class="${detailTab === 'history' ? 'on' : ''}">History<em>${vers.length}</em></button>` : ''}
      </div>
      <div class="tabbody">${tabBody()}</div>
      <div class="dfoot">
        <button class="btn primary" data-act="save">${I.capsule}${isNew ? 'Create capsule' : 'Save'}</button>
        <span class="dirty-flag"></span>
        <span class="spacer"></span>
        <button class="btn sm" data-act="copy" title="Copy with header, ready to paste">${I.copy}Copy</button>
        ${isNew ? '' : `<button class="btn sm" data-act="dup">${I.duplicate}Duplicate</button>
        <button class="btn sm" data-act="md">${I.download}.md</button>
        <button class="btn sm danger" data-act="delete">${I.trash}Delete</button>`}
      </div>`;
    setDirty(dirty);
  }

  function tabBody() {
    const msgs = draft.messages || [];
    if (detailTab === 'transcript' && msgs.length) {
      const bot = P.nameFor(draft.platform);
      return `<div class="scroll">${msgs.map((m) => `<div class="msg ${m.role}"><div class="who">${m.role === 'user' ? 'You' : esc(bot)}</div><div class="body">${esc(m.text)}</div></div>`).join('')}</div>`;
    }
    if (detailTab === 'brief' && msgs.length) {
      const b = Fmt.buildBrief(msgs);
      const li = (a) => (a.length ? '<ul>' + a.map((x) => `<li>${esc(x)}</li>`).join('') + '</ul>' : '<p class="muted">None detected.</p>');
      return `<div class="scroll">
        <p class="muted small">Generated locally from the ${msgs.length} captured messages. Rebuild the context from it in either format:</p>
        <div class="btn-row" style="margin-bottom:14px">
          <button class="btn sm" data-act="regen" data-format="brief">${I.refresh}Brief + recent messages</button>
          <button class="btn sm" data-act="regen" data-format="full">${I.refresh}Brief + full transcript</button>
        </div>
        <h4>Goal</h4><p>${esc(b.goal) || '<span class="muted">—</span>'}</p>
        <h4>Constraints &amp; preferences</h4>${li(b.constraints)}
        <h4>Key points</h4>${li(b.keyPoints)}
        ${b.lastUser ? `<h4>Where you left off</h4><p>${esc(b.lastUser)}</p>` : ''}
      </div>`;
    }
    if (detailTab === 'prompt') {
      const text = Fmt.forInjection(draft, prefs);
      return `<div class="scroll"><p class="muted small">This is exactly what Inject pastes into the other AI (${text.length.toLocaleString()} characters). Change the wording style under Settings → Injecting.</p><pre class="prompt-preview">${esc(text)}</pre></div>`;
    }
    if (detailTab === 'history' && (draft.versions || []).length) {
      return `<div class="scroll">${draft.versions.map((v, i) => `<div class="ver-item"><div class="vt"><b>${esc(v.title || draft.title)}</b> · <span class="muted small">${esc(fullDate(v.savedAt))}</span><div>${esc(Fmt.clip(v.content, 400))}</div></div>
        <button class="btn sm" data-act="restore" data-i="${i}">Restore</button></div>`).join('')}</div>`;
    }
    return `<textarea class="f-content" spellcheck="false" placeholder="Goals, constraints, background, decisions… anything you'd otherwise retype.">${esc(draft.content)}</textarea>`;
  }

  function readFields() {
    const d = $('detail');
    const t = d.querySelector('.title-input'); if (t) draft.title = t.value;
    const c = d.querySelector('.f-content'); if (c) draft.content = c.value;
    const tg = d.querySelector('.f-tags'); if (tg) draft.tags = Store.cleanTags(tg.value);
    const f = d.querySelector('.f-folder'); if (f) draft.folderId = f.value || null;
  }

  async function saveDraft() {
    readFields();
    const content = (draft.content || '').trim();
    if (!content) { toast('Add some context before saving', 'warn'); detailTab = 'context'; renderDetail(); return; }
    const payload = { ...draft, content, title: (draft.title || '').trim() || Fmt.clip(content.split('\n')[0], 70) };
    if (!payload.id) delete payload.id;
    delete payload.versions; // managed by the store
    const saved = await Store.saveCapsule(payload);
    selectedId = saved.id;
    draft = JSON.parse(JSON.stringify(saved));
    dirty = false;
    toast(payload.id ? 'Saved' : 'Capsule created');
    await load();
  }

  async function onDetailClick(e) {
    const tabBtn = e.target.closest('.tabs [data-tab]');
    if (tabBtn) { readFields(); detailTab = tabBtn.dataset.tab; renderDetail(); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn || !draft) return;
    switch (btn.dataset.act) {
      case 'save': await saveDraft(); break;
      case 'star':
        draft.starred = !draft.starred;
        if (draft.id && !dirty) { await Store.patchCapsule(draft.id, { starred: draft.starred }); }
        else { readFields(); renderDetail(); setDirty(true); }
        break;
      case 'copy': {
        readFields();
        try { await navigator.clipboard.writeText(Fmt.forInjection(draft, prefs)); toast('Copied — paste it into any AI chat'); if (draft.id) Store.markUsed(draft.id); }
        catch (_) { toast('Clipboard blocked by the browser', 'error'); }
        break;
      }
      case 'dup': {
        const copy = await Store.duplicateCapsule(draft.id);
        if (copy) { dirty = false; await load(); await select(copy.id); toast('Duplicated'); }
        break;
      }
      case 'md': readFields(); download(slug(draft.title) + '.md', toMarkdown(draft), 'text/markdown'); break;
      case 'delete':
        if (await confirmBox('Delete this capsule?', '"' + Fmt.clip(draft.title, 60) + '" will be removed from this device.', 'Delete')) {
          await Store.deleteCapsule(draft.id);
          selectedId = null; draft = null; dirty = false;
          toast('Capsule deleted');
          await load();
        }
        break;
      case 'regen': {
        const { content } = Fmt.buildContent(draft.messages, {
          platformName: P.nameFor(draft.platform), format: btn.dataset.format, recentTurns: prefs.recentTurns, maxChars: prefs.maxChars,
        });
        readFields();
        draft.content = content;
        detailTab = 'context';
        renderDetail();
        setDirty(true);
        toast('Context rebuilt — review and Save');
        break;
      }
      case 'restore': {
        const v = draft.versions[Number(btn.dataset.i)];
        if (v) { draft.content = v.content; if (v.title) draft.title = v.title; detailTab = 'context'; renderDetail(); setDirty(true); toast('Version loaded — Save to keep it'); }
        break;
      }
    }
  }

  // ─── folders ────────────────────────────────────────────────
  function renderFolders() {
    const list = $('folder-list');
    if (!folders.length) { list.innerHTML = '<p class="muted small" style="margin:6px 4px 0">No folders yet.</p>'; return; }
    list.innerHTML = folders.map((f) => {
      const n = capsules.filter((c) => c.folderId === f.id).length;
      return `<div class="folder-row" data-id="${esc(f.id)}"><span class="fi">${I.folder}</span>
        <input value="${esc(f.name)}" maxlength="40" aria-label="Folder name">
        <span class="n">${n} capsule${n === 1 ? '' : 's'}</span>
        <button class="btn sm" data-act="open">View</button>
        <button class="icon-btn" data-act="del" title="Delete folder">${I.trash}</button></div>`;
    }).join('');
  }

  // ─── settings ───────────────────────────────────────────────
  function renderSettings() {
    document.querySelectorAll('[data-theme-pick]').forEach((b) => b.classList.toggle('on', b.dataset.themePick === prefs.theme));
    document.querySelectorAll('[data-pref]').forEach((el) => {
      const v = prefs[el.dataset.pref];
      if (el.type === 'checkbox') el.checked = !!v;
      else if (document.activeElement !== el) el.value = v;
    });
  }

  async function onPrefChange(e) {
    const el = e.target.closest('[data-pref]');
    if (!el) return;
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'number') {
      v = Math.round(Number(el.value));
      const min = Number(el.min), max = Number(el.max);
      if (!Number.isFinite(v)) return;
      v = Math.min(max, Math.max(min, v));
      el.value = v;
    } else v = el.value;
    await Store.savePrefs({ [el.dataset.pref]: v });
    toast('Setting saved');
  }

  // ─── wiring ─────────────────────────────────────────────────
  function wire() {
    window.addEventListener('hashchange', route);
    $('welcome-close').onclick = () => { $('welcome').hidden = true; try { localStorage.setItem('cf_welcome_dismissed', '1'); } catch (_) {} };
    $('q').addEventListener('input', (e) => { filt.q = e.target.value; renderList(); });
    $('chips').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (c) { filt.view = c.dataset.view; renderList(); } });
    $('f-folder').onchange = (e) => { filt.folder = e.target.value; renderList(); };
    $('f-platform').onchange = (e) => { filt.platform = e.target.value; renderList(); };
    $('f-sort').onchange = (e) => { filt.sort = e.target.value; renderList(); };
    $('new-btn').onclick = newCapsule;
    $('clist').addEventListener('click', (e) => { const b = e.target.closest('.citem'); if (b) select(b.dataset.id); });

    const detail = $('detail');
    detail.addEventListener('click', onDetailClick);
    detail.addEventListener('input', (e) => { if (e.target.matches('.title-input, .f-content, .f-tags')) setDirty(true); });
    detail.addEventListener('change', (e) => { if (e.target.matches('.f-folder')) setDirty(true); });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && draft && !$('view-capsules').hidden) { e.preventDefault(); saveDraft(); }
    });
    window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

    // Folders
    $('folder-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('folder-name').value.trim();
      if (!name) return;
      if (folders.some((f) => f.name.toLowerCase() === name.toLowerCase())) { toast('A folder with that name already exists', 'warn'); return; }
      await Store.saveFolder({ name });
      $('folder-name').value = '';
      toast('Folder created');
    });
    $('folder-list').addEventListener('change', async (e) => {
      const row = e.target.closest('.folder-row');
      if (!row || e.target.tagName !== 'INPUT') return;
      const name = e.target.value.trim();
      if (!name) { renderFolders(); return; }
      await Store.saveFolder({ id: row.dataset.id, name });
      toast('Folder renamed');
    });
    $('folder-list').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const id = btn.closest('.folder-row').dataset.id;
      const f = folders.find((x) => x.id === id);
      if (btn.dataset.act === 'open') { filt.folder = id; location.hash = 'capsules'; renderFilters(); renderList(); }
      if (btn.dataset.act === 'del' && f && (await confirmBox('Delete folder?', '"' + f.name + '" will be removed. Its capsules are kept and moved out of the folder.', 'Delete folder'))) {
        await Store.deleteFolder(id);
        toast('Folder deleted');
      }
    });

    // Settings
    $('themes').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-theme-pick]');
      if (b) { await Store.savePrefs({ theme: b.dataset.themePick }); toast('Theme applied everywhere'); }
    });
    $('view-settings').addEventListener('change', onPrefChange);

    // Data
    $('export-json').onclick = async () => {
      const data = await Store.exportAll();
      download('capsule-flow-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(data, null, 2));
      toast('Exported ' + data.capsules.length + ' capsules');
    };
    $('export-md').onclick = async () => {
      const caps = await Store.getCapsules();
      if (!caps.length) { toast('Nothing to export yet', 'warn'); return; }
      download('capsule-flow-' + new Date().toISOString().slice(0, 10) + '.md', caps.map(toMarkdown).join('\n\n---\n\n'), 'text/markdown');
    };
    $('import-btn').onclick = () => $('import-file').click();
    $('import-file').onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const status = $('import-status');
      try {
        const data = JSON.parse(await file.text());
        const r = await Store.importAll(data);
        status.textContent = `Imported ${r.added} capsule${r.added === 1 ? '' : 's'}${r.skipped ? `, skipped ${r.skipped} already here` : ''}${r.addedFolders ? `, ${r.addedFolders} folder${r.addedFolders === 1 ? '' : 's'}` : ''}.`;
        toast('Import complete');
      } catch (err) {
        status.textContent = err instanceof SyntaxError ? 'That file isn\'t valid JSON.' : err.message;
        toast('Import failed', 'error');
      }
    };
    $('wipe-confirm').addEventListener('input', (e) => { $('wipe-btn').disabled = e.target.value.trim().toLowerCase() !== 'delete'; });
    $('wipe-btn').onclick = async () => {
      if (!(await confirmBox('Delete all capsules?', 'Every capsule and folder in this browser will be erased.', 'Delete everything'))) return;
      await Store.clearAll();
      selectedId = null; draft = null; dirty = false;
      $('wipe-confirm').value = ''; $('wipe-btn').disabled = true;
      toast('All capsules deleted');
    };

    // Help
    $('plat-grid').innerHTML = P.PLATFORMS.map((p) => `<a href="${p.url}" target="_blank" rel="noopener"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}<small>${esc(p.hosts[0])}</small></a>`).join('');
    $('open-shortcuts').onclick = (e) => { e.preventDefault(); chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); };

    Store.onChange(load);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    $('version').textContent = 'v' + chrome.runtime.getManifest().version + ' · local-first';
    paintIcons();
    wire();
    filt.sort = (await Store.getPrefs()).sortBy || 'updatedAt';
    await load();
    route();
  });
})();
