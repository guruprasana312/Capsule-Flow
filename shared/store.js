// ============================================================
// Capsule Flow — Local storage layer (chrome.storage.local)
// Everything stays on this device. No accounts, no servers.
// ============================================================
(function (global) {
  'use strict';

  const KEYS = { capsules: 'cf_capsules', folders: 'cf_folders', prefs: 'cf_prefs' };

  const DEFAULT_PREFS = {
    theme: 'aurora',            // aurora | daylight | ember
    showFab: true,
    fabPosition: 'bottom-right', // bottom-right | bottom-left
    injectMode: 'append',       // append | prepend | replace
    captureFormat: 'brief',     // brief (summary + recent turns) | full (whole transcript)
    recentTurns: 6,
    maxChars: 16000,
    includeHeader: true,        // wrap the capsule in an instruction prompt when pasting
    promptGoal: 'greet',        // greet | continue | none
    promptVersion: 2,
    sortBy: 'updatedAt',
  };

  const LIMITS = { title: 120, content: 200000, tags: 12, tagLength: 32, versions: 10 };

  const area = () => chrome.storage.local;

  // Serialise writes made from this context so read-modify-write never interleaves.
  let queue = Promise.resolve();
  function serial(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  }

  async function read(key, fallback) {
    const data = await area().get(key);
    return data[key] === undefined ? fallback : data[key];
  }
  function write(key, value) {
    return area().set({ [key]: value });
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function cleanTags(tags) {
    if (!Array.isArray(tags)) tags = String(tags || '').split(',');
    const out = [];
    for (const t of tags) {
      const c = String(t).toLowerCase().replace(/[^a-z0-9\-_ ]/g, '').trim().slice(0, LIMITS.tagLength);
      if (c && !out.includes(c)) out.push(c);
    }
    return out.slice(0, LIMITS.tags);
  }

  function normalise(c) {
    return {
      id: c.id || uid(),
      title: String(c.title || 'Untitled capsule').slice(0, LIMITS.title),
      content: String(c.content || '').slice(0, LIMITS.content),
      messages: Array.isArray(c.messages) ? c.messages.filter((m) => m && m.text).map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: String(m.text) })) : [],
      brief: c.brief && typeof c.brief === 'object' ? c.brief : null,
      platform: c.platform || 'manual',
      sourceUrl: c.sourceUrl || c.source || '',
      tags: cleanTags(c.tags || []),
      folderId: c.folderId || null,
      starred: !!c.starred,
      usageCount: Number(c.usageCount) || 0,
      versions: Array.isArray(c.versions) ? c.versions.slice(0, LIMITS.versions) : [],
      createdAt: c.createdAt || new Date().toISOString(),
      updatedAt: c.updatedAt || c.createdAt || new Date().toISOString(),
      lastUsedAt: c.lastUsedAt || null,
    };
  }

  // ─── Capsules ───────────────────────────────────────────────
  async function getCapsules() {
    const list = await read(KEYS.capsules, []);
    return Array.isArray(list) ? list : [];
  }

  async function getCapsule(id) {
    return (await getCapsules()).find((c) => c.id === id) || null;
  }

  function saveCapsule(input) {
    return serial(async () => {
      const list = await getCapsules();
      const now = new Date().toISOString();
      const idx = input.id ? list.findIndex((c) => c.id === input.id) : -1;
      let saved;
      if (idx === -1) {
        saved = normalise({ ...input, createdAt: now, updatedAt: now, usageCount: 0, versions: [] });
        list.unshift(saved);
      } else {
        const old = list[idx];
        const versions = Array.isArray(old.versions) ? old.versions.slice() : [];
        if (input.content !== undefined && input.content !== old.content) {
          versions.unshift({ content: old.content, title: old.title, savedAt: old.updatedAt });
        }
        saved = normalise({ ...old, ...input, versions: versions.slice(0, LIMITS.versions), updatedAt: now });
        list[idx] = saved;
      }
      await write(KEYS.capsules, list);
      return saved;
    });
  }

  // Small updates that should not bump updatedAt or create versions.
  function patchCapsule(id, patch) {
    return serial(async () => {
      const list = await getCapsules();
      const idx = list.findIndex((c) => c.id === id);
      if (idx === -1) return null;
      list[idx] = { ...list[idx], ...patch };
      await write(KEYS.capsules, list);
      return list[idx];
    });
  }

  async function toggleStar(id) {
    const c = await getCapsule(id);
    if (!c) return null;
    return patchCapsule(id, { starred: !c.starred });
  }

  async function markUsed(id) {
    const c = await getCapsule(id);
    if (!c) return null;
    return patchCapsule(id, { usageCount: (c.usageCount || 0) + 1, lastUsedAt: new Date().toISOString() });
  }

  function deleteCapsule(id) {
    return serial(async () => {
      const list = await getCapsules();
      await write(KEYS.capsules, list.filter((c) => c.id !== id));
      return true;
    });
  }

  function duplicateCapsule(id) {
    return serial(async () => {
      const list = await getCapsules();
      const src = list.find((c) => c.id === id);
      if (!src) return null;
      const now = new Date().toISOString();
      const copy = normalise({ ...src, id: uid(), title: (src.title + ' (copy)').slice(0, LIMITS.title), createdAt: now, updatedAt: now, usageCount: 0, lastUsedAt: null, versions: [] });
      list.unshift(copy);
      await write(KEYS.capsules, list);
      return copy;
    });
  }

  function search(list, query, opts) {
    opts = opts || {};
    let out = list.slice();
    if (opts.folderId) out = out.filter((c) => c.folderId === opts.folderId);
    if (opts.starred) out = out.filter((c) => c.starred);
    if (opts.platform) out = out.filter((c) => c.platform === opts.platform);
    if (opts.tag) out = out.filter((c) => (c.tags || []).includes(opts.tag));
    const q = String(query || '').toLowerCase().trim();
    if (q) {
      const terms = q.split(/\s+/);
      out = out.filter((c) => {
        const hay = [c.title, c.content, (c.tags || []).join(' '), c.platform].join(' ').toLowerCase();
        return terms.every((t) => hay.includes(t));
      });
    }
    const sortBy = opts.sortBy || 'updatedAt';
    out.sort((a, b) => {
      if (sortBy === 'title') return (a.title || '').localeCompare(b.title || '');
      if (sortBy === 'usage') return (b.usageCount || 0) - (a.usageCount || 0);
      if (sortBy === 'recent') return new Date(b.lastUsedAt || b.updatedAt) - new Date(a.lastUsedAt || a.updatedAt);
      if (sortBy === 'createdAt') return new Date(b.createdAt) - new Date(a.createdAt);
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });
    // Starred float to the top unless sorting alphabetically
    if (sortBy !== 'title') out.sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0));
    return out;
  }

  // ─── Folders ────────────────────────────────────────────────
  async function getFolders() {
    const list = await read(KEYS.folders, []);
    return Array.isArray(list) ? list : [];
  }

  function saveFolder(folder) {
    return serial(async () => {
      const list = await getFolders();
      const name = String(folder.name || '').trim().slice(0, 40);
      if (!name) throw new Error('Folder name is required');
      const idx = folder.id ? list.findIndex((f) => f.id === folder.id) : -1;
      let saved;
      if (idx === -1) {
        saved = { id: uid(), name, createdAt: new Date().toISOString() };
        list.push(saved);
      } else {
        saved = { ...list[idx], name };
        list[idx] = saved;
      }
      await write(KEYS.folders, list);
      return saved;
    });
  }

  function deleteFolder(id) {
    return serial(async () => {
      const folders = await getFolders();
      await write(KEYS.folders, folders.filter((f) => f.id !== id));
      const caps = await getCapsules();
      await write(KEYS.capsules, caps.map((c) => (c.folderId === id ? { ...c, folderId: null } : c)));
      return true;
    });
  }

  // ─── Preferences ────────────────────────────────────────────
  async function getPrefs() {
    const p = await read(KEYS.prefs, {});
    const merged = { ...DEFAULT_PREFS, ...(p && typeof p === 'object' ? p : {}) };
    // Prefs saved before v2 default to the new "greet" closing reply.
    if (!p || p.promptVersion !== 2) { merged.promptGoal = 'greet'; merged.promptVersion = 2; }
    if (merged.promptGoal === 'acknowledge') merged.promptGoal = 'greet';
    return merged;
  }

  function savePrefs(patch) {
    return serial(async () => {
      const merged = { ...(await getPrefs()), ...patch };
      await write(KEYS.prefs, merged);
      return merged;
    });
  }

  // ─── Import / export ────────────────────────────────────────
  async function exportAll() {
    return {
      app: 'capsule-flow',
      version: 2,
      exportedAt: new Date().toISOString(),
      capsules: await getCapsules(),
      folders: await getFolders(),
    };
  }

  function importAll(data) {
    return serial(async () => {
      if (!data || typeof data !== 'object' || !Array.isArray(data.capsules)) {
        throw new Error('This file is not a Capsule Flow export.');
      }
      const caps = await getCapsules();
      const folders = await getFolders();
      const capIds = new Set(caps.map((c) => c.id));
      const folderIds = new Set(folders.map((f) => f.id));
      let addedFolders = 0;
      for (const f of data.folders || []) {
        if (f && f.id && f.name && !folderIds.has(f.id)) {
          folders.push({ id: f.id, name: String(f.name).slice(0, 40), createdAt: f.createdAt || new Date().toISOString() });
          folderIds.add(f.id);
          addedFolders++;
        }
      }
      let added = 0, skipped = 0;
      for (const raw of data.capsules) {
        if (!raw || (!raw.content && !(raw.messages || []).length)) { skipped++; continue; }
        if (raw.id && capIds.has(raw.id)) { skipped++; continue; }
        const c = normalise(raw);
        if (c.folderId && !folderIds.has(c.folderId)) c.folderId = null;
        caps.push(c);
        capIds.add(c.id);
        added++;
      }
      await write(KEYS.folders, folders);
      await write(KEYS.capsules, caps);
      return { added, skipped, addedFolders };
    });
  }

  function clearAll() {
    return serial(() => area().remove([KEYS.capsules, KEYS.folders]));
  }

  // One-time migration from the 1.x storage keys.
  async function migrate() {
    const old = await area().get(['cf_user_prefs']);
    if (old.cf_user_prefs) {
      const o = old.cf_user_prefs;
      const patch = {};
      if (o.injectMode) patch.injectMode = o.injectMode;
      if (o.showFloatingButton === false) patch.showFab = false;
      await savePrefs(patch);
      await area().remove('cf_user_prefs');
    }
    // Normalise any 1.x capsules in place (adds missing fields).
    const caps = await getCapsules();
    if (caps.some((c) => !Array.isArray(c.messages) || c.platform === undefined)) {
      await serial(() => write(KEYS.capsules, caps.map((c) => normalise({ ...c, platform: c.platform || (c.source ? 'web' : 'manual') }))));
    }
  }

  function onChange(cb) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      const keys = Object.keys(changes);
      if (keys.some((k) => k === KEYS.capsules || k === KEYS.folders || k === KEYS.prefs)) cb(changes);
    });
  }

  global.CFStore = {
    KEYS, DEFAULT_PREFS, LIMITS,
    uid, cleanTags,
    getCapsules, getCapsule, saveCapsule, patchCapsule, deleteCapsule, duplicateCapsule, toggleStar, markUsed, search,
    getFolders, saveFolder, deleteFolder,
    getPrefs, savePrefs,
    exportAll, importAll, clearAll, migrate, onChange,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
