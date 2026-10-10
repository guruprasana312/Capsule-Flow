// ============================================================
// Capsule Flow — Popup Script
// ============================================================

// ─── State ──────────────────────────────────────────────────
let capsules = [];
let folders = [];
let prefs = {};
let editingId = null;
let activeTab = 'all';
let activeFolderId = null;
let searchQuery = '';
let sortBy = 'updatedAt';
let captureTags = [];

// ─── Elements ───────────────────────────────────────────────
const $ = id => document.getElementById(id);
const capsuleListEl = $('capsule-list');
const emptyStateEl = $('empty-state');
const loadingEl = $('loading');
const searchEl = $('search');
const searchClearEl = $('search-clear');
const sortSelectEl = $('sort-select');
const folderBarEl = $('folder-bar');
const folderListEl = $('folder-list');

// ─── Boot ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadPrefs();
  await Promise.all([loadCapsules(), loadFolders()]);
  renderCapsuleList();
  setupEventListeners();
  detectCurrentPlatform();
});

// ─── Data Loading ────────────────────────────────────────────
async function loadCapsules() {
  try {
    capsules = await msg({
      type: 'CF_GET_CAPSULES',
      query: searchQuery,
      filters: { folderId: activeFolderId, sortBy },
    }) || [];
  } catch (e) { capsules = []; }
}

async function loadFolders() {
  try {
    folders = await msg({ type: 'CF_GET_FOLDERS' }) || [];
  } catch (e) { folders = []; }
}

async function loadPrefs() {
  try { prefs = await msg({ type: 'CF_GET_PREFS' }) || {}; } catch (_) {}
  sortBy = prefs.sortBy || 'updatedAt';
  if (sortSelectEl) sortSelectEl.value = sortBy;
}

// ─── Messaging ───────────────────────────────────────────────
function msg(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, res => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (res && !res.success) reject(new Error(res.error || 'Unknown error'));
      else resolve(res ? res.data : null);
    });
  });
}

// ─── Render: Capsule List ─────────────────────────────────────
function renderCapsuleList() {
  loadingEl.style.display = 'none';

  let displayed = [...capsules];

  // Tab filter
  if (activeTab === 'starred') {
    displayed = displayed.filter(c => c.starred);
  } else if (activeTab === 'recent') {
    displayed = displayed
      .sort((a, b) => new Date(b.lastUsedAt || b.updatedAt) - new Date(a.lastUsedAt || a.updatedAt))
      .slice(0, 20);
  }

  // Clear list
  capsuleListEl.innerHTML = '';

  if (displayed.length === 0) {
    emptyStateEl.style.display = 'flex';
    const count = capsuleListEl.parentElement?.querySelector('.caps-count');
    if (count) count.remove();
    return;
  }

  emptyStateEl.style.display = 'none';

  // Count badge
  let countEl = document.querySelector('.caps-count');
  if (!countEl) {
    countEl = el('div', 'caps-count');
    capsuleListEl.before(countEl);
  }
  countEl.textContent = `${displayed.length} capsule${displayed.length !== 1 ? 's' : ''}`;

  displayed.forEach((capsule, i) => {
    const card = buildCapsuleCard(capsule, i);
    capsuleListEl.appendChild(card);
  });
}

function buildCapsuleCard(capsule, index) {
  const card = el('div', 'capsule-card');
  card.dataset.id = capsule.id;
  card.style.animationDelay = `${Math.min(index * 30, 200)}ms`;
  card.setAttribute('draggable', 'true');
  card.title = 'Drag this capsule into any chat or input';

  card.addEventListener('dragstart', (e) => {
    if (capsule && capsule.content) {
      e.dataTransfer.setData('text/plain', capsule.content);
      e.dataTransfer.setData('text/html', capsule.content);
      e.dataTransfer.effectAllowed = 'copy';
    }
  });

  const tags = (capsule.tags || []).slice(0, 3).map(t => `<span class="tag">${esc(t)}</span>`).join('');
  const date = fmtDate(capsule.updatedAt);
  const preview = (capsule.content || '').trim();

  card.innerHTML = `
    <div class="capsule-card__row1">
      <div class="capsule-card__title">💊 ${esc(capsule.title || 'Untitled Capsule')}</div>
      ${capsule.starred ? '<span class="capsule-card__star">⭐</span>' : ''}
    </div>
    <div class="capsule-card__preview">${esc(preview)}</div>
    <div class="capsule-card__footer">
      ${tags}
      ${capsule.usageCount ? `<span class="capsule-card__usage">Used ${capsule.usageCount}×</span>` : ''}
      <span class="capsule-card__date">${date}</span>
    </div>
    <div class="capsule-card__actions">
      <button class="card-btn inject-btn" title="Inject into active AI tab">⬆️</button>
      <button class="card-btn view-btn" title="View details">👁️</button>
      <button class="card-btn edit-btn" title="Edit">✏️</button>
      <button class="card-btn danger delete-btn" title="Delete">🗑️</button>
    </div>
  `;

  card.addEventListener('click', (e) => {
    if (e.target.closest('.capsule-card__actions')) return;
    openDetailModal(capsule);
  });
  card.querySelector('.inject-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    injectCapsule(capsule);
  });
  card.querySelector('.view-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openDetailModal(capsule);
  });
  card.querySelector('.edit-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openEditModal(capsule);
  });
  card.querySelector('.delete-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    confirmDelete(capsule);
  });

  return card;
}

// ─── Render: Folders ──────────────────────────────────────────
function renderFolderList() {
  folderListEl.innerHTML = '';

  // All capsules option
  const allItem = el('div', `folder-item${!activeFolderId ? ' active' : ''}`);
  allItem.innerHTML = `<span class="folder-item__icon">📋</span><span class="folder-item__name">All Capsules</span><span class="folder-item__count">${capsules.length}</span>`;
  allItem.addEventListener('click', () => setActiveFolder(null));
  folderListEl.appendChild(allItem);

  folders.forEach(f => {
    const count = capsules.filter(c => c.folderId === f.id).length;
    const item = el('div', `folder-item${activeFolderId === f.id ? ' active' : ''}`);
    item.innerHTML = `<span class="folder-item__icon">${f.icon || '📁'}</span><span class="folder-item__name">${esc(f.name)}</span><span class="folder-item__count">${count}</span>`;
    item.addEventListener('click', () => setActiveFolder(f.id));
    folderListEl.appendChild(item);
  });
}

async function setActiveFolder(id) {
  activeFolderId = id;
  await loadCapsules();
  renderCapsuleList();
  renderFolderList();
}

// ─── Capsule Actions ──────────────────────────────────────────
async function injectCapsule(capsule) {
  try {
    // Copy to clipboard right away while we are in a trusted user click gesture context
    await copyToClipboard(capsule.content);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      showBanner('📋 Copied to clipboard!', 'success');
      return;
    }

    chrome.tabs.sendMessage(tab.id, {
      type: 'CF_INJECT_CAPSULE',
      capsule,
    }, async (res) => {
      if (chrome.runtime.lastError || !res?.success) {
        showBanner('📋 Copied! Paste into the chat box.', 'info');
      } else {
        showBanner(`💊 "${trunc(capsule.title, 25)}" injected!`, 'success');
      }
      await msg({ type: 'CF_INCREMENT_USAGE', id: capsule.id });
    });
  } catch (e) {
    showBanner('📋 Copied to clipboard!', 'success');
  }
}

async function copyToClipboard(text) {
  if (!text) return;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch (_) {}

  // Fallback using document.execCommand
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand('copy');
    ta.remove();
  } catch (err) {
    console.warn('[CapsuleFlow] Copy fallback failed:', err);
  }
}

async function confirmDelete(capsule) {
  if (!confirm(`Delete "${capsule.title || 'this capsule'}"?`)) return;
  try {
    await msg({ type: 'CF_DELETE_CAPSULE', id: capsule.id });
    capsules = capsules.filter(c => c.id !== capsule.id);
    renderCapsuleList();
    showBanner('🗑️ Deleted', 'info');
  } catch (e) { showBanner('Delete failed: ' + e.message, 'error'); }
}

// ─── Capsule Modal ────────────────────────────────────────────
function openNewModal() {
  editingId = null;
  captureTags = [];
  $('cap-title').value = '';
  $('cap-content').value = '';
  $('cap-starred').checked = false;
  updateCharCount();
  populateFolderSelect();
  renderModalTags();
  $('modal-title').textContent = 'New Capsule';
  $('modal-overlay').style.display = 'flex';
  setTimeout(() => $('cap-title').focus(), 100);
}

function openEditModal(capsule) {
  editingId = capsule.id;
  captureTags = [...(capsule.tags || [])];
  $('cap-title').value = capsule.title || '';
  $('cap-content').value = capsule.content || '';
  $('cap-starred').checked = capsule.starred || false;
  updateCharCount();
  populateFolderSelect(capsule.folderId);
  renderModalTags();
  $('modal-title').textContent = 'Edit Capsule';
  $('modal-overlay').style.display = 'flex';
}

function closeModal() {
  $('modal-overlay').style.display = 'none';
  editingId = null;
}

async function saveModal() {
  const title = $('cap-title').value.trim();
  const content = $('cap-content').value.trim();
  const folderId = $('cap-folder').value || null;
  const starred = $('cap-starred').checked;

  if (!content) { showBanner('Content cannot be empty!', 'error'); return; }

  const saveBtn = $('modal-save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  try {
    const capsule = {
      ...(editingId ? { id: editingId } : {}),
      title: title || content.substring(0, 60) + (content.length > 60 ? '…' : ''),
      content,
      tags: captureTags,
      folderId,
      starred,
    };

    const saved = await msg({ type: 'CF_SAVE_CAPSULE', capsule });

    if (editingId) {
      const idx = capsules.findIndex(c => c.id === editingId);
      if (idx !== -1) capsules[idx] = saved;
    } else {
      capsules.unshift(saved);
    }

    closeModal();
    renderCapsuleList();
    showBanner(editingId ? '✅ Updated!' : '💊 Saved!', 'success');
  } catch (e) {
    showBanner('Save failed: ' + e.message, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '💊 Save';
  }
}

function populateFolderSelect(selectedId = null) {
  const sel = $('cap-folder');
  sel.innerHTML = '<option value="">— No Folder —</option>';
  folders.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = f.name;
    if (f.id === selectedId) opt.selected = true;
    sel.appendChild(opt);
  });
}

// ─── Tag Handling ─────────────────────────────────────────────
function addTag(tag) {
  const clean = tag.toLowerCase().replace(/[^a-z0-9\-_ ]/g, '').trim();
  if (clean && !captureTags.includes(clean) && captureTags.length < 10) {
    captureTags.push(clean);
    renderModalTags();
  }
}

function renderModalTags() {
  const wrapper = $('tags-input-wrapper');
  const input = $('tags-input');
  wrapper.querySelectorAll('.tag-chip').forEach(t => t.remove());
  captureTags.forEach(tag => {
    const chip = el('span', 'tag-chip');
    chip.innerHTML = `${esc(tag)} <span class="tag-chip__remove">✕</span>`;
    chip.querySelector('.tag-chip__remove').addEventListener('click', () => {
      captureTags = captureTags.filter(t => t !== tag);
      renderModalTags();
    });
    wrapper.insertBefore(chip, input);
  });
}

// ─── Detail Modal ─────────────────────────────────────────────
function openDetailModal(capsule) {
  $('detail-title').textContent = capsule.title || 'Untitled Capsule';
  $('detail-content').textContent = capsule.content || '';
  const tags = (capsule.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join(' ');
  $('detail-meta').innerHTML = `
    ${tags}
    ${capsule.starred ? '<span class="tag">⭐ Starred</span>' : ''}
    <span style="font-size:10px;color:var(--text-dim)">Updated ${fmtDate(capsule.updatedAt)}</span>
    ${capsule.usageCount ? `<span style="font-size:10px;color:var(--text-dim)">Used ${capsule.usageCount}×</span>` : ''}
  `;
  $('detail-edit-btn').onclick = () => { closeDetailModal(); openEditModal(capsule); };
  $('detail-copy-btn').onclick = async () => {
    await copyToClipboard(capsule.content || '');
    showBanner('📋 Copied!', 'success');
    await msg({ type: 'CF_INCREMENT_USAGE', id: capsule.id });
  };
  $('detail-overlay').style.display = 'flex';
}

function closeDetailModal() {
  $('detail-overlay').style.display = 'none';
}

// ─── Capture (from active tab) ─────────────────────────────────
async function captureFromActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) { openNewModal(); return; }

    chrome.tabs.sendMessage(tab.id, { type: 'CF_CAPTURE_PAGE' }, res => {
      if (chrome.runtime.lastError) {
        openNewModal();
      } else {
        window.close();
      }
    });
  } catch (_) { openNewModal(); }
}

// ─── Folders ──────────────────────────────────────────────────
async function promptNewFolder() {
  const name = prompt('Folder name:');
  if (!name?.trim()) return;
  try {
    const folder = await msg({
      type: 'CF_SAVE_FOLDER',
      folder: { name: name.trim(), icon: '📁' },
    });
    folders.push(folder);
    renderFolderList();
    showBanner(`📁 "${name.trim()}" created`, 'success');
  } catch (e) { showBanner('Failed to create folder', 'error'); }
}

// ─── Import/Export ────────────────────────────────────────────
async function handleExport() {
  try {
    const data = await msg({ type: 'CF_EXPORT' });
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `capsule-flow-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showBanner('📦 Exported!', 'success');
  } catch (e) { showBanner('Export failed', 'error'); }
}

// ─── Platform Detection ───────────────────────────────────────
async function detectCurrentPlatform() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;
    const url = new URL(tab.url);
    const host = url.hostname;
    const platformNames = {
      'chatgpt.com': 'ChatGPT', 'chat.openai.com': 'ChatGPT',
      'claude.ai': 'Claude',
      'gemini.google.com': 'Gemini',
      'deepseek.com': 'DeepSeek', 'chat.deepseek.com': 'DeepSeek',
      'perplexity.ai': 'Perplexity',
      'grok.x.ai': 'Grok', 'grok.com': 'Grok',
      'copilot.microsoft.com': 'Copilot',
    };
    const name = Object.entries(platformNames).find(([k]) => host.includes(k))?.[1];
    if (name) {
      const badge = $('platform-badge');
      if (badge) {
        badge.textContent = `Active: ${name}`;
        badge.style.color = 'var(--accent-light)';
      }
    }
  } catch (_) {}
}

// ─── Sync ────────────────────────────────────────────────────
async function triggerSync() {
  const syncBtn = $('sync-btn');
  syncBtn.classList.add('spinning');
  try {
    const res = await msg({ type: 'CF_SYNC_NOW' });
    await loadCapsules();
    renderCapsuleList();
    const synced = res?.synced || 0;
    showBanner(synced > 0 ? `🔄 Synced ${synced} capsule${synced > 1 ? 's' : ''}` : '✅ Up to date', 'success');
  } catch (e) {
    showBanner('Sync failed: ' + (e.message || 'Try again'), 'error');
  } finally {
    syncBtn.classList.remove('spinning');
  }
}

// ─── Banner / Toast ───────────────────────────────────────────
function showBanner(message, type = 'info') {
  const existing = document.querySelector('.popup-banner');
  if (existing) existing.remove();

  const colors = {
    success: 'rgba(45,190,108,0.12)',
    error: 'rgba(255,77,109,0.12)',
    info: 'rgba(74,158,255,0.1)',
    warning: 'rgba(245,166,35,0.1)',
  };
  const borders = {
    success: 'rgba(45,190,108,0.3)',
    error: 'rgba(255,77,109,0.3)',
    info: 'rgba(74,158,255,0.25)',
    warning: 'rgba(245,166,35,0.25)',
  };

  const banner = el('div', 'popup-banner');
  Object.assign(banner.style, {
    position: 'fixed',
    bottom: '56px',
    left: '12px',
    right: '12px',
    padding: '9px 14px',
    borderRadius: '9px',
    background: colors[type] || colors.info,
    border: `1px solid ${borders[type] || borders.info}`,
    color: 'var(--text)',
    fontSize: '12px',
    fontWeight: '500',
    zIndex: '999',
    animation: 'modal-in 0.2s ease',
    boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
  });
  banner.textContent = message;
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 3000);
}

// ─── Char Counter ─────────────────────────────────────────────
function updateCharCount() {
  const content = $('cap-content')?.value || '';
  const count = content.length;
  const max = 50000;
  const countEl = $('char-count');
  if (!countEl) return;
  countEl.textContent = `${count.toLocaleString()} / ${max.toLocaleString()}`;
  countEl.className = 'char-count' + (count > max * 0.95 ? ' at-limit' : count > max * 0.8 ? ' near-limit' : '');
}

// ─── Event Listeners ─────────────────────────────────────────
function setupEventListeners() {
  // Header
  $('settings-btn')?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Search
  searchEl?.addEventListener('input', debounce(async (e) => {
    searchQuery = e.target.value.trim();
    searchClearEl.style.display = searchQuery ? 'block' : 'none';
    await loadCapsules();
    renderCapsuleList();
  }, 280));

  searchClearEl?.addEventListener('click', async () => {
    searchEl.value = '';
    searchQuery = '';
    searchClearEl.style.display = 'none';
    await loadCapsules();
    renderCapsuleList();
  });

  // Sort
  sortSelectEl?.addEventListener('change', async (e) => {
    sortBy = e.target.value;
    await msg({ type: 'CF_SAVE_PREFS', prefs: { sortBy } });
    await loadCapsules();
    renderCapsuleList();
  });

  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', async () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('tab--active'));
      tab.classList.add('tab--active');
      activeTab = tab.dataset.tab;
      folderBarEl.style.display = activeTab === 'folders' ? 'block' : 'none';
      if (activeTab === 'folders') {
        renderFolderList();
      } else {
        activeFolderId = null;
        await loadCapsules();
        renderCapsuleList();
      }
    });
  });

  // Footer
  $('capture-btn')?.addEventListener('click', captureFromActiveTab);
  $('new-btn')?.addEventListener('click', openNewModal);
  $('export-btn')?.addEventListener('click', handleExport);

  // Folder
  $('folder-add-btn')?.addEventListener('click', promptNewFolder);

  // Capsule modal
  $('modal-close')?.addEventListener('click', closeModal);
  $('modal-cancel')?.addEventListener('click', closeModal);
  $('modal-save')?.addEventListener('click', saveModal);
  $('modal-overlay')?.addEventListener('click', (e) => {
    if (e.target === $('modal-overlay')) closeModal();
  });

  // Tag input
  $('tags-input')?.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ',') && e.target.value.trim()) {
      e.preventDefault();
      addTag(e.target.value.trim());
      e.target.value = '';
    } else if (e.key === 'Backspace' && !e.target.value && captureTags.length > 0) {
      captureTags.pop();
      renderModalTags();
    }
  });

  // Char counter
  $('cap-content')?.addEventListener('input', updateCharCount);

  // Detail modal
  $('detail-close')?.addEventListener('click', closeDetailModal);
  $('detail-overlay')?.addEventListener('click', (e) => {
    if (e.target === $('detail-overlay')) closeDetailModal();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if ($('modal-overlay').style.display !== 'none') { closeModal(); return; }
      if ($('detail-overlay').style.display !== 'none') { closeDetailModal(); return; }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
      e.preventDefault();
      openNewModal();
    }
  });
}

// ─── Helpers ─────────────────────────────────────────────────
function el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function trunc(str, len) {
  return str.length <= len ? str : str.substring(0, len) + '…';
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = Date.now() - d;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
  return d.toLocaleDateString();
}

function debounce(fn, ms) {
  let t;
  return function (...a) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, a), ms);
  };
}
