// ============================================================
// Capsule Flow — Options/Settings Page Script
// ============================================================

const AI_PLATFORMS = [
  { name: 'ChatGPT', icon: '🤖', url: 'chatgpt.com / chat.openai.com' },
  { name: 'Claude', icon: '⚡', url: 'claude.ai' },
  { name: 'Gemini', icon: '✨', url: 'gemini.google.com' },
  { name: 'DeepSeek', icon: '🔍', url: 'chat.deepseek.com' },
  { name: 'Perplexity', icon: '🔮', url: 'perplexity.ai' },
  { name: 'Grok', icon: '💡', url: 'grok.x.ai / grok.com' },
  { name: 'Microsoft Copilot', icon: '🪟', url: 'copilot.microsoft.com' },
  { name: 'Poe', icon: '🦋', url: 'poe.com' },
  { name: 'Character.AI', icon: '🎭', url: 'character.ai' },
  { name: 'Bing Chat', icon: '🔵', url: 'bing.com/chat' },
];

// ─── State ──────────────────────────────────────────────────
let prefs = {};

// ─── DOM ────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ─── Boot ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadAll();
  setupNav();
  setupGeneralSettings();
  renderPlatforms();
  setupDataSection();
  handleWelcomeHash();
});

async function loadAll() {
  try {
    prefs = await msg({ type: 'CF_GET_PREFS' }) || {};
  } catch (e) {
    prefs = {};
  }
}

// ─── Navigation ──────────────────────────────────────────────
function setupNav() {
  const navItems = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('.section');

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const target = item.dataset.section;

      navItems.forEach(n => n.classList.remove('nav-item--active'));
      sections.forEach(s => s.classList.add('hidden'));

      item.classList.add('nav-item--active');
      const sec = document.getElementById(`section-${target}`);
      if (sec) sec.classList.remove('hidden');
    });
  });
}

function handleWelcomeHash() {
  if (location.hash === '#welcome') {
    // Switch to about section
    document.querySelector('[data-section="about"]')?.click();
  } else if (location.hash === '#account') {
    document.querySelector('[data-section="account"]')?.click();
  }
}

// ─── General Settings ────────────────────────────────────────
function setupGeneralSettings() {
  // Populate with current prefs
  if ($('pref-show-fab')) $('pref-show-fab').checked = prefs.showFloatingButton !== false;
  if ($('pref-fab-position')) $('pref-fab-position').value = prefs.floatingButtonPosition || 'bottom-right';
  if ($('pref-inject-mode')) $('pref-inject-mode').value = prefs.injectMode || 'append';
  if ($('pref-sort-by')) $('pref-sort-by').value = prefs.sortBy || 'updatedAt';

  $('save-general-btn')?.addEventListener('click', async () => {
    const newPrefs = {
      showFloatingButton: $('pref-show-fab')?.checked ?? true,
      floatingButtonPosition: $('pref-fab-position')?.value || 'bottom-right',
      injectMode: $('pref-inject-mode')?.value || 'append',
      sortBy: $('pref-sort-by')?.value || 'updatedAt',
    };

    try {
      await msg({ type: 'CF_SAVE_PREFS', prefs: newPrefs });
      Object.assign(prefs, newPrefs);
      showToast('✅ Settings saved!');
    } catch (e) {
      showToast('❌ Failed to save: ' + e.message);
    }
  });
}

// ─── Platforms ────────────────────────────────────────────────
function renderPlatforms() {
  const grid = $('platforms-grid');
  if (!grid) return;
  grid.innerHTML = AI_PLATFORMS.map(p => `
    <div class="platform-item">
      <div class="platform-icon">${p.icon}</div>
      <div class="platform-info">
        <div class="platform-name">${esc(p.name)}</div>
        <div class="platform-url">${esc(p.url)}</div>
      </div>
      <span class="platform-status">Active</span>
    </div>
  `).join('');
}

// ─── Data Section ─────────────────────────────────────────────
function setupDataSection() {
  // Export
  $('export-btn')?.addEventListener('click', async () => {
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
      showToast('📦 Export successful!');
    } catch (e) { showToast('❌ Export failed: ' + e.message); }
  });

  // Import
  $('import-btn')?.addEventListener('click', () => $('import-file')?.click());
  $('import-file')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const result = await msg({ type: 'CF_IMPORT', data });
      $('import-status').textContent = `✅ Imported ${result.imported} capsule(s)`;
      showToast(`✅ Imported ${result.imported} capsule(s)!`);
    } catch (e) {
      $('import-status').textContent = '❌ Import failed';
      showToast('❌ Import failed: ' + e.message);
    }
    e.target.value = '';
  });

  // Clear data
  $('clear-data-btn')?.addEventListener('click', async () => {
    if (!confirm('⚠️ This will permanently delete ALL local capsules and folders. This cannot be undone.\n\nAre you sure?')) return;
    try {
      await chrome.storage.local.clear();
      showToast('🗑️ All local data deleted');
    } catch (e) { showToast('❌ Failed to clear data'); }
  });
}

// ─── Toast ───────────────────────────────────────────────────
let toastTimer = null;
function showToast(message) {
  const toast = $('options-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.style.display = 'block';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 3500);
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

// ─── Helpers ─────────────────────────────────────────────────
function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
