// ============================================================
// Capsule Flow — Platform definitions
// Plain script (no modules) so it works in content scripts,
// extension pages and the service worker alike.
// ============================================================
(function (global) {
  'use strict';

  const PLATFORMS = [
    {
      id: 'chatgpt',
      name: 'ChatGPT',
      color: '#10a37f',
      hosts: ['chatgpt.com', 'chat.openai.com'],
      url: 'https://chatgpt.com/',
      messages: [
        { selector: '[data-message-author-role="user"]', role: 'user', text: '.whitespace-pre-wrap' },
        { selector: '[data-message-author-role="assistant"]', role: 'assistant', text: '.markdown' },
      ],
      inputs: ['#prompt-textarea', 'div.ProseMirror[contenteditable="true"]', 'textarea[name="prompt-textarea"]'],
    },
    {
      id: 'claude',
      name: 'Claude',
      color: '#d97757',
      hosts: ['claude.ai'],
      url: 'https://claude.ai/new',
      messages: [
        { selector: '[data-testid="user-message"]', role: 'user' },
        { selector: '.font-claude-response, .font-claude-message', role: 'assistant', text: '.standard-markdown, .progressive-markdown' },
      ],
      inputs: ['div.ProseMirror[contenteditable="true"]', '[data-testid="chat-input"]', 'fieldset div[contenteditable="true"]'],
    },
    {
      id: 'gemini',
      name: 'Gemini',
      color: '#4b8bf5',
      hosts: ['gemini.google.com'],
      url: 'https://gemini.google.com/app',
      messages: [
        { selector: 'user-query', role: 'user', text: '.query-text' },
        { selector: 'model-response', role: 'assistant', text: 'message-content' },
      ],
      inputs: ['rich-textarea .ql-editor[contenteditable="true"]', 'rich-textarea div[contenteditable="true"]', '.ql-editor[contenteditable="true"]'],
    },
    {
      id: 'deepseek',
      name: 'DeepSeek',
      color: '#4d6bfe',
      hosts: ['chat.deepseek.com'],
      url: 'https://chat.deepseek.com/',
      messages: [
        { selector: '.ds-message', role: (el) => (el.querySelector('.ds-markdown') ? 'assistant' : 'user'), text: '.ds-markdown' },
      ],
      inputs: ['textarea#chat-input', 'textarea[placeholder]'],
    },
    {
      id: 'perplexity',
      name: 'Perplexity',
      color: '#20b8cd',
      hosts: ['www.perplexity.ai', 'perplexity.ai'],
      url: 'https://www.perplexity.ai/',
      messages: [
        { selector: '[class*="group/query"], h1[class*="query"]', role: 'user' },
        { selector: '.prose', role: 'assistant' },
      ],
      inputs: ['#ask-input', 'div[contenteditable="true"][role="textbox"]', 'textarea[placeholder*="Ask" i]', 'textarea'],
    },
    {
      id: 'grok',
      name: 'Grok',
      color: '#9aa4b2',
      hosts: ['grok.com'],
      url: 'https://grok.com/',
      messages: [
        { selector: '.message-bubble', role: (el) => (el.closest('[class*="items-end"]') ? 'user' : 'assistant') },
      ],
      inputs: ['div.ProseMirror[contenteditable="true"]', 'textarea[aria-label*="Grok" i]', 'textarea'],
    },
    {
      id: 'copilot',
      name: 'Copilot',
      color: '#2f7cf6',
      hosts: ['copilot.microsoft.com'],
      url: 'https://copilot.microsoft.com/',
      messages: [
        { selector: '[data-content="user-message"]', role: 'user' },
        { selector: '[data-content="ai-message"]', role: 'assistant' },
      ],
      inputs: ['textarea#userInput', 'textarea[placeholder]', 'textarea'],
    },
    {
      id: 'poe',
      name: 'Poe',
      color: '#7d5cf5',
      hosts: ['poe.com'],
      url: 'https://poe.com/',
      messages: [
        { selector: '[class*="Message_humanMessageBubble"], [class*="Message_rightSideMessageBubble"]', role: 'user' },
        { selector: '[class*="Message_botMessageBubble"], [class*="Message_leftSideMessageBubble"]', role: 'assistant' },
      ],
      inputs: ['textarea[class*="GrowingTextArea"]', 'textarea'],
    },
    {
      id: 'mistral',
      name: 'Le Chat',
      color: '#fa500f',
      hosts: ['chat.mistral.ai'],
      url: 'https://chat.mistral.ai/chat',
      messages: [
        { selector: '[data-message-author-role="user"]', role: 'user' },
        { selector: '[data-message-author-role="assistant"]', role: 'assistant' },
      ],
      inputs: ['div.ProseMirror[contenteditable="true"]', 'textarea'],
    },
  ];

  // Generic selectors that work on many chat UIs — used when the
  // platform-specific ones find nothing (sites change their markup).
  const GENERIC_MESSAGES = [
    { selector: '[data-message-author-role]', role: (el) => (el.getAttribute('data-message-author-role') === 'user' ? 'user' : 'assistant') },
    { selector: '[data-role="user"], [data-author="user"]', role: 'user' },
    { selector: '[data-role="assistant"], [data-author="assistant"], [data-author="bot"]', role: 'assistant' },
  ];

  const GENERIC_INPUTS = [
    'div.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
    'textarea[placeholder*="message" i]',
    'textarea[placeholder*="ask" i]',
    'textarea[placeholder*="prompt" i]',
    'div[contenteditable="true"]',
    'textarea',
  ];

  function detect(hostname) {
    const host = (hostname || '').toLowerCase();
    return PLATFORMS.find((p) => p.hosts.some((h) => host === h || host.endsWith('.' + h))) || null;
  }

  function byId(id) {
    return PLATFORMS.find((p) => p.id === id) || null;
  }

  function nameFor(id) {
    const p = byId(id);
    if (p) return p.name;
    if (!id || id === 'manual') return 'Manual';
    if (id === 'web') return 'Web';
    return id;
  }

  function colorFor(id) {
    const p = byId(id);
    return p ? p.color : '#7c8aa0';
  }

  global.CFPlatforms = { PLATFORMS, GENERIC_MESSAGES, GENERIC_INPUTS, detect, byId, nameFor, colorFor };
})(typeof globalThis !== 'undefined' ? globalThis : self);
