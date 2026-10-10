// ============================================================
// Capsule Flow — Local-First Context Configuration
// ============================================================

// ============================================================
// Supported AI Platforms
// ============================================================
export const AI_PLATFORMS = {
  chatgpt: {
    name: 'ChatGPT',
    color: '#10a37f',
    icon: '🤖',
    inputSelectors: [
      '#prompt-textarea',
      'textarea[placeholder*="Message"]',
      'div[contenteditable="true"][data-id]',
    ],
    submitSelectors: ['button[data-testid="send-button"]', 'button[aria-label="Send message"]'],
  },
  claude: {
    name: 'Claude',
    color: '#d97706',
    icon: '⚡',
    inputSelectors: [
      'div[contenteditable="true"].ProseMirror',
      'textarea[placeholder*="Talk to Claude"]',
      'div[contenteditable="true"]',
    ],
    submitSelectors: ['button[aria-label="Send message"]', 'button[type="submit"]'],
  },
  gemini: {
    name: 'Gemini',
    color: '#4a9eff',
    icon: '✨',
    inputSelectors: [
      'rich-textarea div[contenteditable="true"]',
      '.ql-editor',
      'textarea[placeholder*="Enter a prompt"]',
    ],
    submitSelectors: ['button[aria-label="Send message"]', 'button.send-button'],
  },
  deepseek: {
    name: 'DeepSeek',
    color: '#7c3aed',
    icon: '🔍',
    inputSelectors: ['textarea[placeholder*="Send a message"]', '#chat-input'],
    submitSelectors: ['button[aria-label="Send"]', 'button.send-btn'],
  },
  perplexity: {
    name: 'Perplexity',
    color: '#06b6d4',
    icon: '🔮',
    inputSelectors: [
      'textarea[placeholder*="Ask anything"]',
      'textarea[placeholder*="Follow-up"]',
    ],
    submitSelectors: ['button[aria-label="Submit"]', 'button[type="submit"]'],
  },
  grok: {
    name: 'Grok',
    color: '#ef4444',
    icon: '💡',
    inputSelectors: [
      'textarea[placeholder*="Ask Grok"]',
      'div[contenteditable="true"]',
    ],
    submitSelectors: ['button[data-testid="tweetButtonInline"]', 'button[aria-label="Send"]'],
  },
  copilot: {
    name: 'Microsoft Copilot',
    color: '#0078d4',
    icon: '🪟',
    inputSelectors: [
      'textarea[placeholder*="Ask me anything"]',
      'cib-text-input textarea',
    ],
    submitSelectors: ['button[aria-label="Submit"]', 'cib-action-bar button'],
  },
  poe: {
    name: 'Poe',
    color: '#8b5cf6',
    icon: '🦋',
    inputSelectors: ['textarea[placeholder*="Talk to"]', 'div[contenteditable="true"]'],
    submitSelectors: ['button[class*="send"]'],
  },
};

// ============================================================
// App Constants
// ============================================================
export const APP_CONSTANTS = {
  MAX_CAPSULE_TITLE_LENGTH: 100,
  MAX_CAPSULE_CONTENT_LENGTH: 50000,
  MAX_TAGS_PER_CAPSULE: 10,
  MAX_TAG_LENGTH: 30,
  CAPSULE_VERSIONS_LIMIT: 10,
  DEFAULT_PAGE_SIZE: 20,
  TOAST_DURATION: 3000,
  SYNC_DEBOUNCE_MS: 1500,
};

// ============================================================
// Storage Keys
// ============================================================
export const STORAGE_KEYS = {
  CAPSULES: 'cf_capsules',
  FOLDERS: 'cf_folders',
  USER_PREFS: 'cf_user_prefs',
};
