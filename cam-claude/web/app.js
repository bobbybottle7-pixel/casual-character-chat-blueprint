import { api } from './lib/api.js';
import { escapeHtml } from './lib/markdown.js';
import {
  createApproval,
  createErrorBanner,
  createMessage,
  createSceneDivider,
  createSystemNote,
} from './components/message.js';
import { initLibrary, initModePicker, initSetup } from './components/sheets.js';

const $ = (id) => document.getElementById(id);

const state = {
  modes: [],
  mode: null,
  conversationId: null,
  conversations: [],
  stream: null,
  live: null, // the assistant message currently streaming
  busy: false,
};

/* ---------------------------------- startup -------------------------------- */

let modePicker;
let library;
let setup;

async function boot() {
  const [health, modes] = await Promise.all([api.health(), api.modes()]);
  state.modes = modes;

  const pill = $('auth-pill');
  pill.textContent = authLabel(health.auth);
  pill.dataset.kind = health.auth.kind;
  pill.title = health.auth.detail + (health.auth.fix ? `\n${health.auth.fix}` : '');

  modePicker = initModePicker(modes, onModePicked);
  library = initLibrary(() => undefined);
  setup = initSetup();

  wireComposer();
  wireChrome();

  await refreshConversations();
  const last = localStorage.getItem('camClaude.lastConversation');
  if (last && state.conversations.some((c) => c.id === last)) await openConversation(last);
  else setMode(modes[0]);
}

function authLabel(auth) {
  switch (auth.kind) {
    case 'subscription': return '● subscription';
    case 'host-managed': return '● host-managed';
    case 'api-key': return '● api key';
    default: return '● auth not detected';
  }
}

/* ------------------------------- conversations ----------------------------- */

async function refreshConversations() {
  state.conversations = await api.listConversations();
  const list = $('conversation-list');
  list.replaceChildren();

  if (!state.conversations.length) {
    list.innerHTML = '<p class="empty">No conversations yet.</p>';
    return;
  }

  for (const conv of state.conversations) {
    const mode = state.modes.find((m) => m.id === conv.mode_id);
    const item = document.createElement('button');
    item.className = 'conversation-item';
    item.setAttribute('aria-current', String(conv.id === state.conversationId));
    item.innerHTML = `<span>${mode?.icon ?? '💬'}</span><span class="ci-title">${escapeHtml(conv.title)}</span>`;

    const remove = document.createElement('span');
    remove.className = 'ci-delete';
    remove.textContent = '✕';
    remove.title = 'Delete';
    remove.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (!confirm(`Delete "${conv.title}"?`)) return;
      await api.deleteConversation(conv.id);
      if (state.conversationId === conv.id) {
        state.conversationId = null;
        closeStream();
        $('transcript').replaceChildren();
      }
      await refreshConversations();
    });
    item.append(remove);

    item.addEventListener('click', () => openConversation(conv.id));
    list.append(item);
  }
}

async function newConversation(mode) {
  const extra = await setup.collect(mode);
  if (extra === null) return;

  const conv = await api.createConversation({ modeId: mode.id, ...extra });
  await refreshConversations();
  await openConversation(conv.id);
}

async function openConversation(id) {
  closeStream();
  state.conversationId = id;
  localStorage.setItem('camClaude.lastConversation', id);

  const data = await api.getConversation(id);
  setMode(state.modes.find((m) => m.id === data.conversation.mode_id) ?? state.modes[0]);
  $('conversation-title').textContent = data.conversation.title;

  const transcript = $('transcript');
  transcript.replaceChildren();

  for (const row of data.messages) {
    if (row.role === 'system') {
      transcript.append(createSystemNote(row.text));
      continue;
    }
    const message = createMessage(row.role, { showThinking: state.mode.ui.showThinking });
    message.setText(row.text);
    message.setThinking(row.thinking);
    if (row.tool_calls) {
      for (const call of JSON.parse(row.tool_calls)) {
        message.addTool(call.id, call.name, call.input);
        message.resolveTool(call.id, false, '');
      }
    }
    transcript.append(message.node);
  }

  // Dice and scene breaks are replayed from their own table so they survive a
  // reload even though they were never part of any message's text.
  for (const event of data.gmEvents ?? []) {
    if (event.kind === 'roll') {
      const note = createMessage('assistant', { showThinking: false });
      note.addRoll(event.data);
      transcript.append(note.node);
    } else if (event.kind === 'scene' && event.data?.kind === 'break') {
      transcript.append(createSceneDivider(`${event.data.location} · ${event.data.time}`));
    }
  }

  renderContextBar(data);
  renderInspector(data);
  scrollToEnd();
  await refreshConversations();
  openStream(id);
}

/* ----------------------------------- modes --------------------------------- */

function setMode(mode) {
  state.mode = mode;
  $('mode-chip-icon').textContent = mode.icon;
  $('mode-chip-label').textContent = mode.label;
  $('input').placeholder = mode.ui.placeholder;
  document.body.className = `mode-${mode.id}`;
  renderComposerActions();

  const app = $('app');
  const wantsInspector = Boolean(mode.ui.sidebar);
  app.classList.toggle('with-inspector', wantsInspector);
  $('inspector').hidden = !wantsInspector;
  $('inspector-title').textContent =
    mode.ui.sidebar === 'characters' ? 'Scene' : mode.ui.sidebar === 'sources' ? 'Sources' : 'Project';
}

async function onModePicked(mode, intent) {
  // "New chat" always starts a conversation; the mode chip moves the one that
  // is already open.
  if (intent === 'new' || !state.conversationId) {
    await newConversation(mode);
    return;
  }
  if (mode.id === state.mode?.id) return;

  const extra = await setup.collect(mode);
  if (extra === null) return;

  await api.updateConversation(state.conversationId, { modeId: mode.id, ...extra });
  await openConversation(state.conversationId);
}

/* ---------------------------------- streaming ------------------------------- */

function closeStream() {
  state.stream?.close();
  state.stream = null;
  state.live = null;
  setBusy(false);
}

function openStream(conversationId) {
  const source = new EventSource(`/api/conversations/${conversationId}/stream`);
  state.stream = source;

  source.onmessage = (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    handleEvent(payload);
  };

  source.onerror = () => {
    // EventSource reconnects on its own; a transient drop should not look like
    // a failure to the user.
  };
}

function handleEvent(event) {
  const transcript = $('transcript');

  switch (event.type) {
    case 'turn_start': {
      state.live = createMessage('assistant', { showThinking: state.mode.ui.showThinking });
      state.live.markStreaming(true);
      transcript.append(state.live.node);
      setBusy(true);
      scrollToEnd();
      return;
    }

    case 'text_delta': {
      state.live?.appendText(event.text);
      scrollToEnd();
      return;
    }

    case 'thinking_delta': {
      state.live?.appendThinking(event.text);
      return;
    }

    case 'tool_use': {
      if (state.mode.ui.showToolCalls) state.live?.addTool(event.id, event.name, event.input);
      scrollToEnd();
      return;
    }

    case 'tool_result': {
      state.live?.resolveTool(event.id, event.isError, event.preview);
      return;
    }

    case 'gm_event': {
      const gm = event.event;
      if (gm.kind === 'roll') state.live?.addRoll(gm.data);
      else if (gm.kind === 'scene' && gm.data?.kind === 'break') {
        transcript.append(createSceneDivider(`${gm.data.location} · ${gm.data.time}`));
      }
      refreshWorld();
      scrollToEnd();
      return;
    }

    case 'permission_request': {
      const card = createApproval(event, (allow) =>
        api.resolvePermission(state.conversationId, event.id, allow).catch(() => undefined));
      transcript.append(card);
      scrollToEnd();
      return;
    }

    case 'turn_end': {
      state.live?.markStreaming(false);
      state.live = null;
      setBusy(false);
      refreshConversations().then(syncTitle);
      return;
    }

    case 'usage': {
      const bits = [];
      if (event.inputTokens !== undefined) bits.push(`${event.inputTokens.toLocaleString()} in`);
      if (event.outputTokens !== undefined) bits.push(`${event.outputTokens.toLocaleString()} out`);
      $('usage').textContent = bits.join(' · ');
      return;
    }

    case 'error': {
      transcript.append(createErrorBanner(event.message));
      state.live?.markStreaming(false);
      state.live = null;
      setBusy(false);
      scrollToEnd();
      return;
    }

    default:
      return;
  }
}

/* ---------------------------------- composer -------------------------------- */

function renderComposerActions() {
  const actions = $('composer-actions');
  actions.replaceChildren();

  if (state.mode?.ui.composer === 'roleplay') {
    // The old app's two send buttons: in-character reply vs narration.
    actions.append(
      sendButton('💬 Character', 'dialog', true),
      sendButton('📖 Narrator', 'narrator', false),
    );
  } else {
    actions.append(sendButton('Send', undefined, true));
  }

  const stop = document.createElement('button');
  stop.type = 'button';
  stop.className = 'btn btn-ghost btn-sm';
  stop.id = 'stop';
  stop.textContent = 'Stop';
  stop.hidden = true;
  stop.addEventListener('click', () => api.interrupt(state.conversationId).catch(() => undefined));
  actions.append(stop);

  $('composer-hint').textContent =
    state.mode?.ui.composer === 'roleplay'
      ? 'Enter sends in character · Shift+Enter for a new line'
      : 'Enter to send · Shift+Enter for a new line';
}

function sendButton(label, replyKind, primary) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `btn btn-sm ${primary ? 'btn-primary' : ''}`;
  button.textContent = label;
  button.dataset.send = 'true';
  button.addEventListener('click', () => submit(replyKind));
  return button;
}

function wireComposer() {
  const input = $('input');
  const form = $('composer');

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit(state.mode?.ui.composer === 'roleplay' ? 'dialog' : undefined);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit(state.mode?.ui.composer === 'roleplay' ? 'dialog' : undefined);
    }
  });

  // Grow with the content instead of scrolling a one-line box.
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 240)}px`;
  });
}

async function submit(replyKind) {
  const input = $('input');
  const text = input.value.trim();
  if (!text || state.busy) return;

  if (!state.conversationId) {
    await newConversation(state.mode);
    if (!state.conversationId) return;
  }

  input.value = '';
  input.style.height = 'auto';

  const message = createMessage('user');
  message.setText(text);
  $('transcript').append(message.node);
  scrollToEnd();
  setBusy(true);

  try {
    await api.sendMessage(state.conversationId, { text, ...(replyKind ? { replyKind } : {}) });
  } catch (error) {
    $('transcript').append(createErrorBanner(error.message));
    setBusy(false);
  }
}

function setBusy(busy) {
  state.busy = busy;
  for (const button of document.querySelectorAll('[data-send]')) button.disabled = busy;
  const stop = $('stop');
  if (stop) stop.hidden = !busy;
}

/* --------------------------------- inspector -------------------------------- */

async function refreshWorld() {
  if (!state.conversationId || state.mode?.ui.sidebar !== 'characters') return;
  const data = await api.getConversation(state.conversationId).catch(() => null);
  if (data) renderInspector(data);
}

function renderContextBar(data) {
  const bar = $('context-bar');
  const bits = [];
  if (data.conversation.cwd) bits.push(`<code>${escapeHtml(data.conversation.cwd)}</code>`);
  bar.innerHTML = bits.join(' ');
  bar.hidden = !bits.length;
}

function renderInspector(data) {
  const body = $('inspector-body');
  if (state.mode?.ui.sidebar !== 'characters') {
    body.innerHTML = data.conversation.cwd
      ? `<h4>Folder</h4><p><code>${escapeHtml(data.conversation.cwd)}</code></p>`
      : '<p class="empty">Nothing to show yet.</p>';
    return;
  }

  const world = data.world ?? { state: {}, stats: {}, inventory: {} };
  const rows = Object.entries({
    Scene: world.state.scene,
    Location: world.state.location,
    Time: world.state.time,
    Present: world.state.present?.join(', '),
  }).filter(([, v]) => v);

  const statBlocks = Object.entries(world.stats ?? {});
  const invBlocks = Object.entries(world.inventory ?? {}).filter(([, items]) => items.length);
  const facts = Object.entries(world.state.flags ?? {});

  body.innerHTML = `
    <h4>World</h4>
    ${rows.length
      ? `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(String(v))}</dd>`).join('')}</dl>`
      : '<p class="empty">Nothing established yet.</p>'}
    ${statBlocks.length
      ? `<h4>Stats</h4>${statBlocks
          .map(([who, stats]) =>
            `<dl><dt>${escapeHtml(who)}</dt><dd>${Object.entries(stats)
              .map(([k, v]) => `${escapeHtml(k)} ${v}`)
              .join(', ')}</dd></dl>`)
          .join('')}`
      : ''}
    ${invBlocks.length
      ? `<h4>Inventory</h4>${invBlocks
          .map(([who, items]) =>
            `<dl><dt>${escapeHtml(who)}</dt><dd>${escapeHtml(items.join(', '))}</dd></dl>`)
          .join('')}`
      : ''}
    ${facts.length
      ? `<h4>Established</h4><ul>${facts
          .map(([k, v]) => `<li>${escapeHtml(k)}: ${escapeHtml(String(v))}</li>`)
          .join('')}</ul>`
      : ''}
    ${data.memories?.length
      ? `<h4>Memory</h4><ul>${data.memories.map((m) => `<li>${escapeHtml(m.text)}</li>`).join('')}</ul>`
      : ''}`;
}

/* ----------------------------------- chrome --------------------------------- */

function wireChrome() {
  $('new-chat').addEventListener('click', () => modePicker.open(state.mode?.id, 'new'));
  $('toggle-sidebar').addEventListener('click', () => $('sidebar').classList.toggle('open'));
  $('close-inspector').addEventListener('click', () => {
    $('inspector').hidden = true;
    $('app').classList.remove('with-inspector');
  });

  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault();
      modePicker.open(state.mode?.id, 'new');
    }
  });
}

/** The server titles a conversation from its first message; reflect that here. */
function syncTitle() {
  const conv = state.conversations.find((c) => c.id === state.conversationId);
  if (conv) $('conversation-title').textContent = conv.title;
}

function scrollToEnd() {
  const transcript = $('transcript');
  transcript.scrollTop = transcript.scrollHeight;
}

boot().catch((error) => {
  document.body.innerHTML = `<div class="error-banner" style="margin:40px auto;max-width:600px">
    <strong>Cam Claude failed to start:</strong> ${escapeHtml(error.message)}</div>`;
});
