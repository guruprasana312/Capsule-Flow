# 💊 Capsule Flow — Chrome Extension

> The context-transfer layer for modern AI workflows.  
> **Capture once. Reuse everywhere. ✨ (100% Local & Private)**

---

## Overview

**Capsule Flow** lets you capture AI conversations as reusable "Capsules" and inject or drag-and-drop them instantly into any supported AI platform — no logins, no signups, no credentials, and no external servers. Everything stays private on your browser.

### Supported Platforms
| Platform | URL |
|---|---|
| 🤖 ChatGPT | chatgpt.com / chat.openai.com |
| ⚡ Claude | claude.ai |
| ✨ Gemini | gemini.google.com |
| 🔍 DeepSeek | chat.deepseek.com |
| 🔮 Perplexity | perplexity.ai |
| 💡 Grok | grok.x.ai / grok.com |
| 🪟 Microsoft Copilot | copilot.microsoft.com |
| 🦋 Poe | poe.com |
| 🎭 Character.AI | character.ai |

---

## Key Features

- 📍 **Bottom-Left Floating Widget** — Floats at the bottom-left on all AI chat platforms.
- 💾 **Full Chat Context Capture** — One-click **"Save Chat"** captures the entire back-and-forth conversation turn-by-turn into a capsule.
- 🖱️ **Drag and Drop Context** — Click and drag any capsule card directly onto another AI platform's chat box to transfer the context immediately.
- ✂️ **Clean 3-Line Preview** — Long conversations are strictly clamped to 3 lines with an ellipsis; details remain clean and organized.
- 🔒 **100% Local & Zero Login** — Operates entirely via `chrome.storage.local`. No account, no API keys, and no credentials needed.
- 📁 **Folders & Tags** — Organize capsules by projects or topics.
- 🔍 **Full-Text Search** — Instantly filter and find previous context.
- 📦 **JSON Import & Export** — Easily backup and restore your capsules anytime.

---

## Installation

1. Open Chrome → Navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `D:\Capsule` folder
5. The 💊 icon is now installed and active!

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+K` | Toggle the Capsule Flow panel on any AI page |
| `Ctrl+Shift+S` | Capture selected text as a capsule |
| `Ctrl+N` | New capsule (when extension popup is open) |
| `Esc` | Close any open panel or modal |

---

## Project Structure

```
D:\Capsule/
├── manifest.json              # Extension manifest (MV3)
├── README.md                  # Documentation
├── icons/                     # Extension icons (16, 32, 48, 128px)
├── shared/
│   ├── config.js              # Platform selectors & constants
│   ├── storage.js             # Local-only storage manager
│   └── theme.css              # Burgundy/Night CSS tokens
├── background/
│   └── background.js          # Service worker & message router
├── content/
│   ├── content.js             # In-page floating button, panel & drag-drop
│   └── content.css            # Scoped widget stylesheet
├── popup/
│   ├── popup.html             # Toolbar popup interface
│   ├── popup.css              # Popup styling
│   └── popup.js               # Popup logic
└── options/
    ├── options.html           # Settings & platform overview
    ├── options.css            # Settings styling
    └── options.js             # Settings logic
```

---

## License

MIT — 100% Local & Private Context Transfer.
