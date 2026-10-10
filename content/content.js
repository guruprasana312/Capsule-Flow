// ============================================================
// Capsule Flow — content script
// Floating button + side panel on supported AI chat sites.
// Captures conversations into capsules and injects capsules
// back into the chat box. UI lives in a Shadow DOM.
// ============================================================
(function () {
  'use strict';
  if (window.__capsuleFlowLoaded) return;
  window.__capsuleFlowLoaded = true;

  const Store = globalThis.CFStore;
  const Fmt = globalThis.CFFormat;
  const P = globalThis.CFPlatforms;
  const I = globalThis.CFIcons;

  const PLATFORM = P.detect(location.hostname);
  const PLATFORM_ID = PLATFORM ? PLATFORM.id : 'web';
  const PLATFORM_NAME = PLATFORM ? PLATFORM.name : location.hostname;

  let prefs = { ...Store.DEFAULT_PREFS };
  let capsules = [];
  let folders = [];
  let filter = { query: '', view: 'all', folderId: '' };
  let editing = null; // { id?, messages, brief, platform, sourceUrl }
  let draggingId = null;
  let host, root, shell, fab, panel, listEl, overlay, modalEl, confirmOverlay, toastsEl;

  // ─── Utilities ──────────────────────────────────────────────
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel) => root.querySelector(sel);
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  function ago(iso) {
    if (!iso) return '';
    const d = Date.now() - new Date(iso).getTime();
    if (d < 60e3) return 'just now';
    if (d < 3600e3) return Math.floor(d / 60e3) + 'm ago';
    if (d < 86400e3) return Math.floor(d / 3600e3) + 'h ago';
    if (d < 7 * 86400e3) return Math.floor(d / 86400e3) + 'd ago';
    return new Date(iso).toLocaleDateString();
  }

  function toast(text, kind) {
    if (!toastsEl) return;
    const t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.textContent = text;
    toastsEl.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  // ─── Conversation extraction ────────────────────────────────
  function cleanText(t) {
    return Fmt.stripBoilerplate(String(t || '').replace(/\u00a0/g, ' '));
  }

  // DOM → readable text that keeps lists, headings and code blocks (innerText drops bullets).
  const SKIP_TAGS = new Set(['BUTTON', 'SVG', 'STYLE', 'SCRIPT', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'IMG', 'VIDEO', 'CANVAS', 'TEMPLATE']);
  const BLOCK_TAGS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'TABLE', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'HR', 'DL', 'DT', 'DD', 'FIGURE', 'MESSAGE-CONTENT']);
  function serialize(node) {
    let out = '';
    const walk = (n, listDepth) => {
      if (n.nodeType === 3) { out += n.nodeValue.replace(/\s+/g, ' '); return; }
      if (n.nodeType !== 1) return;
      const tag = n.tagName.toUpperCase();
      if (SKIP_TAGS.has(tag) || n.getAttribute('aria-hidden') === 'true' || n.classList.contains('sr-only')) return;
      if (tag === 'BR') { out += '\n'; return; }
      if (tag === 'PRE') {
        const code = n.querySelector('code');
        const lang = code && (code.className.match(/language-([\w+#-]+)/) || [])[1];
        out += '\n```' + (lang || '') + '\n' + (code || n).textContent.replace(/\n$/, '') + '\n```\n';
        return;
      }
      if (tag === 'CODE') { out += '`' + n.textContent + '`'; return; }
      const block = BLOCK_TAGS.has(tag);
      if (block) out += '\n';
      if (/^H[1-6]$/.test(tag)) out += '#'.repeat(Number(tag[1])) + ' ';
      if (tag === 'LI') {
        const parent = n.parentElement;
        const indent = '  '.repeat(Math.max(0, listDepth - 1));
        if (parent && parent.tagName === 'OL') {
          const idx = Array.prototype.indexOf.call(parent.children, n) + (Number(parent.getAttribute('start')) || 1);
          out += indent + idx + '. ';
        } else out += indent + '- ';
      }
      if (tag === 'TD' || tag === 'TH') out += ' | ';
      const depth = tag === 'UL' || tag === 'OL' ? listDepth + 1 : listDepth;
      for (const c of n.childNodes) walk(c, depth);
      if (block) out += '\n';
    };
    walk(node, 0);
    let text = out
      .split('\n').map((l) => l.replace(/[ \t]+$/, '').replace(/^ (?=\S)/, '')).join('\n')
      .replace(/\n{3,}/g, '\n\n');
    // Keep list items on consecutive lines.
    const LIST_GAP = /^(\s*(?:- |\d+\. ).*)\n\n(?=\s*(?:- |\d+\. ))/m;
    while (LIST_GAP.test(text)) text = text.replace(LIST_GAP, '$1\n');
    return text;
  }

  function textOf(el, textSel) {
    if (textSel) {
      const inner = Array.from(el.querySelectorAll(textSel)).filter((n, _, arr) => !arr.some((o) => o !== n && o.contains(n)));
      if (inner.length) return cleanText(inner.map(serialize).join('\n\n'));
    }
    return cleanText(serialize(el));
  }

  function runQueries(queries) {
    const found = [];
    for (const q of queries) {
      let nodes;
      try { nodes = document.querySelectorAll(q.selector); } catch (_) { continue; }
      nodes.forEach((el) => {
        if (host && host.contains(el)) return;
        const role = typeof q.role === 'function' ? q.role(el) : q.role;
        found.push({ el, role, textSel: q.text });
      });
    }
    // Drop elements nested inside another match (avoids duplicates), then sort by DOM order.
    const unique = found.filter((a) => !found.some((b) => b !== a && b.el !== a.el && b.el.contains(a.el)));
    const seenEls = new Set();
    const deduped = unique.filter((m) => (seenEls.has(m.el) ? false : (seenEls.add(m.el), true)));
    deduped.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const messages = [];
    for (const m of deduped) {
      const text = textOf(m.el, m.textSel);
      if (!text) continue;
      const prev = messages[messages.length - 1];
      if (prev && prev.role === m.role && prev.text === text) continue;
      messages.push({ role: m.role, text });
    }
    return messages;
  }

  function extractMessages() {
    let messages = [];
    if (PLATFORM) messages = runQueries(PLATFORM.messages);
    if (!messages.length) messages = runQueries(P.GENERIC_MESSAGES);
    return messages;
  }

  // Visible page text minus the chat box, footer disclaimers, menus and buttons.
  function pageTextFallback() {
    const main = document.querySelector('main') || document.body;
    const clone = main.cloneNode(true);
    clone.querySelectorAll('form, footer, nav, aside, button, textarea, input, select, svg, script, style, [contenteditable="true"], [role="contentinfo"], [role="navigation"], [aria-hidden="true"], .sr-only, capsule-flow-root')
      .forEach((n) => n.remove());
    return cleanText(serialize(clone)).slice(0, 30000);
  }

  function conversationTitle() {
    let t = (document.title || '').replace(/\s*[-|·•–]\s*(ChatGPT|Claude|Gemini|DeepSeek|Perplexity|Grok|Copilot|Poe|Le Chat).*$/i, '').trim();
    if (/^(ChatGPT|Claude|Gemini|DeepSeek|Perplexity|Grok|Copilot|Poe|Le Chat|New chat|Google Gemini)$/i.test(t)) t = '';
    return t;
  }

  // ─── Injection into the chat box ────────────────────────────
  function findInput() {
    const sels = (PLATFORM ? PLATFORM.inputs : []).concat(P.GENERIC_INPUTS);
    const active = document.activeElement;
    if (active && !host.contains(active) && (active.tagName === 'TEXTAREA' || active.isContentEditable) && isVisible(active)) {
      return active.isContentEditable ? (active.closest('[contenteditable="true"]') || active) : active;
    }
    for (const sel of sels) {
      let nodes;
      try { nodes = document.querySelectorAll(sel); } catch (_) { continue; }
      // Prefer the last visible match: chat boxes sit at the bottom of the page.
      const vis = Array.from(nodes).filter((n) => isVisible(n) && !n.disabled && !n.readOnly);
      if (vis.length) return vis[vis.length - 1];
    }
    return null;
  }

  function probeIn(el, text) {
    const probe = norm(text).slice(0, 40);
    const have = norm(el.tagName === 'TEXTAREA' ? el.value : el.innerText);
    return have.includes(probe);
  }

  function placeCaret(el, mode) {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    if (mode !== 'replace') range.collapse(mode === 'prepend');
    sel.removeAllRanges();
    sel.addRange(range);
  }

  async function insertText(el, text, mode) {
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const cur = el.value || '';
      let next = text;
      if (mode === 'append' && cur.trim()) next = cur.replace(/\s+$/, '') + '\n\n' + text;
      if (mode === 'prepend' && cur.trim()) next = text + '\n\n' + cur;
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, next);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.selectionStart = el.selectionEnd = next.length;
      el.scrollTop = el.scrollHeight;
      return true;
    }

    // contenteditable (ProseMirror, Quill, Lexical …)
    const existing = norm(el.innerText);
    let payload = text;
    if (existing && mode === 'append') payload = '\n\n' + text;
    if (existing && mode === 'prepend') payload = text + '\n\n';
    placeCaret(el, existing ? mode : 'replace');

    // 1) Native editing command — fires beforeinput/input that editors understand.
    try { document.execCommand('insertText', false, payload); } catch (_) {}
    if (probeIn(el, text)) return true;

    // 2) Synthetic paste — handled by most rich editors.
    try {
      placeCaret(el, existing ? mode : 'replace');
      const dt = new DataTransfer();
      dt.setData('text/plain', payload);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 120));
    if (probeIn(el, text)) return true;

    // 3) Last resort — write paragraphs directly.
    if (mode === 'replace' || !existing) el.innerHTML = '';
    const frag = document.createDocumentFragment();
    payload.split('\n').forEach((line) => {
      const p = document.createElement('p');
      if (line) p.textContent = line; else p.appendChild(document.createElement('br'));
      frag.appendChild(p);
    });
    if (mode === 'prepend') el.insertBefore(frag, el.firstChild); else el.appendChild(frag);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: payload }));
    return probeIn(el, text);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) {}
      ta.remove();
      return ok;
    }
  }

  async function injectCapsule(id, targetEl) {
    const cap = await Store.getCapsule(id);
    if (!cap) return { ok: false, error: 'Capsule not found' };
    const text = Fmt.forInjection(cap, prefs);
    const el = targetEl || findInput();
    let ok = false;
    if (el) {
      try { ok = await insertText(el, text, prefs.injectMode); } catch (e) { console.warn('[Capsule Flow] insert failed', e); }
    }
    await Store.markUsed(id);
    if (ok) {
      toast('Injected "' + Fmt.clip(cap.title, 40) + '"');
      closePanel();
      return { ok: true, method: 'inject' };
    }
    const copied = await copyText(text);
    toast(copied ? 'Couldn\'t find the chat box — copied to clipboard. Paste with Ctrl+V.' : 'Couldn\'t insert or copy this capsule.', copied ? 'warn' : 'error');
    return { ok: copied, method: copied ? 'clipboard' : 'none' };
  }

  // ─── UI construction ────────────────────────────────────────
  function mount() {
    // Remove a widget left behind by a previous version of the extension (after an update/reload).
    window.dispatchEvent(new Event('capsule-flow:replace'));
    document.querySelectorAll('capsule-flow-root').forEach((n) => n.remove());
    host = document.createElement('capsule-flow-root');
    host.style.cssText = 'all: initial; position: static;';
    root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = globalThis.CF_WIDGET_CSS || '';
    root.appendChild(style);

    shell = document.createElement('div');
    shell.className = 'shell';
    shell.innerHTML = `
      <button class="fab" part="fab" title="Capsule Flow (Ctrl+Shift+K)" aria-label="Open Capsule Flow">
        ${I.capsule}<span class="label">Capsules</span><span class="count">0</span>
      </button>
      <aside class="panel" role="dialog" aria-label="Capsule Flow">
        <div class="head">
          <div class="logo">${I.capsule}</div>
          <div>
            <div class="brand">Capsule <b>Flow</b></div>
            <div class="sub"><span class="dot" style="background:${PLATFORM ? PLATFORM.color : '#7c8aa0'}"></span>${esc(PLATFORM_NAME)}</div>
          </div>
          <div class="spacer"></div>
          <button class="icon-btn" data-act="dashboard" title="Open dashboard">${I.grid}</button>
          <button class="icon-btn" data-act="close" title="Close (Esc)">${I.close}</button>
        </div>
        <div class="actions">
          <button class="btn primary" data-act="capture" title="Save this conversation as a capsule (Alt+Shift+C)">${I.capture}Capture chat</button>
          <button class="btn" data-act="selection" title="Save highlighted text as a capsule">${I.selection}Selection</button>
          <button class="btn" data-act="new" title="Write a capsule from scratch">${I.plus}New</button>
        </div>
        <div class="search">${I.search}<input type="search" placeholder="Search capsules…" aria-label="Search capsules"></div>
        <div class="filters">
          <button class="chip on" data-view="all">All</button>
          <button class="chip" data-view="starred">Starred</button>
          <button class="chip" data-view="recent">Recent</button>
          <select aria-label="Folder"></select>
        </div>
        <div class="list" role="list"></div>
        <div class="foot"><span class="stats"></span><a data-act="dashboard">Manage all →</a></div>
      </aside>
      <div class="overlay edit-overlay"><div class="modal"></div></div>
      <div class="overlay confirm-overlay"><div class="modal small"></div></div>
      <div class="toasts"></div>`;
    root.appendChild(shell);

    fab = $('.fab');
    panel = $('.panel');
    listEl = $('.list');
    overlay = $('.edit-overlay');
    modalEl = overlay.querySelector('.modal');
    confirmOverlay = $('.confirm-overlay');
    toastsEl = $('.toasts');

    fab.addEventListener('click', togglePanel);
    shell.addEventListener('click', onShellClick);
    $('.search input').addEventListener('input', (e) => { filter.query = e.target.value; renderList(); });
    $('.filters select').addEventListener('change', (e) => { filter.folderId = e.target.value; renderList(); });
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeEditor(); });
    confirmOverlay.addEventListener('mousedown', (e) => { if (e.target === confirmOverlay) confirmOverlay.classList.remove('open'); });
    // Keep keystrokes inside our UI from reaching the host page's shortcuts.
    ['keydown', 'keyup', 'keypress'].forEach((t) => root.addEventListener(t, (e) => {
      if (t === 'keydown' && e.key === 'Escape') {
        if (confirmOverlay.classList.contains('open')) confirmOverlay.classList.remove('open');
        else if (overlay.classList.contains('open')) closeEditor();
        else closePanel();
      }
      e.stopPropagation();
    }));

    attach();
    // Single-page apps sometimes wipe the body; re-attach if that happens.
    attachTimer = setInterval(attach, 2000);
    // A newer copy of this script (after an extension update) asks older copies to step aside.
    window.addEventListener('capsule-flow:replace', teardown, { once: true });
  }

  let attachTimer = null;
  function contextAlive() {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch (_) { return false; }
  }
  function teardown() {
    clearInterval(attachTimer);
    if (host) host.remove();
  }
  function attach() {
    if (!contextAlive()) { teardown(); return; }
    if (!host.isConnected) (document.body || document.documentElement).appendChild(host);
  }

  function applyPrefs() {
    shell.setAttribute('data-theme', prefs.theme || 'aurora');
    const left = prefs.fabPosition === 'bottom-left';
    fab.classList.toggle('left', left);
    panel.classList.toggle('left', left);
    fab.classList.toggle('hidden', prefs.showFab === false);
  }

  // ─── Panel ──────────────────────────────────────────────────
  function openPanel() {
    panel.classList.add('open');
    fab.classList.add('behind');
    renderList();
    setTimeout(() => { const i = $('.search input'); if (i) i.focus(); }, 60);
  }
  function closePanel() { panel.classList.remove('open'); fab.classList.remove('behind'); }
  function togglePanel() { panel.classList.contains('open') ? closePanel() : openPanel(); }

  function renderFolders() {
    const sel = $('.filters select');
    const cur = filter.folderId;
    sel.innerHTML = '<option value="">All folders</option>' + folders.map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');
    sel.value = folders.some((f) => f.id === cur) ? cur : '';
    filter.folderId = sel.value;
  }

  function visibleCapsules() {
    const opts = { folderId: filter.folderId || null, sortBy: prefs.sortBy };
    if (filter.view === 'starred') opts.starred = true;
    if (filter.view === 'recent') opts.sortBy = 'recent';
    let out = Store.search(capsules, filter.query, opts);
    if (filter.view === 'recent') out = out.filter((c) => c.lastUsedAt || c.updatedAt).slice(0, 15);
    return out;
  }

  function renderList() {
    fab.querySelector('.count').textContent = capsules.length;
    root.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.view === filter.view));
    $('.stats').textContent = capsules.length + ' capsule' + (capsules.length === 1 ? '' : 's') + ' · stored locally';
    if (!panel.classList.contains('open')) return;
    const items = visibleCapsules();
    if (!items.length) {
      const none = !capsules.length;
      listEl.innerHTML = `<div class="empty"><div class="big">${I.capsule}</div>
        <h4>${none ? 'No capsules yet' : 'Nothing matches'}</h4>
        <p>${none ? 'Click <b>Capture chat</b> to save this conversation, then inject it into any other AI tool.' : 'Try a different search or filter.'}</p></div>`;
      return;
    }
    listEl.innerHTML = items.map((c) => {
      const tags = (c.tags || []).slice(0, 3).map((t) => `<span class="tag">#${esc(t)}</span>`).join('');
      const folder = c.folderId ? folders.find((f) => f.id === c.folderId) : null;
      return `<div class="card" role="listitem" draggable="true" data-id="${esc(c.id)}" title="Drag onto any chat box, or click Inject">
        <div class="top">${c.starred ? `<span class="star">★</span>` : ''}<div class="title">${esc(c.title)}</div></div>
        <div class="preview">${esc(Fmt.clip(c.content, 260))}</div>
        <div class="meta"><span class="dot" style="background:${P.colorFor(c.platform)}"></span>${esc(P.nameFor(c.platform))} · ${esc(ago(c.updatedAt))}${folder ? ' · ' + esc(folder.name) : ''} ${tags}</div>
        <div class="row-actions">
          <button class="btn primary" data-act="inject" title="Insert into this chat">${I.inject}Inject</button>
          <button class="icon-btn" data-act="copy" title="Copy to clipboard">${I.copy}</button>
          <button class="icon-btn ${c.starred ? 'on' : ''}" data-act="star" title="${c.starred ? 'Unstar' : 'Star'}">${c.starred ? I.starFill : I.star}</button>
          <button class="icon-btn" data-act="edit" title="Edit">${I.edit}</button>
          <button class="icon-btn del" data-act="delete" title="Delete">${I.trash}</button>
        </div></div>`;
    }).join('');

    listEl.querySelectorAll('.card').forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        const cap = capsules.find((c) => c.id === card.dataset.id);
        if (!cap) return;
        draggingId = cap.id;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', Fmt.forInjection(cap, prefs));
      });
      card.addEventListener('dragend', () => { card.classList.remove('dragging'); setTimeout(() => { draggingId = null; }, 0); });
    });
  }

  async function onShellClick(e) {
    const chip = e.target.closest('.chip');
    if (chip) { filter.view = chip.dataset.view; renderList(); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const card = btn.closest('.card');
    const id = card && card.dataset.id;
    switch (act) {
      case 'close': closePanel(); break;
      case 'dashboard': chrome.runtime.sendMessage({ type: 'CF_OPEN_DASHBOARD' }); break;
      case 'capture': captureChat(); break;
      case 'selection': captureSelection(); break;
      case 'new': openEditor({ title: '', content: '', platform: 'manual' }); break;
      case 'inject': injectCapsule(id); break;
      case 'copy': {
        const cap = capsules.find((c) => c.id === id);
        if (cap && (await copyText(Fmt.forInjection(cap, prefs)))) { toast('Copied to clipboard'); Store.markUsed(id); }
        break;
      }
      case 'star': await Store.toggleStar(id); break;
      case 'edit': { const cap = capsules.find((c) => c.id === id); if (cap) openEditor(cap); break; }
      case 'delete': {
        const cap = capsules.find((c) => c.id === id);
        if (cap) confirmDelete(cap);
        break;
      }
      case 'save': saveEditor(); break;
      case 'cancel': closeEditor(); break;
      case 'regen': regenerate(); break;
    }
  }

  function confirmDelete(cap) {
    const m = confirmOverlay.querySelector('.modal');
    m.innerHTML = `<div class="mhead"><h3>Delete capsule?</h3></div>
      <p style="margin:0 0 14px;color:var(--text-2)">"${esc(Fmt.clip(cap.title, 80))}" will be removed from this device. This can't be undone.</p>
      <div class="mactions"><button class="btn" data-x="no">Cancel</button><button class="btn danger solid" data-x="yes">Delete</button></div>`;
    confirmOverlay.classList.add('open');
    m.querySelector('[data-x="no"]').onclick = () => confirmOverlay.classList.remove('open');
    m.querySelector('[data-x="yes"]').onclick = async () => {
      confirmOverlay.classList.remove('open');
      await Store.deleteCapsule(cap.id);
      toast('Capsule deleted');
    };
    m.querySelector('[data-x="yes"]').focus();
  }

  // ─── Capture ────────────────────────────────────────────────
  function captureChat() {
    const messages = extractMessages();
    if (messages.length) {
      const { content, brief } = Fmt.buildContent(messages, {
        platformName: PLATFORM_NAME, format: prefs.captureFormat, recentTurns: prefs.recentTurns, maxChars: prefs.maxChars,
      });
      openEditor({
        title: conversationTitle() || Fmt.suggestTitle(messages, PLATFORM_NAME + ' chat'),
        content, messages, brief, platform: PLATFORM_ID, sourceUrl: location.href,
      }, `Captured ${messages.length} message${messages.length === 1 ? '' : 's'} from ${PLATFORM_NAME}. Review the brief, then save.`);
      return;
    }
    const text = pageTextFallback();
    if (!text) { toast('There\'s no conversation on this page yet.', 'warn'); return; }
    openEditor({ title: conversationTitle() || PLATFORM_NAME + ' page', content: text, platform: PLATFORM_ID, sourceUrl: location.href },
      'Couldn\'t detect individual messages here, so the visible page text was captured instead. Trim it down before saving.', true);
  }

  function captureSelection(textArg) {
    const text = (textArg || String(window.getSelection() || '')).trim();
    if (!text) { toast('Highlight some text on the page first.', 'warn'); return; }
    openEditor({ title: Fmt.clip(text.split('\n')[0], 70), content: text, platform: PLATFORM_ID, sourceUrl: location.href });
  }

  // ─── Editor modal ───────────────────────────────────────────
  function openEditor(cap, note, warn) {
    editing = {
      id: cap.id || null,
      messages: cap.messages || [],
      brief: cap.brief || null,
      platform: cap.platform || PLATFORM_ID,
      sourceUrl: cap.sourceUrl || '',
    };
    const folderOpts = '<option value="">No folder</option>' + folders.map((f) => `<option value="${esc(f.id)}" ${cap.folderId === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
    const canRegen = editing.messages.length > 0;
    modalEl.innerHTML = `
      <div class="mhead"><div class="logo">${I.capsule}</div><h3>${cap.id ? 'Edit capsule' : 'Save capsule'}</h3><div class="spacer"></div>
        <button class="icon-btn" data-act="cancel" title="Close">${I.close}</button></div>
      ${note ? `<div class="note ${warn ? 'warn' : ''}">${esc(note)}</div>` : ''}
      <div class="field"><label>Title</label><input class="f-title" maxlength="120" value="${esc(cap.title || '')}" placeholder="e.g. Pricing page rewrite — goals & constraints"></div>
      <div class="field"><label>Context</label><textarea class="f-content" spellcheck="false" placeholder="Goals, constraints, background, decisions…">${esc(cap.content || '')}</textarea></div>
      <div class="grid2">
        <div class="field"><label>Tags</label><input class="f-tags" value="${esc((cap.tags || []).join(', '))}" placeholder="comma, separated"></div>
        <div class="field"><label>Folder</label><select class="f-folder">${folderOpts}</select></div>
      </div>
      ${canRegen ? `<div class="grid2" style="align-items:end">
        <div class="field"><label>Format</label><select class="f-format">
          <option value="brief" ${prefs.captureFormat !== 'full' ? 'selected' : ''}>Brief + recent messages</option>
          <option value="full" ${prefs.captureFormat === 'full' ? 'selected' : ''}>Brief + full transcript</option></select></div>
        <div class="field"><button class="btn" data-act="regen" style="width:100%">${I.refresh}Rebuild from ${editing.messages.length} messages</button></div>
      </div>` : ''}
      <div class="mactions">
        <label class="check"><input type="checkbox" class="f-star" ${cap.starred ? 'checked' : ''}> Star</label>
        <span class="count-hint"></span>
        <button class="btn" data-act="cancel">Cancel</button>
        <button class="btn primary" data-act="save">${I.capsule}${cap.id ? 'Save changes' : 'Save capsule'}</button>
      </div>`;
    const ta = modalEl.querySelector('.f-content');
    const hint = modalEl.querySelector('.count-hint');
    const upd = () => { hint.textContent = ta.value.length.toLocaleString() + ' chars'; };
    ta.addEventListener('input', upd);
    upd();
    overlay.classList.add('open');
    setTimeout(() => modalEl.querySelector('.f-title').focus(), 40);
  }

  function regenerate() {
    if (!editing || !editing.messages.length) return;
    const format = modalEl.querySelector('.f-format').value;
    const { content, brief } = Fmt.buildContent(editing.messages, {
      platformName: P.nameFor(editing.platform), format, recentTurns: prefs.recentTurns, maxChars: prefs.maxChars,
    });
    editing.brief = brief;
    const ta = modalEl.querySelector('.f-content');
    ta.value = content;
    ta.dispatchEvent(new Event('input'));
  }

  function closeEditor() {
    overlay.classList.remove('open');
    editing = null;
    // Return focus to the panel so Esc / typing keep working inside the widget.
    if (panel.classList.contains('open')) { const i = $('.search input'); if (i) i.focus(); }
  }

  async function saveEditor() {
    if (!editing) return;
    const title = modalEl.querySelector('.f-title').value.trim();
    const content = modalEl.querySelector('.f-content').value.trim();
    if (!content) { toast('Add some context before saving.', 'warn'); modalEl.querySelector('.f-content').focus(); return; }
    const data = {
      title: title || Fmt.clip(content.split('\n')[0], 70),
      content,
      tags: Store.cleanTags(modalEl.querySelector('.f-tags').value),
      folderId: modalEl.querySelector('.f-folder').value || null,
      starred: modalEl.querySelector('.f-star').checked,
      messages: editing.messages,
      brief: editing.brief,
      platform: editing.platform,
      sourceUrl: editing.sourceUrl,
    };
    if (editing.id) data.id = editing.id;
    try {
      await Store.saveCapsule(data);
      toast(editing.id ? 'Capsule updated' : 'Capsule saved — inject it anywhere');
      closeEditor();
      if (!panel.classList.contains('open')) openPanel();
    } catch (e) {
      toast('Couldn\'t save: ' + e.message, 'error');
    }
  }

  // Esc closes the panel even when focus has moved back to the page.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !panel || !panel.classList.contains('open')) return;
    if (overlay.classList.contains('open') || confirmOverlay.classList.contains('open')) return;
    closePanel();
  });

  // ─── Drag & drop onto the chat box ──────────────────────────
  function dropTarget(e) {
    const path = e.composedPath ? e.composedPath() : [e.target];
    for (const n of path) {
      if (n === host) return null;
      if (n && n.nodeType === 1 && (n.tagName === 'TEXTAREA' || n.isContentEditable)) {
        return n.isContentEditable ? (n.closest('[contenteditable="true"]') || n) : n;
      }
    }
    return null;
  }
  document.addEventListener('dragover', (e) => {
    if (draggingId && dropTarget(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
  }, true);
  document.addEventListener('drop', (e) => {
    if (!draggingId) return; // drops from other tabs fall through to the browser's native text drop
    const target = dropTarget(e);
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    const id = draggingId;
    draggingId = null;
    injectCapsule(id, target);
  }, true);

  // ─── Messages from popup / background ───────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'CF_PING':
        sendResponse({ ok: true, platform: PLATFORM_ID, name: PLATFORM_NAME });
        return;
      case 'CF_TOGGLE_PANEL':
        togglePanel(); sendResponse({ ok: true });
        return;
      case 'CF_OPEN_PANEL':
        openPanel(); sendResponse({ ok: true });
        return;
      case 'CF_CAPTURE_CHAT':
        captureChat(); sendResponse({ ok: true });
        return;
      case 'CF_CAPTURE_SELECTION':
        captureSelection(msg.text); sendResponse({ ok: true });
        return;
      case 'CF_EXTRACT': {
        const messages = extractMessages();
        sendResponse({ ok: true, messages, title: conversationTitle(), platform: PLATFORM_ID, url: location.href });
        return;
      }
      case 'CF_INJECT':
        injectCapsule(msg.id).then(sendResponse);
        return true; // async
      case 'CF_TOAST':
        toast(msg.text, msg.kind); sendResponse({ ok: true });
        return;
    }
  });

  // ─── Boot ───────────────────────────────────────────────────
  async function refresh() {
    [capsules, folders] = await Promise.all([Store.getCapsules(), Store.getFolders()]);
    renderFolders();
    renderList();
  }

  async function boot() {
    mount();
    try {
      prefs = await Store.getPrefs();
    } catch (e) {
      console.warn('[Capsule Flow] prefs unavailable', e);
    }
    applyPrefs();
    try { await refresh(); } catch (e) { console.warn('[Capsule Flow] load failed', e); }
    Store.onChange(async (changes) => {
      if (changes[Store.KEYS.prefs]) { prefs = await Store.getPrefs(); applyPrefs(); }
      await refresh();
    });
  }

  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot, { once: true });
})();
