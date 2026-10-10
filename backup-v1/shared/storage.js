// ============================================================
// Capsule Flow — Local Storage Manager
// Handles browser-local Chrome storage (100% offline, private)
// ============================================================

import { STORAGE_KEYS, APP_CONSTANTS } from './config.js';

// ─── Capsule CRUD ────────────────────────────────────────────

export async function getAllCapsules() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.CAPSULES);
  return data[STORAGE_KEYS.CAPSULES] || [];
}

export async function getCapsuleById(id) {
  const capsules = await getAllCapsules();
  return capsules.find(c => c.id === id) || null;
}

export async function saveCapsule(capsule) {
  const capsules = await getAllCapsules();
  const now = new Date().toISOString();

  if (!capsule.id) {
    // New capsule
    capsule.id = generateId();
    capsule.createdAt = now;
    capsule.updatedAt = now;
    capsule.usageCount = 0;
    capsule.isSynced = false;
    capsule.versions = [];
    capsules.unshift(capsule);
  } else {
    // Update existing
    const idx = capsules.findIndex(c => c.id === capsule.id);
    if (idx !== -1) {
      const old = capsules[idx];
      // Store version history
      const versions = old.versions || [];
      if (old.content !== capsule.content) {
        versions.unshift({
          content: old.content,
          updatedAt: old.updatedAt,
          timestamp: Date.now(),
        });
        if (versions.length > APP_CONSTANTS.CAPSULE_VERSIONS_LIMIT) {
          versions.splice(APP_CONSTANTS.CAPSULE_VERSIONS_LIMIT);
        }
      }
      capsule.versions = versions;
      capsule.updatedAt = now;
      capsule.isSynced = false;
      capsules[idx] = { ...old, ...capsule };
    } else {
      capsule.createdAt = now;
      capsule.updatedAt = now;
      capsule.usageCount = 0;
      capsule.isSynced = false;
      capsule.versions = [];
      capsules.unshift(capsule);
    }
  }

  await chrome.storage.local.set({ [STORAGE_KEYS.CAPSULES]: capsules });
  return capsule;
}

export async function deleteCapsule(id) {
  const capsules = await getAllCapsules();
  const filtered = capsules.filter(c => c.id !== id);
  await chrome.storage.local.set({ [STORAGE_KEYS.CAPSULES]: filtered });
  return true;
}

export async function incrementUsage(id) {
  const capsules = await getAllCapsules();
  const idx = capsules.findIndex(c => c.id === id);
  if (idx !== -1) {
    capsules[idx].usageCount = (capsules[idx].usageCount || 0) + 1;
    capsules[idx].lastUsedAt = new Date().toISOString();
    await chrome.storage.local.set({ [STORAGE_KEYS.CAPSULES]: capsules });
  }
}

export async function searchCapsules(query, { folderId, tags, sortBy = 'updatedAt' } = {}) {
  let capsules = await getAllCapsules();

  // Filter by folder
  if (folderId) {
    capsules = capsules.filter(c => c.folderId === folderId);
  }

  // Filter by tags
  if (tags && tags.length > 0) {
    capsules = capsules.filter(c => {
      const capTags = c.tags || [];
      return tags.every(t => capTags.includes(t));
    });
  }

  // Text search
  if (query && query.trim()) {
    const q = query.toLowerCase().trim();
    capsules = capsules.filter(c => {
      return (
        (c.title || '').toLowerCase().includes(q) ||
        (c.content || '').toLowerCase().includes(q) ||
        (c.tags || []).some(t => t.toLowerCase().includes(q))
      );
    });
  }

  // Sort
  capsules.sort((a, b) => {
    switch (sortBy) {
      case 'usage':
        return (b.usageCount || 0) - (a.usageCount || 0);
      case 'createdAt':
        return new Date(b.createdAt) - new Date(a.createdAt);
      case 'title':
        return (a.title || '').localeCompare(b.title || '');
      default: // updatedAt
        return new Date(b.updatedAt) - new Date(a.updatedAt);
    }
  });

  return capsules;
}

// ─── Folder CRUD ──────────────────────────────────────────────

export async function getAllFolders() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.FOLDERS);
  return data[STORAGE_KEYS.FOLDERS] || [];
}

export async function saveFolder(folder) {
  const folders = await getAllFolders();
  const now = new Date().toISOString();

  if (!folder.id) {
    folder.id = generateId();
    folder.createdAt = now;
    folders.push(folder);
  } else {
    const idx = folders.findIndex(f => f.id === folder.id);
    if (idx !== -1) {
      folders[idx] = { ...folders[idx], ...folder };
    } else {
      folders.push(folder);
    }
  }

  await chrome.storage.local.set({ [STORAGE_KEYS.FOLDERS]: folders });
  return folder;
}

export async function deleteFolder(id, reassignFolderId = null) {
  const folders = await getAllFolders();
  const filtered = folders.filter(f => f.id !== id);
  await chrome.storage.local.set({ [STORAGE_KEYS.FOLDERS]: filtered });

  // Move capsules out of deleted folder
  const capsules = await getAllCapsules();
  const updated = capsules.map(c =>
    c.folderId === id ? { ...c, folderId: reassignFolderId } : c
  );
  await chrome.storage.local.set({ [STORAGE_KEYS.CAPSULES]: updated });
  return true;
}

// ─── User Preferences ─────────────────────────────────────────

export async function getUserPrefs() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.USER_PREFS);
  return {
    theme: 'night',
    sortBy: 'updatedAt',
    injectMode: 'append',
    showFloatingButton: true,
    floatingButtonPosition: 'bottom-left',
    keyboardShortcutEnabled: true,
    autoCapturePlatforms: [],
    defaultFolder: null,
    defaultTags: [],
    ...data[STORAGE_KEYS.USER_PREFS],
  };
}

export async function saveUserPrefs(prefs) {
  const current = await getUserPrefs();
  const merged = { ...current, ...prefs };
  await chrome.storage.local.set({ [STORAGE_KEYS.USER_PREFS]: merged });
  return merged;
}



// ─── Import / Export ──────────────────────────────────────────

export async function exportData() {
  const capsules = await getAllCapsules();
  const folders = await getAllFolders();
  const prefs = await getUserPrefs();
  return {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    capsules,
    folders,
    prefs,
  };
}

export async function importData(data) {
  if (!data || !data.capsules) throw new Error('Invalid export file');
  const existing = await getAllCapsules();
  const existingIds = new Set(existing.map(c => c.id));
  const newCapsules = data.capsules.filter(c => !existingIds.has(c.id));
  await chrome.storage.local.set({
    [STORAGE_KEYS.CAPSULES]: [...existing, ...newCapsules],
  });
  if (data.folders) {
    const existingFolders = await getAllFolders();
    const existingFolderIds = new Set(existingFolders.map(f => f.id));
    const newFolders = data.folders.filter(f => !existingFolderIds.has(f.id));
    await chrome.storage.local.set({
      [STORAGE_KEYS.FOLDERS]: [...existingFolders, ...newFolders],
    });
  }
  return { imported: newCapsules.length };
}

// ─── Utility ──────────────────────────────────────────────────

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

export function sanitizeTags(tags) {
  return [...new Set(
    tags
      .map(t => t.trim().toLowerCase().replace(/[^a-z0-9\-_ ]/g, '').trim())
      .filter(t => t.length > 0 && t.length <= APP_CONSTANTS.MAX_TAG_LENGTH)
  )].slice(0, APP_CONSTANTS.MAX_TAGS_PER_CAPSULE);
}
