// ============================================================
// Capsule Flow — Background Service Worker
// ============================================================

import { getAllCapsules, saveCapsule } from '../shared/storage.js';
import { STORAGE_KEYS } from '../shared/config.js';

// ─── Extension Lifecycle ──────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    console.log('[CapsuleFlow] Extension installed');
    setupContextMenus();
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#welcome') });
  } else if (details.reason === 'update') {
    setupContextMenus();
  }
});

chrome.runtime.onStartup.addListener(() => {
  setupContextMenus();
});

// ─── Context Menus ────────────────────────────────────────────

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'cf-capture-selection',
      title: '💊 Save as Capsule',
      contexts: ['selection'],
    });

    chrome.contextMenus.create({
      id: 'cf-capture-page',
      title: '💊 Save Page Summary as Capsule',
      contexts: ['page'],
    });

    chrome.contextMenus.create({
      id: 'cf-open-popup',
      title: '🚀 Open Capsule Flow',
      contexts: ['page'],
    });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'cf-capture-selection' && info.selectionText) {
    await handleCaptureSelection(info.selectionText, tab);
  } else if (info.menuItemId === 'cf-capture-page') {
    chrome.tabs.sendMessage(tab.id, { type: 'CF_CAPTURE_PAGE' });
  } else if (info.menuItemId === 'cf-open-popup') {
    chrome.action.openPopup();
  }
});

async function handleCaptureSelection(text, tab) {
  const title = text.substring(0, 60) + (text.length > 60 ? '...' : '');
  const capsule = {
    title,
    content: text,
    tags: [],
    folderId: null,
    source: new URL(tab.url).hostname,
  };
  await saveCapsule(capsule);
  chrome.tabs.sendMessage(tab.id, {
    type: 'CF_SHOW_TOAST',
    message: '💊 Capsule saved!',
    variant: 'success',
  });
}

// ─── Keyboard Commands ────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'capture-selection') {
    chrome.tabs.sendMessage(tab.id, { type: 'CF_CAPTURE_SELECTION_COMMAND' });
  } else if (command === 'open-capsule-flow') {
    chrome.tabs.sendMessage(tab.id, { type: 'CF_TOGGLE_PANEL' });
  }
});

// ─── Message Routing ──────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => {
    sendResponse({ success: false, error: err.message });
  });
  return true; // Keep channel open for async
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'CF_GET_CAPSULES':
      const { getAllCapsules: gc, searchCapsules } = await import('../shared/storage.js');
      const { searchCapsules: sc } = await import('../shared/storage.js');
      return { success: true, data: await sc(message.query || '', message.filters || {}) };

    case 'CF_SAVE_CAPSULE': {
      const { saveCapsule: save } = await import('../shared/storage.js');
      const saved = await save(message.capsule);
      return { success: true, data: saved };
    }

    case 'CF_DELETE_CAPSULE': {
      const { deleteCapsule } = await import('../shared/storage.js');
      await deleteCapsule(message.id);
      return { success: true };
    }

    case 'CF_INCREMENT_USAGE': {
      const { incrementUsage } = await import('../shared/storage.js');
      await incrementUsage(message.id);
      return { success: true };
    }

    case 'CF_GET_FOLDERS': {
      const { getAllFolders } = await import('../shared/storage.js');
      return { success: true, data: await getAllFolders() };
    }

    case 'CF_SAVE_FOLDER': {
      const { saveFolder } = await import('../shared/storage.js');
      const folder = await saveFolder(message.folder);
      return { success: true, data: folder };
    }

    case 'CF_DELETE_FOLDER': {
      const { deleteFolder } = await import('../shared/storage.js');
      await deleteFolder(message.id, message.reassignFolderId);
      return { success: true };
    }

    case 'CF_GET_PREFS': {
      const { getUserPrefs } = await import('../shared/storage.js');
      return { success: true, data: await getUserPrefs() };
    }

    case 'CF_SAVE_PREFS': {
      const { saveUserPrefs } = await import('../shared/storage.js');
      const prefs = await saveUserPrefs(message.prefs);
      return { success: true, data: prefs };
    }

    case 'CF_EXPORT': {
      const { exportData } = await import('../shared/storage.js');
      return { success: true, data: await exportData() };
    }

    case 'CF_IMPORT': {
      const { importData } = await import('../shared/storage.js');
      const result = await importData(message.data);
      return { success: true, data: result };
    }

    default:
      return { success: false, error: 'Unknown message type' };
  }
}
