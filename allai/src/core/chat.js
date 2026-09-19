/* ===========================================================================
 * ALLAI — request orchestration
 *
 * One way in for every AI request the app makes, now and later. Chat uses it;
 * Council, Model Lab and any future agent will use the same function. That is
 * what keeps the cost guard impossible to bypass — there is no second path.
 *
 * Order of events, every time:
 *   1. ask the budget guard
 *   2. stop here if the answer is no
 *   3. send the request
 *   4. write what actually happened to the ledger
 * ======================================================================== */

import { ERROR_KIND, ProviderError, getProvider, isProviderReady } from './providers/registry.js';
import { authorize, makeLedgerEntry, isFreeModel } from './budget.js';
import { put, STORES } from './storage.js';

/**
 * Sends one request to one model.
 *
 * @returns {Promise<{text, usage, latencyMs, modelReported, ledgerEntry, gate}>}
 * @throws  {ProviderError} including kind BLOCKED_BY_BUDGET when the guard says no
 */
export async function sendChat({
  model,
  messages,
  providerConfig = {},
  budgetSettings,
  approved = false,
  signal = null,
  onDelta = null,
  params = {},
  recordToLedger = true,
}) {
  if (!model) throw new ProviderError(ERROR_KIND.MODEL, 'No model was chosen.');
  const provider = getProvider(model.providerId);
  if (!provider) {
    throw new ProviderError(ERROR_KIND.MODEL, `ALLAI does not know a provider called "${model.providerId}".`);
  }

  const config = providerConfig[provider.id] || {};
  if (!isProviderReady(provider, providerConfig)) {
    throw new ProviderError(
      ERROR_KIND.AUTH,
      `${provider.name} needs an API key before it can be used. Add one in Settings.`,
      { providerId: provider.id },
    );
  }

  const gate = authorize({ model, messages, settings: budgetSettings, approved });
  if (!gate.allowed) {
    throw new ProviderError(ERROR_KIND.BLOCKED_BY_BUDGET, gate.message, { providerId: provider.id });
  }

  let reply;
  try {
    reply = await provider.send({ model, messages, signal, onDelta, params, config });
  } catch (err) {
    if (recordToLedger) {
      const outcome = err instanceof ProviderError ? err.kind : 'error';
      await safeRecord(makeLedgerEntry({ model, usage: null, latencyMs: null, estimatedUsd: gate.estimatedUsd, outcome }));
    }
    throw err;
  }

  const ledgerEntry = makeLedgerEntry({
    model,
    usage: reply.usage,
    latencyMs: reply.latencyMs,
    estimatedUsd: gate.estimatedUsd,
    outcome: reply.aborted ? 'aborted' : 'ok',
  });
  if (recordToLedger) await safeRecord(ledgerEntry);

  return { ...reply, ledgerEntry, gate };
}

/** A ledger write must never take down a reply that already arrived. */
async function safeRecord(entry) {
  try { await put(STORES.LEDGER, entry); } catch { /* storage unavailable; the reply still stands */ }
}

/**
 * Tries each model in turn until one answers.
 *
 * The honesty rule from the spec lives here: a model is only in the chain if
 * its provider is actually configured and ready. ALLAI never claims a fallback
 * it does not have, and it never quietly moves a request from a free model to
 * a paid one — `freeOnly` defaults to true so that cannot happen by accident.
 *
 * @returns {Promise<{reply, model, attempts}>}
 */
export async function sendWithFallback({
  models,
  providerConfig = {},
  budgetSettings,
  freeOnly = true,
  onAttempt = null,
  ...rest
}) {
  const chain = models.filter(m => {
    const provider = getProvider(m.providerId);
    if (!isProviderReady(provider, providerConfig)) return false;
    if (freeOnly && !isFreeModel(m)) return false;
    return true;
  });

  if (chain.length === 0) {
    throw new ProviderError(
      ERROR_KIND.UNAVAILABLE,
      'No usable model is configured. ALLAI will not invent a fallback it does not have — ' +
      'add a provider in Settings, or pick a model that is ready.',
    );
  }

  const attempts = [];
  for (let i = 0; i < chain.length; i += 1) {
    const model = chain[i];
    if (onAttempt) onAttempt({ model, index: i, total: chain.length });
    try {
      const reply = await sendChat({ model, providerConfig, budgetSettings, ...rest });
      return { reply, model, attempts };
    } catch (err) {
      attempts.push({ model, error: err });
      // The user pressing Stop, or the guard refusing to spend, are decisions.
      // Working around a decision by trying the next model would be wrong.
      if (err.kind === ERROR_KIND.ABORTED || err.kind === ERROR_KIND.BLOCKED_BY_BUDGET) throw err;
      if (i === chain.length - 1) throw err;
    }
  }
  throw new ProviderError(ERROR_KIND.UNAVAILABLE, 'Every configured model failed.');
}

/**
 * Builds the message list sent to the model: system prompt, then permanent
 * memories, then the conversation so far.
 *
 * Memory is opt-in and visible. Nothing gets added here that the user has not
 * seen on the Memory screen.
 */
export function buildMessages({ systemPrompt = '', memories = [], history = [], memoryEnabled = true }) {
  const messages = [];
  const systemParts = [];
  if (systemPrompt.trim()) systemParts.push(systemPrompt.trim());

  if (memoryEnabled && memories.length > 0) {
    const lines = memories.filter(m => m.enabled !== false).map(m => `- ${m.text}`);
    if (lines.length > 0) {
      systemParts.push(`Things the user has asked you to remember:\n${lines.join('\n')}`);
    }
  }
  if (systemParts.length > 0) messages.push({ role: 'system', content: systemParts.join('\n\n') });
  for (const m of history) {
    if (m.role === 'user' || m.role === 'assistant') messages.push({ role: m.role, content: m.content });
  }
  return messages;
}

/** Plain-English wording for each failure, so the UI never says "error". */
export function explainError(err) {
  if (!(err instanceof ProviderError)) {
    return err?.message || 'Something went wrong and ALLAI does not know what.';
  }
  switch (err.kind) {
    case ERROR_KIND.AUTH: return `That provider would not accept the key. ${err.message}`;
    case ERROR_KIND.RATE_LIMIT: return 'Too many requests too quickly, or the free allowance is used up for now. Wait a moment and try again.';
    case ERROR_KIND.QUOTA: return 'That account is out of credit. Nothing was charged to you by ALLAI.';
    case ERROR_KIND.UNAVAILABLE: return `The provider is having trouble right now. ${err.message}`;
    case ERROR_KIND.MODEL: return `That model did not work. ${err.message}`;
    case ERROR_KIND.NETWORK: return err.message;
    case ERROR_KIND.ABORTED: return 'Stopped.';
    case ERROR_KIND.BLOCKED_BY_BUDGET: return err.message;
    default: return err.message;
  }
}
