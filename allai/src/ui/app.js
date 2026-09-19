/* ===========================================================================
 * ALLAI — application shell
 *
 * Wires the screens to the core. Deliberately plain JavaScript: no framework,
 * no build step, nothing to install. The whole app is one page and a handful
 * of files, which is what makes it work when it is copied onto a phone.
 * ======================================================================== */

import { listProviders, listModels, getProvider, isProviderReady } from '../core/providers/registry.js';
import '../core/providers/pollinations.js';
import '../core/providers/openrouter.js';
import '../core/providers/venice.js';
import { setCustomModels } from '../core/providers/custom.js';
import { sendChat, buildMessages, explainError } from '../core/chat.js';
import { DEFAULT_BUDGET_SETTINGS, isFreeModel, formatUsd, estimateCostUsd, authorize } from '../core/budget.js';
import {
  STORES, getAllSettings, setSetting, getAll, put, remove, clearStore,
  maskKey, deleteEverything,
} from '../core/storage.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* --- application state ----------------------------------------------------
 * Held in one object so it is obvious what the app knows. Anything that must
 * survive closing the tab is written to storage; anything here that is not
 * written is, by definition, temporary context.
 */
const state = {
  settings: {},
  providerConfig: {},
  budget: { ...DEFAULT_BUDGET_SETTINGS },
  models: [],
  selectedModelKey: null,
  conversation: { id: null, title: 'New conversation', messages: [] },
  memories: [],
  memoryEnabled: true,
  systemPrompt: '',
  sending: false,
  controller: null,
};

const modelKey = (m) => `${m.providerId}::${m.id}`;
const findModelByKey = (key) => state.models.find(m => modelKey(m) === key) || null;

/* ========================================================================
 * Boot
 * ===================================================================== */
async function boot() {
  try {
    await loadPersisted();
  } catch (err) {
    // A phone in private mode can refuse storage entirely. The app should
    // still run; it just will not remember anything between visits.
    showChatNotice(`ALLAI could not open its storage, so nothing will be saved this session. (${err.message})`);
  }
  refreshModels();
  buildNav();
  renderAll();
  attachEvents();
  // Live catalogs come after first paint so a slow network never blocks the UI.
  refreshRemoteCatalogs();
}

async function loadPersisted() {
  const settings = await getAllSettings();
  state.settings = settings;
  state.providerConfig = settings.providerConfig || {};
  state.budget = { ...DEFAULT_BUDGET_SETTINGS, ...(settings.budget || {}) };
  state.selectedModelKey = settings.selectedModelKey || null;
  state.memoryEnabled = settings.memoryEnabled !== false;
  state.systemPrompt = settings.systemPrompt || '';
  setCustomModels(settings.customModels || []);
  state.memories = (await getAll(STORES.MEMORIES)) || [];
}

function enabledProviderIds() {
  return listProviders()
    .filter(p => {
      const cfg = state.providerConfig[p.id] || {};
      if (cfg.enabled === false) return false;
      if (cfg.enabled === true) return true;
      return p.enabledByDefault === true;
    })
    .map(p => p.id);
}

function refreshModels() {
  state.models = listModels({ enabledProviderIds: enabledProviderIds() });
  if (!findModelByKey(state.selectedModelKey)) {
    const firstFree = state.models.find(isFreeModel);
    state.selectedModelKey = firstFree ? modelKey(firstFree) : (state.models[0] ? modelKey(state.models[0]) : null);
  }
}

/** Pulls live model lists from providers that publish one. Failures are quiet
 *  on purpose: a provider being unreachable is not an error worth a popup. */
async function refreshRemoteCatalogs() {
  const ids = enabledProviderIds();
  await Promise.all(listProviders().map(async (p) => {
    if (!ids.includes(p.id) || typeof p.fetchModels !== 'function') return;
    if (p.auth?.required && !isProviderReady(p, state.providerConfig)) return;
    try { await p.fetchModels(state.providerConfig[p.id] || {}); } catch { /* offline or blocked */ }
  }));
  refreshModels();
  renderModelPicker();
  renderModelsScreen();
}

/* ========================================================================
 * Navigation
 * ===================================================================== */
const SCREENS = [
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'models', label: 'Models', icon: '🧠' },
  { id: 'characters', label: 'Characters', icon: '🎭' },
  { id: 'council', label: 'Council', icon: '⚖️' },
  { id: 'lab', label: 'Lab', icon: '🔬' },
  { id: 'memory', label: 'Memory', icon: '📌' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

function buildNav() {
  const nav = $('#app-nav');
  nav.innerHTML = SCREENS.map(s =>
    `<button type="button" data-screen="${s.id}"><span class="ico">${s.icon}</span>${s.label}</button>`
  ).join('');
  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-screen]');
    if (btn) showScreen(btn.dataset.screen);
  });
}

function showScreen(id) {
  $$('.screen').forEach(el => el.classList.toggle('active', el.id === `screen-${id}`));
  $$('#app-nav button').forEach(b => {
    if (b.dataset.screen === id) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  if (id === 'models') renderModelsScreen();
  if (id === 'memory') renderMemoryScreen();
  if (id === 'settings') renderSettingsScreen();
}

function renderAll() {
  renderModelPicker();
  renderMessages();
  renderModelsScreen();
  renderMemoryScreen();
  renderSettingsScreen();
  showScreen('chat');
}

/* ========================================================================
 * Model picker + model facts
 * ===================================================================== */
function describeContext(m) {
  return m.contextTokens ? `${Math.round(m.contextTokens / 1000)}k context` : 'context not published';
}

function priceTag(m) {
  if (isFreeModel(m)) return '<span class="tag free">FREE</span>';
  if (!m.pricing) return '<span class="tag unknown">PRICE UNKNOWN</span>';
  return `<span class="tag paid">$${m.pricing.inPerMTok.toFixed(2)}/$${m.pricing.outPerMTok.toFixed(2)} per M</span>`;
}

function renderModelPicker() {
  const select = $('#model-select');
  if (!select) return;
  if (state.models.length === 0) {
    select.innerHTML = '<option value="">No models available</option>';
    return;
  }
  const byProvider = new Map();
  for (const m of state.models) {
    if (!byProvider.has(m.providerId)) byProvider.set(m.providerId, []);
    byProvider.get(m.providerId).push(m);
  }
  select.innerHTML = [...byProvider.entries()].map(([pid, models]) => {
    const provider = getProvider(pid);
    const options = models.map(m => {
      const badge = isFreeModel(m) ? 'free' : (m.pricing ? 'paid' : 'price unknown');
      return `<option value="${escapeAttr(modelKey(m))}">${escapeHtml(m.name)} — ${badge}</option>`;
    }).join('');
    return `<optgroup label="${escapeAttr(provider?.name || pid)}">${options}</optgroup>`;
  }).join('');
  if (state.selectedModelKey) select.value = state.selectedModelKey;
  renderModelFacts();
}

function renderModelFacts() {
  const el = $('#model-facts');
  if (!el) return;
  const m = findModelByKey(state.selectedModelKey);
  if (!m) { el.innerHTML = '<span class="tag">no model selected</span>'; return; }
  const provider = getProvider(m.providerId);
  const bits = [
    priceTag(m),
    `<span class="tag">${escapeHtml(provider?.name || m.providerId)}</span>`,
    `<span class="tag">${describeContext(m)}</span>`,
    `<span class="tag">${m.vision ? 'vision' : 'text only'}</span>`,
    `<span class="tag">${m.tools ? 'tools' : 'no tools'}</span>`,
    `<span class="tag">${m.hosting}</span>`,
  ];
  if (m.moderated === true) bits.push('<span class="tag paid">provider moderation on</span>');
  if (m.moderated === false) bits.push('<span class="tag free">no extra moderation layer</span>');
  el.innerHTML = bits.join(' ');
}

function renderModelsScreen() {
  const list = $('#models-list');
  if (!list) return;
  if (state.models.length === 0) {
    list.innerHTML = '<p class="empty">No providers are switched on. Open Settings to enable one.</p>';
    return;
  }
  const byProvider = new Map();
  for (const m of state.models) {
    if (!byProvider.has(m.providerId)) byProvider.set(m.providerId, []);
    byProvider.get(m.providerId).push(m);
  }
  list.innerHTML = [...byProvider.entries()].map(([pid, models]) => {
    const p = getProvider(pid);
    const ready = isProviderReady(p, state.providerConfig);
    const shown = models.slice(0, 40);
    const rows = shown.map(m => `
      <div class="card">
        <h3>${escapeHtml(m.name)}</h3>
        <p class="mono">${escapeHtml(m.id)}</p>
        <div class="row tight">
          ${priceTag(m)}
          <span class="tag">${describeContext(m)}</span>
          <span class="tag">${m.vision ? 'vision' : 'text only'}</span>
          <span class="tag">${m.tools ? 'tools' : 'no tools'}</span>
          <span class="tag">${m.hosting}</span>
          ${m.moderated === false ? '<span class="tag free">no extra moderation layer</span>' : ''}
          ${m.moderated === true ? '<span class="tag paid">provider moderation on</span>' : ''}
        </div>
        ${m.notes ? `<p style="margin-top:8px">${escapeHtml(m.notes)}</p>` : ''}
      </div>`).join('');
    const more = models.length > shown.length
      ? `<p class="empty">${models.length - shown.length} more models from this provider are available and can be chosen in Chat.</p>` : '';
    return `
      <div class="card" style="background:var(--surface-2)">
        <h3>${escapeHtml(p?.name || pid)} ${ready ? '' : '<span class="tag paid">needs a key</span>'}</h3>
        <p><strong>Restrictions:</strong> ${escapeHtml(p?.restrictions || 'Not documented.')}</p>
        <p><strong>Cost:</strong> ${escapeHtml(p?.costNote || 'Unknown.')}</p>
      </div>
      ${rows}${more}`;
  }).join('');
}

/* ========================================================================
 * Chat
 * ===================================================================== */
function renderMessages() {
  const box = $('#messages');
  if (!box) return;
  if (state.conversation.messages.length === 0) {
    box.innerHTML = `<div class="msg system">New conversation. Whatever you type goes straight from this phone to the provider you picked — ALLAI has no server of its own.</div>`;
    return;
  }
  box.innerHTML = state.conversation.messages.map(renderMessage).join('');
  box.scrollTop = box.scrollHeight;
}

function renderMessage(m) {
  const cls = m.role === 'user' ? 'user' : m.error ? 'assistant error' : m.role === 'system' ? 'system' : 'assistant';
  const meta = m.meta ? `<span class="meta">${escapeHtml(m.meta)}</span>` : '';
  return `<div class="msg ${cls}">${escapeHtml(m.content)}${meta}</div>`;
}

function showChatNotice(text) {
  state.conversation.messages.push({ role: 'system', content: text });
  renderMessages();
}

async function handleSend() {
  if (state.sending) return;
  const input = $('#composer-input');
  const text = input.value.trim();
  if (!text) return;

  const model = findModelByKey(state.selectedModelKey);
  if (!model) { showChatNotice('Pick a model first.'); return; }

  // Budget check happens here too, so the estimate can be shown BEFORE
  // anything is sent. sendChat() checks again; this one is for the human.
  const history = [...state.conversation.messages.filter(m => m.role === 'user' || m.role === 'assistant'),
                   { role: 'user', content: text }];
  const messages = buildMessages({
    systemPrompt: state.systemPrompt,
    memories: state.memories,
    history,
    memoryEnabled: state.memoryEnabled,
  });

  let approved = false;
  const gate = authorize({ model, messages, settings: state.budget });
  if (gate.requiresApproval) {
    approved = window.confirm(`${gate.message}\n\nSend it?`);
    if (!approved) return;
  } else if (!gate.allowed) {
    showChatNotice(gate.message);
    return;
  }

  input.value = '';
  input.style.height = '';
  state.conversation.messages.push({ role: 'user', content: text });

  const assistantMsg = { role: 'assistant', content: '', meta: 'thinking…' };
  state.conversation.messages.push(assistantMsg);
  renderMessages();
  setSending(true);

  state.controller = new AbortController();
  try {
    const reply = await sendChat({
      model,
      messages,
      providerConfig: state.providerConfig,
      budgetSettings: state.budget,
      approved,
      signal: state.controller.signal,
      onDelta: (chunk) => {
        assistantMsg.content += chunk;
        assistantMsg.meta = '';
        renderMessages();
      },
    });
    assistantMsg.content = reply.text || assistantMsg.content;
    assistantMsg.meta = describeReply(model, reply);
    if (!assistantMsg.content) {
      assistantMsg.content = '(The model sent an empty reply.)';
    }
  } catch (err) {
    if (assistantMsg.content) {
      // Partial text already arrived — keep it and note what happened.
      assistantMsg.meta = explainError(err);
    } else {
      assistantMsg.error = true;
      assistantMsg.content = explainError(err);
      assistantMsg.meta = '';
    }
  } finally {
    setSending(false);
    state.controller = null;
    renderMessages();
    persistConversation();
  }
}

function describeReply(model, reply) {
  const parts = [];
  parts.push(reply.modelReported || model.name);
  if (reply.latencyMs != null) parts.push(`${(reply.latencyMs / 1000).toFixed(1)}s`);
  if (reply.usage) {
    parts.push(`${reply.usage.promptTokens ?? '?'} in / ${reply.usage.completionTokens ?? '?'} out tokens`);
  } else {
    parts.push('token count not reported');
  }
  if (isFreeModel(model)) {
    parts.push('free');
  } else {
    const cost = reply.usage ? estimateCostUsd(model, reply.usage) : null;
    parts.push(cost == null ? 'cost unknown' : `about ${formatUsd(cost)}`);
  }
  return parts.join(' · ');
}

function setSending(sending) {
  state.sending = sending;
  $('#send-btn').hidden = sending;
  $('#stop-btn').hidden = !sending;
  $('#composer-input').disabled = false;
}

async function persistConversation() {
  if (!state.conversation.id) state.conversation.id = `conv-${Date.now()}`;
  const plain = {
    id: state.conversation.id,
    title: state.conversation.title,
    updatedAt: Date.now(),
    messages: state.conversation.messages.map(m => ({ role: m.role, content: m.content, meta: m.meta || '', error: !!m.error })),
  };
  try { await put(STORES.CONVERSATIONS, plain); } catch { /* storage unavailable */ }
}

function newConversation() {
  if (state.sending) return;
  state.conversation = { id: null, title: 'New conversation', messages: [] };
  renderMessages();
}

/* ========================================================================
 * Memory
 * ===================================================================== */
function renderMemoryScreen() {
  const list = $('#memory-list');
  if (!list) return;
  $('#memory-enabled').checked = state.memoryEnabled;
  if (state.memories.length === 0) {
    list.innerHTML = '<p class="empty">No memories saved. Anything you add here is sent with every message, until you remove it.</p>';
    return;
  }
  list.innerHTML = state.memories.map(m => `
    <div class="card" data-memory="${escapeAttr(m.id)}">
      <p style="color:var(--text)">${escapeHtml(m.text)}</p>
      <div class="row tight" style="margin-top:9px">
        <label class="toggle"><input type="checkbox" data-mem-toggle ${m.enabled !== false ? 'checked' : ''}><span>Use this one</span></label>
        <button type="button" class="btn secondary small" data-mem-edit>Edit</button>
        <button type="button" class="btn danger small" data-mem-delete>Delete</button>
      </div>
    </div>`).join('');
}

async function addMemory(text) {
  const clean = text.trim();
  if (!clean) return;
  const memory = { id: `mem-${Date.now()}`, text: clean, enabled: true, createdAt: Date.now() };
  state.memories.push(memory);
  try { await put(STORES.MEMORIES, memory); } catch { /* storage unavailable */ }
  renderMemoryScreen();
}

async function saveMemory(memory) {
  try { await put(STORES.MEMORIES, memory); } catch { /* storage unavailable */ }
}

/* ========================================================================
 * Settings
 * ===================================================================== */
function renderSettingsScreen() {
  const host = $('#provider-settings');
  if (!host) return;

  host.innerHTML = listProviders().map(p => {
    const cfg = state.providerConfig[p.id] || {};
    const on = cfg.enabled === undefined ? p.enabledByDefault === true : cfg.enabled === true;
    const keyField = p.auth?.required || p.id === 'custom' ? `
      <label class="field">
        <span>${escapeHtml(p.auth.keyLabel || 'API key')} — stored only on this phone. Currently: ${escapeHtml(maskKey(cfg.apiKey))}</span>
        <input type="password" data-provider-key="${escapeAttr(p.id)}" placeholder="paste key here" autocomplete="off" value="">
      </label>
      <p>${escapeHtml(p.auth.howToGet || '')}</p>` : '<p>No key needed.</p>';
    const urlField = p.id === 'custom' ? `
      <label class="field">
        <span>Endpoint address (must end in /chat/completions)</span>
        <input type="text" data-provider-url="custom" value="${escapeAttr(cfg.baseUrl || '')}" placeholder="https://example.com/v1/chat/completions">
      </label>` : '';
    return `
      <div class="card">
        <h3>${escapeHtml(p.name)}</h3>
        <label class="toggle"><input type="checkbox" data-provider-enable="${escapeAttr(p.id)}" ${on ? 'checked' : ''}><span>Use this provider</span></label>
        <p style="margin-top:8px"><strong>Restrictions:</strong> ${escapeHtml(p.restrictions)}</p>
        <p><strong>Cost:</strong> ${escapeHtml(p.costNote)}</p>
        ${urlField}${keyField}
      </div>`;
  }).join('');

  $('#protect-balance').checked = state.budget.protectBalance;
  $('#allow-paid').checked = state.budget.allowPaid;
  $('#budget-usd').value = state.budget.budgetUsd;
  $('#system-prompt').value = state.systemPrompt;
  renderBudgetSummary();
}

async function renderBudgetSummary() {
  const el = $('#budget-summary');
  if (!el) return;
  let entries = [];
  try { entries = (await getAll(STORES.LEDGER)) || []; } catch { /* storage unavailable */ }

  const paidSpend = entries.reduce((sum, e) => sum + (e.actualUsd || 0), 0);
  const remaining = Math.max(0, Number(state.budget.budgetUsd || 0) - paidSpend);
  const freeCount = entries.filter(e => e.free).length;
  const paidCount = entries.length - freeCount;

  const banner = state.budget.protectBalance
    ? `<div class="banner good">"Protect my balance" is ON. ALLAI will refuse any request that could cost money.</div>`
    : state.budget.allowPaid
      ? `<div class="banner warn">Paid requests are allowed, up to ${formatUsd(state.budget.budgetUsd)}. ${formatUsd(remaining)} left. You will still be asked before each one.</div>`
      : `<div class="banner good">Paid requests are switched off.</div>`;

  const recent = entries.slice(-12).reverse();
  const table = recent.length === 0
    ? '<p class="empty">Nothing has been sent yet.</p>'
    : `<div class="scroll-x"><table class="ledger">
        <tr><th>When</th><th>Model</th><th>Kind</th><th>Tokens</th><th>Cost</th><th>Result</th></tr>
        ${recent.map(e => `<tr>
          <td>${new Date(e.ts).toLocaleTimeString()}</td>
          <td class="mono">${escapeHtml(String(e.modelId || '?'))}</td>
          <td>${e.free ? '<span class="tag free">free</span>' : '<span class="tag paid">paid</span>'}</td>
          <td>${e.promptTokens ?? '?'}/${e.completionTokens ?? '?'}</td>
          <td>${e.free ? '$0.00' : (e.actualUsd == null ? 'unknown' : formatUsd(e.actualUsd))}</td>
          <td>${escapeHtml(e.outcome || '')}</td>
        </tr>`).join('')}
      </table></div>`;

  el.innerHTML = `${banner}
    <p>${entries.length} requests so far — ${freeCount} free, ${paidCount} paid.
    Money actually spent, as far as the providers reported it: <strong>${formatUsd(paidSpend)}</strong>.</p>
    ${table}`;
}

async function saveBudget() {
  state.budget = {
    ...state.budget,
    protectBalance: $('#protect-balance').checked,
    allowPaid: $('#allow-paid').checked,
    budgetUsd: Math.max(0, Number($('#budget-usd').value) || 0),
  };
  await setSetting('budget', state.budget);
  renderBudgetSummary();
}

/* ========================================================================
 * Events
 * ===================================================================== */
function attachEvents() {
  $('#send-btn').addEventListener('click', handleSend);
  $('#stop-btn').addEventListener('click', () => state.controller?.abort());
  $('#new-chat-btn').addEventListener('click', newConversation);

  const input = $('#composer-input');
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  });
  input.addEventListener('keydown', (e) => {
    // Enter sends on a keyboard; on a phone the on-screen Enter key inserts a
    // newline as people expect, so the Send button is the only way there.
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSend(); }
  });

  $('#model-select').addEventListener('change', async (e) => {
    state.selectedModelKey = e.target.value;
    renderModelFacts();
    await setSetting('selectedModelKey', state.selectedModelKey);
  });

  $('#memory-add-btn').addEventListener('click', async () => {
    const field = $('#memory-input');
    await addMemory(field.value);
    field.value = '';
  });

  $('#memory-enabled').addEventListener('change', async (e) => {
    state.memoryEnabled = e.target.checked;
    await setSetting('memoryEnabled', state.memoryEnabled);
  });

  $('#memory-list').addEventListener('click', async (e) => {
    const card = e.target.closest('[data-memory]');
    if (!card) return;
    const memory = state.memories.find(m => m.id === card.dataset.memory);
    if (!memory) return;

    if (e.target.matches('[data-mem-delete]')) {
      if (!window.confirm('Delete this memory?')) return;
      state.memories = state.memories.filter(m => m.id !== memory.id);
      try { await remove(STORES.MEMORIES, memory.id); } catch { /* storage unavailable */ }
      renderMemoryScreen();
    } else if (e.target.matches('[data-mem-edit]')) {
      const next = window.prompt('Edit this memory:', memory.text);
      if (next == null) return;
      memory.text = next.trim();
      await saveMemory(memory);
      renderMemoryScreen();
    } else if (e.target.matches('[data-mem-toggle]')) {
      memory.enabled = e.target.checked;
      await saveMemory(memory);
    }
  });

  $('#provider-settings').addEventListener('change', async (e) => {
    const t = e.target;
    if (t.dataset.providerEnable) {
      setProviderConfig(t.dataset.providerEnable, { enabled: t.checked });
      refreshModels();
      renderModelPicker();
      renderModelsScreen();
      refreshRemoteCatalogs();
    } else if (t.dataset.providerKey) {
      const key = t.value.trim();
      if (key) {
        setProviderConfig(t.dataset.providerKey, { apiKey: key });
        t.value = '';
        renderSettingsScreen();
        refreshRemoteCatalogs();
      }
    } else if (t.dataset.providerUrl) {
      setProviderConfig(t.dataset.providerUrl, { baseUrl: t.value.trim() });
    }
    await setSetting('providerConfig', state.providerConfig);
  });

  ['#protect-balance', '#allow-paid', '#budget-usd'].forEach(sel => {
    $(sel).addEventListener('change', saveBudget);
  });

  $('#system-prompt').addEventListener('change', async (e) => {
    state.systemPrompt = e.target.value;
    await setSetting('systemPrompt', state.systemPrompt);
  });

  $('#delete-all-btn').addEventListener('click', async () => {
    if (!window.confirm('Delete every conversation, memory, character, API key and setting on this phone? This cannot be undone.')) return;
    await deleteEverything();
    window.location.reload();
  });

  $('#clear-ledger-btn').addEventListener('click', async () => {
    if (!window.confirm('Clear the usage history? This does not refund or change anything at your providers.')) return;
    await clearStore(STORES.LEDGER);
    renderBudgetSummary();
  });
}

function setProviderConfig(id, patch) {
  state.providerConfig[id] = { ...(state.providerConfig[id] || {}), ...patch };
}

/* ========================================================================
 * Escaping — everything that reaches the page goes through one of these.
 * ===================================================================== */
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
const escapeAttr = escapeHtml;

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}

export { state, boot, escapeHtml };
