# Capsule Flow

**Capture once, reuse everywhere.**

Capsule Flow is a Chrome extension (Manifest V3) that turns AI conversations into reusable "capsules" so you never have to re-explain your goals, constraints or project background when you switch tools. Brainstorm in ChatGPT, build in Claude, research in Gemini, explore in DeepSeek, and carry the context with you.

Everything is stored locally in your browser (`chrome.storage.local`). No account, no server, no API keys, and no AI calls.

## Install (developer mode)

1. Open `chrome://extensions` in Chrome (or Edge or Brave).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this folder (`D:\Capsule`). Pick the folder that contains `manifest.json`, not a parent folder.
4. Pin the pill icon from the puzzle-piece menu so it stays in the toolbar.
5. If an AI site was already open, reload that tab once. (The extension also tries to attach itself automatically when you use it.)

## Using it

| Step | How |
|---|---|
| **Capture a chat** | On any supported AI site, click the **Capsules** button (bottom right), then **Capture chat**. You can also press `Alt+Shift+C`, use the toolbar popup, or right-click the page and choose *Capture this chat*. |
| **Review & save** | Capsule Flow writes a brief locally (goal, constraints and preferences, key points, where you left off) followed by the recent messages or the full transcript. Edit anything, add tags or a folder, then save. |
| **Inject anywhere** | Open another AI tool, open the panel (`Ctrl+Shift+K`) and click **Inject**. The capsule goes straight into the chat box. You can also drag a capsule card onto the input, or use **Inject** in the toolbar popup. |
| **Save a snippet** | Highlight text on *any* website, right-click, then **Save selection as capsule**. |
| **Manage** | The dashboard (grid icon) has search, stars, folders, tags, source filters, the full transcript, version history with restore, duplicate, and Markdown export. |

### Supported sites
ChatGPT · Claude · Gemini · DeepSeek · Perplexity · Grok · Microsoft Copilot · Poe · Mistral Le Chat

AI sites change their page structure from time to time. If capture can't find individual messages, Capsule Flow falls back to the visible page text and tells you, so you can trim it before saving. Platform selectors live in `shared/platforms.js`, so updating a site is a one-line change.

### Keyboard shortcuts
| Shortcut | Action |
|---|---|
| `Ctrl+Shift+K` (`⌘+Shift+K` on Mac) | Open / close the panel on an AI site |
| `Alt+Shift+C` | Capture the current conversation |
| `Esc` | Close the panel or dialog |
| `Ctrl+S` | Save the capsule open in the dashboard |

You can change the shortcuts at `chrome://extensions/shortcuts`.

## Settings
- **Theme:** Aurora (dark teal, the default), Daylight (light), or Ember (dark burgundy). Changing it updates open tabs immediately.
- **Floating button:** show or hide it, bottom-right or bottom-left.
- **Capsule format:** *Brief + recent messages* (default, keeps the last N messages) or *Brief + full transcript*. There's also a maximum length, and the oldest messages are trimmed first.
- **Injection:** add the capsule after, before, or in place of existing text.
- **Paste as a ready-to-use prompt (on by default):** the capsule is wrapped in instructions the other AI can follow. It gets an intro saying where the context came from, rules for using each section (follow the constraints, build on the key points, don't summarise it back), the capsule inside `<context_capsule>` tags with clear headings, and a closing step. You choose the closing step: *reply only with the Capsule Flow greeting* (default — the AI answers "Hey! 👋 I got you! Have any doubts? Just ask me. Thank you for using Capsule Flow! 🙏" and waits), *confirm the goal, then continue where I left off*, or *no instruction*. Site disclaimers such as "ChatGPT can make mistakes" are stripped on capture and again on paste. The dashboard's **Prompt preview** tab shows exactly what will be pasted.

## Import / export
Dashboard → **Import & export**. JSON export/import is safe to repeat (duplicates are skipped). Markdown export is for reading or sharing. Capsules from Capsule Flow 1.x are migrated automatically on update.

## Project structure
```
manifest.json            MV3 manifest
background/background.js  Service worker: context menus, shortcuts, injects the content script on demand
content/content.js        In-page button + panel (Shadow DOM), capture, inject, drag & drop
content/widget.css        Panel styles (source)
content/widget-styles.js  Generated from shared/theme.css + content/widget.css
popup/                    Toolbar popup
options/                  Dashboard, settings, import/export, help
shared/platforms.js       Per-site selectors (messages + chat input)
shared/store.js           Local storage layer (capsules, folders, prefs, versions, import/export)
shared/format.js          Brief builder + injection formatting
shared/icons.js           Inline SVG icons
shared/theme.css          Colour tokens for all three themes
tools/build-styles.js     Rebuilds content/widget-styles.js (run: node tools/build-styles.js)
icons/                    Toolbar / store icons
```

If you edit `shared/theme.css` or `content/widget.css`, run `node tools/build-styles.js` and reload the extension.

## Permissions, and why
- `storage`: saves your capsules locally.
- `contextMenus`: the right-click "Save selection" and "Capture this chat" items.
- `activeTab` + `scripting`: attaches the panel to an AI tab that was already open before install or update.
- Host access to the supported AI sites only, so the panel can read the conversation and write into the chat box.
