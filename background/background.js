// ============================================================
// Capsule Flow — background service worker
// Context menus, keyboard commands, and a helper that makes sure
// the content script is present before talking to a tab.
// ============================================================
importScripts('../shared/platforms.js', '../shared/store.js', '../shared/format.js');

const CONTENT_FILES = [
  'shared/platforms.js',
  'shared/store.js',
  'shared/format.js',
  'shared/icons.js',
  'content/widget-styles.js',
  'content/content.js',
];

const SUPPORTED_PATTERNS = CFPlatforms.PLATFORMS.flatMap((p) => p.hosts.map((h) => 'https://' + h + '/*'));

function isSupportedUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !!CFPlatforms.detect(u.hostname);
  } catch (_) {
    return false;
  }
}

function sendToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (res) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(res || null);
    });
  });
}

// Tabs that were open before the extension was installed/updated don't have
// the content script yet — inject it on demand.
async function ensureContent(tab) {
  if (!tab || tab.id == null) return false;
  const pong = await sendToTab(tab.id, { type: 'CF_PING' });
  if (pong && pong.ok) return true;
  if (!isSupportedUrl(tab.url || '')) return false;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES });
    const again = await sendToTab(tab.id, { type: 'CF_PING' });
    return !!(again && again.ok);
  } catch (e) {
    console.warn('[Capsule Flow] could not inject content script', e);
    return false;
  }
}

async function sendWithEnsure(tab, message) {
  const ok = await ensureContent(tab);
  if (!ok) return { ok: false, error: 'unsupported' };
  return (await sendToTab(tab.id, message)) || { ok: false, error: 'no-response' };
}

function flashBadge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color: color || '#0d9488' });
  chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2500);
}

// ─── Install / update ─────────────────────────────────────────
function setupMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'cf-save-selection', title: 'Save selection as capsule', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'cf-capture-chat', title: 'Capture this chat as a capsule', contexts: ['page'], documentUrlPatterns: SUPPORTED_PATTERNS });
    chrome.contextMenus.create({ id: 'cf-open-panel', title: 'Open Capsule Flow panel', contexts: ['page', 'editable'], documentUrlPatterns: SUPPORTED_PATTERNS });
    chrome.contextMenus.create({ id: 'cf-dashboard', title: 'Open Capsule Flow dashboard', contexts: ['action'] });
  });
}

chrome.runtime.onInstalled.addListener(async (details) => {
  setupMenus();
  try { await CFStore.migrate(); } catch (e) { console.warn('[Capsule Flow] migration skipped', e); }
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#welcome') });
  }
});

chrome.runtime.onStartup.addListener(setupMenus);

// ─── Context menus ────────────────────────────────────────────
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'cf-dashboard') {
    chrome.runtime.openOptionsPage();
    return;
  }
  if (info.menuItemId === 'cf-capture-chat') {
    await sendWithEnsure(tab, { type: 'CF_CAPTURE_CHAT' });
    return;
  }
  if (info.menuItemId === 'cf-open-panel') {
    await sendWithEnsure(tab, { type: 'CF_OPEN_PANEL' });
    return;
  }
  if (info.menuItemId === 'cf-save-selection' && info.selectionText) {
    // On AI sites, open the editor in-page so the user can title/tag it.
    if (tab && isSupportedUrl(tab.url || '')) {
      const res = await sendWithEnsure(tab, { type: 'CF_CAPTURE_SELECTION', text: info.selectionText });
      if (res && res.ok) return;
    }
    // Anywhere else, save straight away.
    const text = info.selectionText.trim();
    let host = '';
    try { host = new URL(tab.url).hostname; } catch (_) {}
    await CFStore.saveCapsule({
      title: CFFormat.clip(text.split('\n')[0], 70),
      content: text,
      platform: (CFPlatforms.detect(host) || { id: 'web' }).id,
      sourceUrl: tab ? tab.url : '',
      tags: host ? [host.replace(/^www\./, '').split('.')[0]] : [],
    });
    flashBadge('✓');
  }
});

// ─── Keyboard commands ────────────────────────────────────────
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (!tab) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const type = command === 'capture-chat' ? 'CF_CAPTURE_CHAT' : 'CF_TOGGLE_PANEL';
  const res = await sendWithEnsure(tab, { type });
  if (!res || !res.ok) flashBadge('—', '#64748b');
});

// ─── Messages from popup / pages ──────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;
  if (msg.type === 'CF_OPEN_DASHBOARD') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === 'CF_TAB_SEND') {
    chrome.tabs.get(msg.tabId, async (tab) => {
      if (chrome.runtime.lastError || !tab) { sendResponse({ ok: false, error: 'no-tab' }); return; }
      sendResponse(await sendWithEnsure(tab, msg.message));
    });
    return true; // async
  }
});
