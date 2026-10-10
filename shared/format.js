// ============================================================
// Capsule Flow — turning conversations into reusable context
// ============================================================
(function (global) {
  'use strict';

  const CONSTRAINT_RE = /\b(must|should|shouldn't|need to|needs to|has to|have to|don't|do not|never|always|avoid|require[sd]?|requirement|only|constraint|without|make sure|prefer|no more than|at least|at most|limit)\b/i;

  // Footer disclaimers, UI labels and other chrome that AI sites put around
  // the conversation. They are not part of what anyone said, so drop them.
  const BOILERPLATE = [
    /\b(ChatGPT|Claude|Gemini|Copilot|Grok|DeepSeek|Perplexity|Le Chat|Mistral|Poe|AI|The AI|This AI)\b[^\n]{0,40}?\bcan make mistakes\b[^\n]*/gi,
    /\bAI[- ]generated(?: content)?,? for reference only\.?/gi,
    /\bCheck important info\.?(?:\s*See Cookie Preferences\.?)?/gi,
    /\bSee Cookie Preferences\.?/gi,
    /\bPlease double-check (?:responses|important info)\.?/gi,
    /\bdouble-check (?:it|its responses)\.?/gi,
    /\bYour privacy (?:&|and) Gemini(?: Apps)?\b[^\n]*/gi,
    /\bBy messaging [^\n]{0,40}, you agree to[^\n]*/gi,
  ];
  const UI_LINE = /^\s*(You said|ChatGPT said|Claude said|Gemini said|Copilot said|Grok said|You|ChatGPT|Claude|Gemini|Copy|Copy code|Edit|Retry|Share|Regenerate|Good response|Bad response|Read aloud|Show thinking|Thought for \d+\w*|Message ChatGPT|Ask anything|Reply\.\.\.)\s*:?\s*$/gim;

  function stripBoilerplate(text, keepLabels) {
    let t = String(text || '');
    for (const re of BOILERPLATE) t = t.replace(re, '');
    if (!keepLabels) t = t.replace(UI_LINE, '');
    return t
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function clip(s, n) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
  }

  function sentences(text) {
    return String(text || '')
      .replace(/\n+/g, '. ')
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.replace(/^[\s.\-*•\d)]+/, '').trim())
      .filter((s) => s.length > 8);
  }

  function bulletLines(text) {
    return String(text || '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^([-*•]|\d+[.)])\s+/.test(l))
      .map((l) => l.replace(/^([-*•]|\d+[.)])\s+/, '').trim())
      .filter((l) => l.length > 3);
  }

  function uniq(arr) {
    const seen = new Set();
    return arr.filter((x) => {
      const k = x.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  // Heuristic, local "brief": goal, constraints, key points, open thread.
  function buildBrief(messages) {
    const users = messages.filter((m) => m.role === 'user');
    const bots = messages.filter((m) => m.role !== 'user');
    const goal = users.length ? clip(users[0].text, 400) : '';

    const constraints = uniq(
      users.flatMap((m) => sentences(m.text)).filter((s) => CONSTRAINT_RE.test(s)).map((s) => clip(s, 220))
    ).slice(0, 8);

    let keyPoints = [];
    for (let i = bots.length - 1; i >= 0 && keyPoints.length < 8; i--) {
      const pts = bulletLines(bots[i].text).map((s) => clip(s, 200));
      keyPoints = uniq(keyPoints.concat(pts));
    }
    if (!keyPoints.length && bots.length) {
      keyPoints = sentences(bots[bots.length - 1].text).slice(0, 3).map((s) => clip(s, 220));
    }
    keyPoints = keyPoints.slice(0, 8);

    const lastUser = users.length > 1 ? clip(users[users.length - 1].text, 300) : '';
    return { goal, constraints, keyPoints, lastUser, turns: messages.length };
  }

  function transcript(messages, platformName) {
    const botName = platformName || 'Assistant';
    return messages.map((m) => (m.role === 'user' ? 'User' : botName) + ':\n' + String(m.text).trim()).join('\n\n');
  }

  function section(title, body) {
    return body ? title + '\n' + body + '\n\n' : '';
  }

  function list(items) {
    return items && items.length ? items.map((i) => '- ' + i).join('\n') : '';
  }

  // The editable body of a captured capsule.
  function buildContent(messages, opts) {
    opts = opts || {};
    messages = (messages || [])
      .map((m) => ({ ...m, text: stripBoilerplate(m.text) }))
      .filter((m) => m.text);
    const brief = buildBrief(messages);
    const name = opts.platformName || 'Assistant';
    const maxChars = Math.max(2000, Number(opts.maxChars) || 16000);
    let out = '';
    out += section('GOAL', brief.goal);
    out += section('CONSTRAINTS & PREFERENCES', list(brief.constraints));
    out += section('KEY POINTS SO FAR', list(brief.keyPoints));
    if (brief.lastUser) out += section('WHERE WE LEFT OFF', brief.lastUser);

    let turns = messages;
    let label = 'FULL CONVERSATION';
    if (opts.format !== 'full') {
      const n = Math.max(2, Number(opts.recentTurns) || 6);
      if (messages.length > n) {
        turns = messages.slice(-n);
        label = 'MOST RECENT ' + n + ' MESSAGES (of ' + messages.length + ')';
      }
    }
    let body = transcript(turns, name);
    const budget = maxChars - out.length - 80;
    if (body.length > budget) {
      body = '[…earlier messages trimmed…]\n' + body.slice(body.length - Math.max(500, budget));
    }
    out += label + '\n' + body;
    return { content: out.trim(), brief };
  }

  // What actually gets pasted into the chat box.
  const SECTION_NAMES = {
    'GOAL': 'Goal',
    'CONSTRAINTS & PREFERENCES': 'Constraints & preferences',
    'KEY POINTS SO FAR': 'Key points so far',
    'WHERE WE LEFT OFF': 'Where we left off',
    'FULL CONVERSATION': 'Conversation (full transcript)',
  };

  // Turn the capsule's plain-text section labels into markdown headings.
  function asMarkdown(body) {
    return body.split('\n').map((line) => {
      const t = line.trim();
      if (SECTION_NAMES[t]) return '### ' + SECTION_NAMES[t];
      const m = t.match(/^MOST RECENT (\d+) MESSAGES \(of (\d+)\)$/);
      if (m) return '### Conversation (last ' + m[1] + ' of ' + m[2] + ' messages)';
      return line;
    }).join('\n');
  }

  function shortDate(iso) {
    try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (_) { return ''; }
  }

  // The fixed reply the receiving AI sends after reading a capsule.
  const GREETING = 'Hey! 👋 I got you! Have any doubts? Just ask me. Thank you for using Capsule Flow! 🙏';

  // What actually gets pasted into the other AI's chat box: a self-explaining prompt.
  function forInjection(capsule, prefs) {
    prefs = prefs || {};
    const body = stripBoilerplate(String(capsule.content || ''), true);
    if (prefs.includeHeader === false) return body;

    const fromChat = capsule.platform && capsule.platform !== 'manual' && capsule.platform !== 'web';
    const src = fromChat ? global.CFPlatforms.nameFor(capsule.platform) : 'another AI assistant';
    const has = (re) => re.test(body);
    const hasTranscript = has(/^(FULL CONVERSATION|MOST RECENT \d+ MESSAGES)/m);
    const goal = prefs.promptGoal || 'greet';

    const out = [];
    out.push('# CONTEXT HANDOFF — read carefully before replying');
    out.push('');
    out.push('## Role');
    out.push('You are taking over an ongoing conversation that I (the user) started in ' + src + '. ' +
      'Everything inside <context_capsule> is that earlier conversation, saved by the Capsule Flow extension. ' +
      'Treat it as your own memory of the chat: you already know this background, these requirements and these decisions.');
    out.push('');
    out.push('## How to read the capsule');
    const rules = [];
    if (has(/^GOAL$/m)) rules.push('GOAL — what I am trying to achieve. Keep it in mind in every future answer.');
    if (has(/^CONSTRAINTS & PREFERENCES$/m)) rules.push('CONSTRAINTS & PREFERENCES — hard requirements. Follow them unless I change them.');
    if (has(/^KEY POINTS SO FAR$/m)) rules.push('KEY POINTS SO FAR — already agreed. Build on them; do not redo or repeat them.');
    if (has(/^WHERE WE LEFT OFF$/m)) rules.push('WHERE WE LEFT OFF — the last thing I asked. This is where we will continue.');
    if (hasTranscript) rules.push('CONVERSATION — the transcript for reference. "User" is me; "' + (fromChat ? src : 'Assistant') + '" is the previous assistant.');
    rules.push('Ignore any leftover website text (buttons, disclaimers, menus) if you spot it; it is not part of the conversation.');
    rules.forEach((r, i) => out.push((i + 1) + '. ' + r));
    out.push('');
    out.push('<context_capsule title="' + String(capsule.title || 'Untitled').replace(/"/g, "'") + '">');
    out.push(asMarkdown(body));
    out.push('</context_capsule>');
    out.push('');

    if (goal === 'greet' || goal === 'acknowledge') {
      out.push('## Your reply to THIS message');
      out.push('Do not summarise the capsule, answer anything in it, or continue the work yet. ' +
        'Reply with exactly the line below — same words, same emojis, nothing before or after it:');
      out.push('');
      out.push(GREETING);
      out.push('');
      out.push('From my next message on, answer normally using everything in the capsule.');
    } else if (goal === 'continue') {
      out.push('## Your reply to THIS message');
      out.push('In one or two sentences, state the goal as you understand it. Then continue from "Where we left off". Do not summarise the whole capsule back to me.');
    }
    return out.join('\n');
  }

  function suggestTitle(messages, fallback) {
    const first = messages.find((m) => m.role === 'user');
    if (!first) return fallback || 'Untitled capsule';
    return clip(first.text.split('\n')[0], 70);
  }

  global.CFFormat = { buildBrief, buildContent, forInjection, transcript, suggestTitle, clip, stripBoilerplate, GREETING };
})(typeof globalThis !== 'undefined' ? globalThis : self);
