// Capsule Flow — toolbar popup
(function () {
  'use strict';
  const Store = CFStore, Fmt = CFFormat, P = CFPlatforms, I = CFIcons;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let prefs = Store.DEFAULT_PREFS, capsules = [], folders = [];
  let view = 'all', query = '', folderId = '';
  let tab = null, tabPlatform = null, tabReady = false;

  function ago(iso) {
    if (!iso) return '';
    const d = Date.now() - new Date(iso).getTime();
    if (d < 60e3) return 'just now';
    if (d < 3600e3) return Math.floor(d / 60e3) + 'm ago';
    if (d < 86400e3) return Math.floor(d / 3600e3) + 'h ago';
    if (d < 7 * 86400e3) return Math.floor(d / 86400e3) + 'd ago';
    return new Date(iso).toLocaleDateString();
  }

  let toastTimer;
  function toast(text, kind) {
    const t = $('toast');
    t.textContent = text;
    t.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, 2600);
  }

  function sendToTab(message) {
    return new Promise((resolve) => {
      if (!tab) return resolve({ ok: false });
      chrome.runtime.sendMessage({ type: 'CF_TAB_SEND', tabId: tab.id, message }, (res) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
        else resolve(res || { ok: false });
      });
    });
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (_) { return false; }
  }

  function openDashboard(hash) {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html' + (hash || '')) });
    window.close();
  }

  // ─── Static chrome ──────────────────────────────────────────
  function paintIcons() {
    $('logo').innerHTML = I.capsule;
    $('btn-dashboard').innerHTML = I.grid;
    $('btn-settings').innerHTML = I.settings;
    $('btn-capture').innerHTML = I.capture + 'Capture this chat';
    $('btn-panel').innerHTML = I.external + 'Side panel';
    $('btn-new').innerHTML = I.plus + 'New';
    $('search-icon').outerHTML = I.search;
  }

  async function detectTab() {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    let host = '';
    try { host = new URL(tab.url).hostname; } catch (_) {}
    tabPlatform = P.detect(host);
    const status = $('status');
    if (tabPlatform) {
      tabReady = true;
      status.classList.add('live');
      status.querySelector('.dot').style.background = tabPlatform.color;
      $('status-text').textContent = 'Connected to ' + tabPlatform.name;
      $('btn-capture').disabled = false;
      $('btn-panel').disabled = false;
    } else {
      $('status-text').textContent = 'Open an AI chat to capture or inject';
      $('btn-capture').title = 'Open ChatGPT, Claude, Gemini, DeepSeek… to capture a chat';
      $('btn-panel').title = 'Only available on supported AI chat sites';
    }
  }

  // ─── List ───────────────────────────────────────────────────
  function render() {
    document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.view === view));
    const opts = { folderId: folderId || null, sortBy: prefs.sortBy };
    if (view === 'starred') opts.starred = true;
    if (view === 'recent') opts.sortBy = 'recent';
    let items = Store.search(capsules, query, opts);
    if (view === 'recent') items = items.slice(0, 15);
    $('count').textContent = capsules.length + ' capsule' + (capsules.length === 1 ? '' : 's') + ' · local only';

    const list = $('list');
    if (!items.length) {
      const none = !capsules.length;
      list.innerHTML = `<div class="empty"><div class="big">${I.capsule}</div>
        <h4>${none ? 'Your capsules live here' : 'Nothing matches'}</h4>
        <p>${none ? 'Open a conversation on any AI tool and hit <b>Capture this chat</b>. Then inject it anywhere else.' : 'Try a different search or filter.'}</p>
        ${none ? `<div class="platforms">${P.PLATFORMS.slice(0, 6).map((p) => `<a href="${p.url}" target="_blank" rel="noopener"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</a>`).join('')}</div>` : ''}
      </div>`;
      return;
    }
    list.innerHTML = items.map((c) => {
      const tags = (c.tags || []).slice(0, 2).map((t) => `<span class="tag">#${esc(t)}</span>`).join('');
      return `<div class="card" role="listitem" data-id="${esc(c.id)}">
        <div class="title">${c.starred ? '<span class="star">★</span>' : ''}${esc(c.title)}</div>
        <div class="preview">${esc(Fmt.clip(c.content, 180))}</div>
        <div class="meta"><span class="dot" style="background:${P.colorFor(c.platform)}"></span>${esc(P.nameFor(c.platform))} · ${esc(ago(c.updatedAt))} ${tags}</div>
        <div class="row">
          <button class="btn primary" data-act="inject" ${tabReady ? '' : 'disabled title="Open a supported AI chat to inject"'}>${I.inject}Inject</button>
          <button class="btn" data-act="copy">${I.copy}Copy</button>
          <span style="flex:1"></span>
          <button class="icon-btn ${c.starred ? 'on' : ''}" data-act="star" title="${c.starred ? 'Unstar' : 'Star'}">${c.starred ? I.starFill : I.star}</button>
          <button class="icon-btn" data-act="edit" title="Open in dashboard">${I.edit}</button>
          <button class="icon-btn del" data-act="delete" title="Delete">${I.trash}</button>
        </div></div>`;
    }).join('');
  }

  function renderFolders() {
    const sel = $('folder');
    sel.innerHTML = '<option value="">All folders</option>' + folders.map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');
    sel.value = folders.some((f) => f.id === folderId) ? folderId : '';
    folderId = sel.value;
  }

  async function load() {
    [prefs, capsules, folders] = await Promise.all([Store.getPrefs(), Store.getCapsules(), Store.getFolders()]);
    document.documentElement.setAttribute('data-theme', prefs.theme || 'aurora');
    renderFolders();
    render();
  }

  // ─── Actions ────────────────────────────────────────────────
  const pendingDelete = new Map();

  async function onListClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const id = btn.closest('.card').dataset.id;
    const cap = capsules.find((c) => c.id === id);
    if (!cap) return;
    switch (btn.dataset.act) {
      case 'inject': {
        btn.disabled = true;
        const res = await sendToTab({ type: 'CF_INJECT', id });
        if (res && res.ok && res.method === 'inject') window.close();
        else if (res && res.ok) { toast('Couldn\'t find the chat box, so it was copied. Paste with Ctrl+V.', 'warn'); btn.disabled = false; }
        else if (await copy(Fmt.forInjection(cap, prefs))) { toast('Reload the AI tab once, then try again. Copied for now.', 'warn'); btn.disabled = false; }
        else { toast('Couldn\'t reach that tab. Reload it and try again.', 'error'); btn.disabled = false; }
        break;
      }
      case 'copy':
        if (await copy(Fmt.forInjection(cap, prefs))) { toast('Copied to clipboard'); Store.markUsed(id); }
        else toast('Clipboard blocked by the browser', 'error');
        break;
      case 'star':
        await Store.toggleStar(id);
        break;
      case 'edit':
        openDashboard('#capsule=' + encodeURIComponent(id));
        break;
      case 'delete':
        // Two-click delete: first click arms, second confirms.
        if (pendingDelete.has(id)) {
          clearTimeout(pendingDelete.get(id));
          pendingDelete.delete(id);
          await Store.deleteCapsule(id);
          toast('Capsule deleted');
        } else {
          btn.style.color = 'var(--danger)';
          btn.title = 'Click again to delete';
          toast('Click delete again to confirm', 'warn');
          pendingDelete.set(id, setTimeout(() => { pendingDelete.delete(id); render(); }, 3000));
        }
        break;
    }
  }

  function wire() {
    $('btn-dashboard').onclick = () => openDashboard('');
    $('btn-settings').onclick = () => openDashboard('#settings');
    $('btn-new').onclick = () => openDashboard('#new');
    $('btn-capture').onclick = async () => {
      const res = await sendToTab({ type: 'CF_CAPTURE_CHAT' });
      if (res && res.ok) window.close();
      else toast('Couldn\'t reach this tab. Reload the page and try again.', 'error');
    };
    $('btn-panel').onclick = async () => {
      const res = await sendToTab({ type: 'CF_OPEN_PANEL' });
      if (res && res.ok) window.close();
      else toast('Couldn\'t reach this tab. Reload the page and try again.', 'error');
    };
    $('search').addEventListener('input', (e) => { query = e.target.value; render(); });
    $('folder').addEventListener('change', (e) => { folderId = e.target.value; render(); });
    $('chips').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (c) { view = c.dataset.view; render(); } });
    $('list').addEventListener('click', onListClick);
    Store.onChange(load);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    paintIcons();
    wire();
    await detectTab();
    await load();
    $('search').focus();
  });
})();
