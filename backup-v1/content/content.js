// ============================================================
// Capsule Flow — Content Script
// Injected into supported AI platform pages
// ============================================================

(function () {
  'use strict';

  // Prevent double-injection
  if (window.__CF_INJECTED__) return;
  window.__CF_INJECTED__ = true;

  // ─── State ──────────────────────────────────────────────────
  let panelVisible = false;
  let capsules = [];
  let folders = [];
  let userPrefs = {};
  let activeFolderId = null;
  let activeTab = 'all';
  let searchQuery = '';
  let sortBy = 'updatedAt';
  let pendingCaptureContent = '';
  let captureTags = [];
  let captureTitle = '';

  const root = document.documentElement;
  let fabEl = null;
  let panelEl = null;
  let overlayEl = null;
  let toastContainerEl = null;
  let captureModalEl = null;
  let captureOverlayEl = null;

  // ─── Platform Detection ─────────────────────────────────────
  const PLATFORM = detectPlatform();

  function detectPlatform() {
    const host = location.hostname;
    if (host.includes('chatgpt') || host.includes('openai')) return 'chatgpt';
    if (host.includes('claude')) return 'claude';
    if (host.includes('gemini')) return 'gemini';
    if (host.includes('deepseek')) return 'deepseek';
    if (host.includes('perplexity')) return 'perplexity';
    if (host.includes('grok') || (host.includes('x.com') && location.pathname.includes('grok'))) return 'grok';
    if (host.includes('copilot') || host.includes('bing')) return 'copilot';
    if (host.includes('poe')) return 'poe';
    return 'unknown';
  }

  // ─── Init ────────────────────────────────────────────────────
  async function init() {
    userPrefs = await sendMessage({ type: 'CF_GET_PREFS' });
    await loadCapsules();
    await loadFolders();
    buildUI();
    setupLLMDropZones();
    if (userPrefs.showFloatingButton !== false) {
      showFab();
    }
    // Small delay to not interfere with page load
    setTimeout(injectToolbarButton, 2500);
  }

  // ─── Messaging ───────────────────────────────────────────────
  function sendMessage(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else if (res && !res.success) reject(new Error(res.error));
        else resolve(res ? res.data : null);
      });
    });
  }

  async function loadCapsules() {
    try {
      capsules = await sendMessage({
        type: 'CF_GET_CAPSULES',
        query: searchQuery,
        filters: { folderId: activeFolderId, sortBy },
      }) || [];
    } catch (e) { console.error('[CapsuleFlow]', e); capsules = []; }
  }

  async function loadFolders() {
    try {
      folders = await sendMessage({ type: 'CF_GET_FOLDERS' }) || [];
    } catch (e) { folders = []; }
  }

  // ─── Build UI ────────────────────────────────────────────────
  function buildUI() {
    // Toast container
    toastContainerEl = ce('div', 'cf-toast-container cf-root');
    document.body.appendChild(toastContainerEl);

    // Overlay
    overlayEl = ce('div', 'cf-panel-overlay cf-root');
    overlayEl.addEventListener('click', closePanel);
    document.body.appendChild(overlayEl);

    // Side panel
    panelEl = buildPanel();
    document.body.appendChild(panelEl);

    // Capture modal overlay
    captureOverlayEl = ce('div', 'cf-modal-overlay cf-root');
    captureOverlayEl.addEventListener('click', (e) => {
      if (e.target === captureOverlayEl) closeCaptureModal();
    });
    captureModalEl = buildCaptureModal();
    captureOverlayEl.appendChild(captureModalEl);
    document.body.appendChild(captureOverlayEl);
  }

  // ─── FAB ─────────────────────────────────────────────────────
  function showFab() {
    if (fabEl) fabEl.remove();
    fabEl = ce('button', 'cf-fab cf-root');
    fabEl.innerHTML = '💊';
    fabEl.title = 'Capsule Flow (Ctrl+Shift+K)';
    fabEl.setAttribute('aria-label', 'Open Capsule Flow');

    const pos = userPrefs.floatingButtonPosition || 'bottom-left';
    if (pos === 'top-right') fabEl.classList.add('cf-fab--top-right');
    else if (pos === 'top-left') fabEl.classList.add('cf-fab--top-left');
    else if (pos === 'bottom-right') fabEl.classList.add('cf-fab--bottom-right');
    else fabEl.classList.add('cf-fab--bottom-left');

    if (pos.includes('right')) {
      panelEl?.classList.add('cf-panel--right');
    } else {
      panelEl?.classList.remove('cf-panel--right');
    }

    fabEl.addEventListener('click', togglePanel);
    makeDraggable(fabEl);
    document.body.appendChild(fabEl);
  }

  function makeDraggable(el) {
    let dragging = false, startX, startY, origLeft, origBottom, didMove = false;

    el.addEventListener('mousedown', (e) => {
      dragging = true; didMove = false;
      startX = e.clientX; startY = e.clientY;
      const rect = el.getBoundingClientRect();
      origLeft = rect.left;
      origBottom = window.innerHeight - rect.bottom;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) didMove = true;
      el.style.left = (origLeft + dx) + 'px';
      el.style.bottom = (origBottom - dy) + 'px';
      el.style.right = 'auto';
      el.style.transition = 'none';
    });

    document.addEventListener('mouseup', () => {
      dragging = false;
      el.style.transition = '';
    });

    el.addEventListener('click', (e) => {
      if (didMove) { e.stopPropagation(); didMove = false; }
    });
  }

  // ─── Enable Drag-and-Drop to Any LLM Input ───────────────────
  function setupLLMDropZones() {
    window.addEventListener('dragover', (e) => {
      const target = e.target.closest('textarea, div[contenteditable="true"], rich-textarea, #prompt-textarea, #chat-input');
      if (target) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        target.classList.add('cf-drop-highlight');
      }
    });

    window.addEventListener('dragleave', (e) => {
      const target = e.target.closest('textarea, div[contenteditable="true"], rich-textarea, #prompt-textarea, #chat-input');
      if (target) {
        target.classList.remove('cf-drop-highlight');
      }
    });

    window.addEventListener('drop', (e) => {
      const target = e.target.closest('textarea, div[contenteditable="true"], rich-textarea, #prompt-textarea, #chat-input');
      if (target) {
        target.classList.remove('cf-drop-highlight');
        const text = e.dataTransfer.getData('text/plain');
        if (text) {
          e.preventDefault();
          tryInjectIntoInput(text);
          showToast('💊 Capsule dropped into chat!', 'success');
        }
      }
    });
  }

  // ─── Side Panel ──────────────────────────────────────────────
  function buildPanel() {
    const panel = ce('div', 'cf-panel cf-root');
    panel.innerHTML = `
      <div class="cf-panel__header">
        <div class="cf-panel__logo">💊</div>
        <div class="cf-panel__title">Capsule <span>Flow</span></div>
        <button class="cf-panel__close" id="cf-close-panel" aria-label="Close">✕</button>
      </div>
      <div class="cf-panel__search">
        <div class="cf-search-box">
          <span class="cf-search-box__icon">🔍</span>
          <input class="cf-search-box__input" id="cf-search" type="text" placeholder="Search capsules…" autocomplete="off" />
        </div>
      </div>
      <div class="cf-panel__tabs" id="cf-tabs">
        <div class="cf-tab cf-tab--active" data-tab="all">All</div>
        <div class="cf-tab" data-tab="folders">Folders</div>
        <div class="cf-tab" data-tab="recent">Recent</div>
      </div>
      <div class="cf-panel__body" id="cf-panel-body"></div>
      <div class="cf-panel__footer">
        <button class="cf-btn cf-btn--primary" id="cf-save-chat-btn" title="Capture the entire conversation from this page">💾 Save Chat</button>
        <button class="cf-btn cf-btn--secondary" id="cf-capture-btn" title="Capture selected text">✂️ Selection</button>
        <button class="cf-btn cf-btn--secondary" id="cf-new-btn" title="Create empty capsule">+ New</button>
      </div>
    `;

    // Events
    panel.querySelector('#cf-close-panel').addEventListener('click', closePanel);
    panel.querySelector('#cf-search').addEventListener('input', debounce(handleSearch, 300));
    panel.querySelector('#cf-save-chat-btn').addEventListener('click', captureFullChat);
    panel.querySelector('#cf-capture-btn').addEventListener('click', captureSelection);
    panel.querySelector('#cf-new-btn').addEventListener('click', () => openCaptureModal());

    // Tabs
    panel.querySelectorAll('.cf-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        panel.querySelectorAll('.cf-tab').forEach(t => t.classList.remove('cf-tab--active'));
        tab.classList.add('cf-tab--active');
        activeTab = tab.dataset.tab;
        activeFolderId = null;
        renderPanelBody();
      });
    });

    return panel;
  }

  function togglePanel() {
    panelVisible ? closePanel() : openPanel();
  }

  async function openPanel() {
    panelVisible = true;
    await loadCapsules();
    await loadFolders();
    renderPanelBody();
    panelEl.classList.add('cf-visible');
    overlayEl.classList.add('cf-visible');
    setTimeout(() => panelEl.querySelector('#cf-search')?.focus(), 350);
  }

  function closePanel() {
    panelVisible = false;
    panelEl.classList.remove('cf-visible');
    overlayEl.classList.remove('cf-visible');
  }

  async function handleSearch(e) {
    searchQuery = e.target.value;
    await loadCapsules();
    renderPanelBody();
  }

  function renderPanelBody() {
    const body = panelEl.querySelector('#cf-panel-body');
    if (!body) return;

    if (activeTab === 'folders') {
      renderFoldersList(body);
      return;
    }

    // Filter capsules
    let displayed = capsules;
    if (activeTab === 'recent') {
      displayed = [...capsules]
        .sort((a, b) => new Date(b.lastUsedAt || b.updatedAt) - new Date(a.lastUsedAt || a.updatedAt))
        .slice(0, 20);
    }

    if (displayed.length === 0) {
      body.innerHTML = `
        <div class="cf-empty">
          <div class="cf-empty__icon">💊</div>
          <div class="cf-empty__text">
            ${searchQuery ? 'No capsules match your search.' : 'No capsules yet.<br>Capture context to get started!'}
          </div>
        </div>
      `;
      return;
    }

    body.innerHTML = displayed.map(c => renderCapsuleCard(c)).join('');

    // Attach events
    body.querySelectorAll('.cf-capsule-card').forEach(card => {
      const id = card.dataset.id;
      const capsule = capsules.find(c => c.id === id);

      // Make card drag-and-droppable directly into another LLM tab or input
      card.setAttribute('draggable', 'true');
      card.addEventListener('dragstart', (e) => {
        card.classList.add('cf-dragging');
        if (capsule && capsule.content) {
          e.dataTransfer.setData('text/plain', capsule.content);
          e.dataTransfer.setData('text/html', capsule.content);
          e.dataTransfer.effectAllowed = 'copy';
        }
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('cf-dragging');
      });

      card.addEventListener('click', (e) => {
        if (e.target.closest('.cf-capsule-card__actions')) return;
        injectCapsule(id);
      });
      card.querySelector('.cf-inject-action')?.addEventListener('click', (e) => {
        e.stopPropagation();
        injectCapsule(id);
      });
      card.querySelector('.cf-edit-action')?.addEventListener('click', (e) => {
        e.stopPropagation();
        editCapsule(id);
      });
      card.querySelector('.cf-delete-action')?.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteCapsule(id);
      });
    });
  }

  function renderCapsuleCard(capsule) {
    const date = formatDate(capsule.updatedAt);
    const tags = (capsule.tags || []).slice(0, 3).map(t => `<span class="cf-tag">${escHtml(t)}</span>`).join('');
    // Ensure content preview is formatted, remaining text is hidden within 3 lines
    const rawContent = (capsule.content || '').trim();
    return `
      <div class="cf-capsule-card" data-id="${capsule.id}" title="Drag this capsule into any LLM input box">
        <div class="cf-capsule-card__title">💊 ${escHtml(capsule.title || 'Untitled Capsule')}</div>
        <div class="cf-capsule-card__preview">${escHtml(rawContent)}</div>
        <div class="cf-capsule-card__meta">
          ${tags}
          <span class="cf-capsule-card__date">${date}</span>
        </div>
        <div class="cf-capsule-card__actions">
          <button class="cf-icon-btn cf-inject-action" title="Inject or Drag into chat">⬆️</button>
          <button class="cf-icon-btn cf-edit-action" title="Edit">✏️</button>
          <button class="cf-icon-btn cf-icon-btn--danger cf-delete-action" title="Delete">🗑️</button>
        </div>
      </div>
    `;
  }

  function renderFoldersList(body) {
    body.innerHTML = `
      <div class="cf-folder-item ${!activeFolderId ? 'cf-active' : ''}" data-folder-id="">
        <span class="cf-folder-icon">📋</span>
        <span class="cf-folder-name">All Capsules</span>
        <span class="cf-folder-count">${capsules.length}</span>
      </div>
      ${folders.map(f => {
        const count = capsules.filter(c => c.folderId === f.id).length;
        return `
          <div class="cf-folder-item ${activeFolderId === f.id ? 'cf-active' : ''}" data-folder-id="${f.id}">
            <span class="cf-folder-icon">${f.icon || '📁'}</span>
            <span class="cf-folder-name">${escHtml(f.name)}</span>
            <span class="cf-folder-count">${count}</span>
          </div>
        `;
      }).join('')}
      <button class="cf-btn cf-btn--secondary" id="cf-new-folder-btn" style="margin-top:10px;width:100%">+ New Folder</button>
    `;

    body.querySelectorAll('.cf-folder-item').forEach(item => {
      item.addEventListener('click', async () => {
        activeFolderId = item.dataset.folderId || null;
        await loadCapsules();
        activeTab = 'all';
        panelEl.querySelectorAll('.cf-tab').forEach(t => {
          t.classList.toggle('cf-tab--active', t.dataset.tab === 'all');
        });
        renderPanelBody();
      });
    });

    body.querySelector('#cf-new-folder-btn')?.addEventListener('click', () => promptNewFolder());
  }

  // ─── Capture Entire Chat Context ──────────────────────────────
  function extractChatContext() {
    let turns = [];

    // 1. ChatGPT
    const gptMessages = document.querySelectorAll('article, [data-message-author-role], div[data-testid^="conversation-turn"]');
    if (gptMessages && gptMessages.length > 0) {
      gptMessages.forEach(msg => {
        const role = msg.getAttribute('data-message-author-role') || (msg.innerText.includes('ChatGPT') ? 'Assistant' : 'User');
        const text = msg.innerText.trim();
        if (text && !text.includes('Capsule Flow')) turns.push(`${role.toUpperCase()}:\n${text}`);
      });
    }

    // 2. Claude
    if (turns.length === 0) {
      const claudeMessages = document.querySelectorAll('.font-user-message, .font-claude-message, div[data-is-streaming], div[class*="ChatMessage"]');
      if (claudeMessages && claudeMessages.length > 0) {
        claudeMessages.forEach(msg => {
          const isUser = msg.classList.contains('font-user-message') || msg.querySelector('[data-testid="user-message"]');
          const role = isUser ? 'USER' : 'CLAUDE';
          const text = msg.innerText.trim();
          if (text) turns.push(`${role}:\n${text}`);
        });
      }
    }

    // 3. Gemini
    if (turns.length === 0) {
      const geminiTurns = document.querySelectorAll('user-query, model-response, div.conversation-container message-content');
      if (geminiTurns && geminiTurns.length > 0) {
        geminiTurns.forEach(turn => {
          const role = turn.tagName.toLowerCase().includes('user') ? 'USER' : 'GEMINI';
          const text = turn.innerText.trim();
          if (text) turns.push(`${role}:\n${text}`);
        });
      }
    }

    // 4. DeepSeek
    if (turns.length === 0) {
      const dsMessages = document.querySelectorAll('.chat-message, .ds-message, div[class*="message-bubble"]');
      if (dsMessages && dsMessages.length > 0) {
        dsMessages.forEach(msg => {
          const text = msg.innerText.trim();
          if (text) turns.push(text);
        });
      }
    }

    // 5. Perplexity / Grok / Generic fallback
    if (turns.length === 0) {
      const genericMessages = document.querySelectorAll('[class*="message"], [class*="bubble"], [class*="chat-turn"], main p, main div');
      const seen = new Set();
      genericMessages.forEach(el => {
        // Only elements with substantial text and not our own UI
        if (el.closest('.cf-root') || el.closest('.cf-panel') || el.closest('.cf-modal')) return;
        const text = el.innerText?.trim();
        if (text && text.length > 30 && !seen.has(text) && text.split('\n').length < 15) {
          seen.add(text);
          turns.push(text);
        }
      });
    }

    // Fallback: extract main article or main content
    if (turns.length === 0) {
      const main = document.querySelector('main') || document.body;
      const clone = main.cloneNode(true);
      clone.querySelectorAll('.cf-root, .cf-panel, .cf-modal, script, style, nav, header').forEach(el => el.remove());
      return clone.innerText.trim().substring(0, 45000);
    }

    return turns.join('\n\n---\n\n').substring(0, 45000);
  }

  function captureFullChat() {
    const fullChat = extractChatContext();
    if (fullChat && fullChat.length > 10) {
      const pageTitle = document.title ? document.title.replace(/[-|•].*$/, '').trim() : '';
      const title = pageTitle ? `${pageTitle} (${PLATFORM})` : `Chat Capsule (${PLATFORM})`;
      openCaptureModal(fullChat);
      const titleInput = captureModalEl.querySelector('#cf-cap-title');
      if (titleInput) titleInput.value = title;
    } else {
      showToast('Could not find active chat messages on this page.', 'warning');
    }
  }

  // ─── Capture Selection ────────────────────────────────────────
  function captureSelection() {
    const sel = window.getSelection()?.toString()?.trim();
    if (sel) {
      pendingCaptureContent = sel;
      openCaptureModal(sel);
    } else {
      showToast('Select text on the page first, then click Selection.', 'info');
    }
  }

  function openCaptureModal(prefillContent = '') {
    const titleInput = captureModalEl.querySelector('#cf-cap-title');
    const contentInput = captureModalEl.querySelector('#cf-cap-content');
    const folderSelect = captureModalEl.querySelector('#cf-cap-folder');

    titleInput.value = '';
    contentInput.value = prefillContent;
    captureTags = [];
    renderTagsInModal();

    // Populate folder dropdown
    folderSelect.innerHTML = `
      <option value="">— No Folder —</option>
      ${folders.map(f => `<option value="${f.id}">${escHtml(f.name)}</option>`).join('')}
    `;

    captureOverlayEl.classList.add('cf-visible');
    setTimeout(() => titleInput.focus(), 100);
  }

  function closeCaptureModal() {
    captureOverlayEl.classList.remove('cf-visible');
  }

  function buildCaptureModal() {
    const modal = ce('div', 'cf-modal');
    modal.innerHTML = `
      <div class="cf-modal__header">
        <span class="cf-modal__icon">💊</span>
        <span class="cf-modal__title">Save Capsule</span>
        <button class="cf-modal__close" id="cf-modal-close">✕</button>
      </div>
      <div class="cf-form-group">
        <label class="cf-label" for="cf-cap-title">Title</label>
        <input class="cf-input" id="cf-cap-title" type="text" placeholder="Give your capsule a name…" maxlength="100" />
      </div>
      <div class="cf-form-group">
        <label class="cf-label" for="cf-cap-content">Content</label>
        <textarea class="cf-textarea" id="cf-cap-content" placeholder="Paste or type your context here…"></textarea>
      </div>
      <div class="cf-form-group">
        <label class="cf-label">Tags</label>
        <div class="cf-tags-input" id="cf-cap-tags-wrapper">
          <input id="cf-cap-tags-input" type="text" placeholder="Add tag, press Enter…" maxlength="30" />
        </div>
      </div>
      <div class="cf-form-group">
        <label class="cf-label" for="cf-cap-folder">Folder</label>
        <select class="cf-input" id="cf-cap-folder" style="cursor:pointer;">
          <option value="">— No Folder —</option>
        </select>
      </div>
      <div class="cf-modal__actions">
        <button class="cf-btn cf-btn--secondary" id="cf-cap-cancel">Cancel</button>
        <button class="cf-btn cf-btn--primary" id="cf-cap-save">💊 Save Capsule</button>
      </div>
    `;

    modal.querySelector('#cf-modal-close').addEventListener('click', closeCaptureModal);
    modal.querySelector('#cf-cap-cancel').addEventListener('click', closeCaptureModal);
    modal.querySelector('#cf-cap-save').addEventListener('click', saveCaptureModal);

    // Tag input
    const tagInput = modal.querySelector('#cf-cap-tags-input');
    tagInput.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ',') && tagInput.value.trim()) {
        e.preventDefault();
        addTag(tagInput.value.trim());
        tagInput.value = '';
      } else if (e.key === 'Backspace' && !tagInput.value && captureTags.length > 0) {
        captureTags.pop();
        renderTagsInModal();
      }
    });

    return modal;
  }

  function addTag(tag) {
    const clean = tag.toLowerCase().replace(/[^a-z0-9\-_ ]/g, '').trim();
    if (clean && !captureTags.includes(clean) && captureTags.length < 10) {
      captureTags.push(clean);
      renderTagsInModal();
    }
  }

  function renderTagsInModal() {
    const wrapper = captureModalEl.querySelector('#cf-cap-tags-wrapper');
    const input = captureModalEl.querySelector('#cf-cap-tags-input');
    // Remove old tags
    wrapper.querySelectorAll('.cf-tag').forEach(t => t.remove());
    captureTags.forEach(tag => {
      const tagEl = ce('span', 'cf-tag');
      tagEl.innerHTML = `${escHtml(tag)} <span class="cf-tag__remove" data-tag="${escHtml(tag)}">✕</span>`;
      tagEl.querySelector('.cf-tag__remove').addEventListener('click', () => {
        captureTags = captureTags.filter(t => t !== tag);
        renderTagsInModal();
      });
      wrapper.insertBefore(tagEl, input);
    });
  }

  async function saveCaptureModal() {
    const title = captureModalEl.querySelector('#cf-cap-title').value.trim();
    const content = captureModalEl.querySelector('#cf-cap-content').value.trim();
    const folderId = captureModalEl.querySelector('#cf-cap-folder').value || null;

    if (!content) {
      showToast('Content cannot be empty!', 'error');
      return;
    }

    const capsule = {
      title: title || content.substring(0, 60) + (content.length > 60 ? '…' : ''),
      content,
      tags: captureTags,
      folderId,
      source: location.hostname,
      platform: PLATFORM,
    };

    try {
      const saved = await sendMessage({ type: 'CF_SAVE_CAPSULE', capsule });
      capsules.unshift(saved);
      closeCaptureModal();
      showToast('💊 Capsule saved!', 'success');
      if (panelVisible) renderPanelBody();
    } catch (e) {
      showToast('Failed to save: ' + e.message, 'error');
    }
  }

  // ─── Inject ─────────────────────────────────────────────────
  async function injectCapsule(id) {
    const cap = capsules.find(c => c.id === id);
    if (!cap) return;

    // Always copy to clipboard as an instant guarantee
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(cap.content);
      }
    } catch (_) {}

    const inserted = tryInjectIntoInput(cap.content);
    await sendMessage({ type: 'CF_INCREMENT_USAGE', id });

    if (inserted) {
      showToast(`💊 "${truncate(cap.title, 30)}" injected!`, 'success');
      closePanel();
    } else {
      showToast('📋 Copied to clipboard! Press Ctrl+V to paste.', 'info');
      closePanel();
    }
  }

  function tryInjectIntoInput(text) {
    // Extensive selectors covering ChatGPT, Claude 3.5, Gemini 1.5/2.0, DeepSeek, Grok, Perplexity, Copilot
    const selectors = [
      '#prompt-textarea',
      'div[id="prompt-textarea"]',
      'div[contenteditable="true"].ProseMirror',
      'div.ProseMirror[contenteditable="true"]',
      'rich-textarea div[contenteditable="true"]',
      'div[contenteditable="true"][aria-label*="prompt" i]',
      'div[contenteditable="true"][aria-label*="message" i]',
      'div[contenteditable="true"][data-placeholder]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      'textarea[data-id="root"]',
      'textarea[placeholder*="Message" i]',
      'textarea[placeholder*="Ask" i]',
      'textarea[placeholder*="Talk" i]',
      'textarea[placeholder*="Prompt" i]',
      'textarea[aria-label*="prompt" i]',
      'textarea[aria-label*="message" i]',
      '#chat-input',
      'textarea'
    ];

    let targetEl = null;
    for (const sel of selectors) {
      const elements = Array.from(document.querySelectorAll(sel));
      // Pick visible and non-disabled input
      const visible = elements.find(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && !el.closest('.cf-root') && !el.closest('.cf-panel') && !el.closest('.cf-modal');
      });
      if (visible) {
        targetEl = visible;
        break;
      }
    }

    if (!targetEl) return false;

    const injectMode = userPrefs.injectMode || 'append';

    try {
      targetEl.focus();

      if (targetEl.tagName === 'TEXTAREA' || targetEl.tagName === 'INPUT') {
        let newText = text;
        if (injectMode === 'prepend') {
          newText = text + (targetEl.value ? '\n\n' + targetEl.value : '');
        } else if (injectMode === 'append') {
          newText = targetEl.value ? targetEl.value + '\n\n' + text : text;
        }

        // Use prototype setter so React/Vue/Angular state listeners detect the value change
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          'value'
        )?.set || Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        )?.set;

        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(targetEl, newText);
        } else {
          targetEl.value = newText;
        }

        targetEl.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        targetEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        targetEl.focus();
        return true;

      } else if (targetEl.isContentEditable || targetEl.getAttribute('contenteditable') === 'true') {
        // ContentEditable (ProseMirror / Lexical / Quill / Google Rich-textarea)
        if (injectMode === 'replace') {
          targetEl.innerHTML = '';
        }

        // Focus and select end position
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(targetEl);
        if (injectMode === 'prepend') {
          range.collapse(true);
        } else {
          range.collapse(false);
        }
        sel.removeAllRanges();
        sel.addRange(range);

        // Try execCommand first (triggers proper framework undo stack and input events)
        const textToInsert = (injectMode === 'append' && targetEl.textContent.trim().length > 0 ? '\n\n' : '') + text;
        const inserted = document.execCommand('insertText', false, textToInsert);

        if (!inserted || !targetEl.textContent.includes(text.substring(0, 15))) {
          // Fallback direct text node insertion
          const lines = textToInsert.split('\n');
          const fragment = document.createDocumentFragment();
          lines.forEach((line, idx) => {
            if (idx > 0) fragment.appendChild(document.createElement('br'));
            if (line) fragment.appendChild(document.createTextNode(line));
          });
          range.insertNode(fragment);
        }

        // Trigger comprehensive events for modern frameworks
        targetEl.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
        targetEl.dispatchEvent(new Event('change', { bubbles: true }));
        targetEl.focus();
        return true;
      }
    } catch (err) {
      console.warn('[CapsuleFlow] Failed to inject text into element:', err);
    }
    return false;
  }

  // ─── Edit / Delete ───────────────────────────────────────────
  function editCapsule(id) {
    const cap = capsules.find(c => c.id === id);
    if (!cap) return;
    captureTags = [...(cap.tags || [])];
    openCaptureModal(cap.content);
    captureModalEl.querySelector('#cf-cap-title').value = cap.title || '';
    renderTagsInModal();
    // Override save to update
    const saveBtn = captureModalEl.querySelector('#cf-cap-save');
    const originalHandler = saveBtn._cf_handler;
    if (originalHandler) saveBtn.removeEventListener('click', originalHandler);

    async function updateHandler() {
      const title = captureModalEl.querySelector('#cf-cap-title').value.trim();
      const content = captureModalEl.querySelector('#cf-cap-content').value.trim();
      const folderId = captureModalEl.querySelector('#cf-cap-folder').value || null;
      if (!content) { showToast('Content cannot be empty!', 'error'); return; }
      try {
        const updated = await sendMessage({
          type: 'CF_SAVE_CAPSULE',
          capsule: { ...cap, title, content, tags: captureTags, folderId },
        });
        const idx = capsules.findIndex(c => c.id === id);
        if (idx !== -1) capsules[idx] = updated;
        closeCaptureModal();
        showToast('✅ Capsule updated!', 'success');
        if (panelVisible) renderPanelBody();
        // Restore original handler
        saveBtn.removeEventListener('click', updateHandler);
        saveBtn.addEventListener('click', saveCaptureModal);
      } catch (e) { showToast('Update failed: ' + e.message, 'error'); }
    }

    saveBtn._cf_handler = updateHandler;
    saveBtn.removeEventListener('click', saveCaptureModal);
    saveBtn.addEventListener('click', updateHandler);
  }

  async function deleteCapsule(id) {
    const cap = capsules.find(c => c.id === id);
    if (!cap) return;
    if (!confirm(`Delete "${cap.title || 'this capsule'}"?`)) return;
    try {
      await sendMessage({ type: 'CF_DELETE_CAPSULE', id });
      capsules = capsules.filter(c => c.id !== id);
      renderPanelBody();
      showToast('🗑️ Capsule deleted', 'info');
    } catch (e) { showToast('Delete failed: ' + e.message, 'error'); }
  }

  // ─── Toolbar / Inject Button ─────────────────────────────────
  function injectToolbarButton() {
    // Look for existing toolbar areas in AI platforms
    const toolbarSelectors = [
      '.flex.gap-2', // ChatGPT
      '.input-area__actions', // Claude
      '.input-container', // General
    ];

    for (const sel of toolbarSelectors) {
      const toolbar = document.querySelector(sel);
      if (toolbar) {
        if (toolbar.querySelector('.cf-inject-btn')) return;
        const btn = ce('button', 'cf-inject-btn');
        btn.innerHTML = `<span class="cf-inject-btn__icon">💊</span> Capsule`;
        btn.title = 'Open Capsule Flow (Ctrl+Shift+K)';
        btn.addEventListener('click', togglePanel);
        toolbar.prepend(btn);
        return;
      }
    }
  }

  // ─── Folder Management ───────────────────────────────────────
  async function promptNewFolder() {
    const name = prompt('Folder name:');
    if (!name || !name.trim()) return;
    try {
      const folder = await sendMessage({
        type: 'CF_SAVE_FOLDER',
        folder: { name: name.trim(), icon: '📁' },
      });
      folders.push(folder);
      renderPanelBody();
      showToast(`📁 Folder "${name.trim()}" created`, 'success');
    } catch (e) { showToast('Failed to create folder', 'error'); }
  }

  // ─── Toast Notifications ─────────────────────────────────────
  function showToast(message, variant = 'info') {
    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    const toast = ce('div', `cf-toast cf-toast--${variant}`);
    toast.innerHTML = `
      <span class="cf-toast__icon">${icons[variant] || 'ℹ️'}</span>
      <span class="cf-toast__text">${escHtml(message)}</span>
    `;
    toastContainerEl.appendChild(toast);
    setTimeout(() => toast.remove(), 3200);
  }

  // ─── Message Listener ────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'CF_SHOW_TOAST') {
      showToast(msg.message, msg.variant);
      sendResponse({ success: true });
    } else if (msg.type === 'CF_TOGGLE_PANEL') {
      togglePanel();
      sendResponse({ success: true });
    } else if (msg.type === 'CF_INJECT_CAPSULE') {
      const capsule = msg.capsule;
      if (!capsule || !capsule.content) {
        sendResponse({ success: false, error: 'Empty capsule content' });
        return true;
      }
      const ok = tryInjectIntoInput(capsule.content);
      if (ok) {
        showToast(`💊 "${truncate(capsule.title, 30)}" injected!`, 'success');
        sendResponse({ success: true });
      } else {
        // Fallback: try clipboard write inside content script page context
        navigator.clipboard.writeText(capsule.content).then(() => {
          showToast(`📋 Copied "${truncate(capsule.title, 25)}" to clipboard!`, 'info');
          sendResponse({ success: true, fallback: 'clipboard' });
        }).catch(() => {
          sendResponse({ success: false, error: 'Could not inject or copy to clipboard' });
        });
      }
      return true;
    } else if (msg.type === 'CF_CAPTURE_SELECTION_COMMAND') {
      const sel = window.getSelection()?.toString()?.trim();
      if (sel) {
        openCaptureModal(sel);
      } else {
        showToast('Select text first, then press Ctrl+Shift+S', 'info');
      }
      sendResponse({ success: true });
    } else if (msg.type === 'CF_CAPTURE_PAGE') {
      captureFullChat();
      sendResponse({ success: true });
    }
    return true;
  });

  // ─── Keyboard Shortcut ───────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'K') {
      e.preventDefault();
      togglePanel();
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
      e.preventDefault();
      const sel = window.getSelection()?.toString()?.trim();
      if (sel) openCaptureModal(sel);
      else showToast('Select text first, then press Ctrl+Shift+S', 'info');
    }
    if (e.key === 'Escape' && panelVisible) {
      closePanel();
    }
    if (e.key === 'Escape' && captureOverlayEl?.classList.contains('cf-visible')) {
      closeCaptureModal();
    }
  });

  // ─── Helpers ─────────────────────────────────────────────────
  function ce(tag, className) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    return el;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function truncate(str, len) {
    if (!str) return '';
    return str.length <= len ? str : str.substring(0, len) + '…';
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
    return d.toLocaleDateString();
  }

  function debounce(fn, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // ─── Boot ────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
