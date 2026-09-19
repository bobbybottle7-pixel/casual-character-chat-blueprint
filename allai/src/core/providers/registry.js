/* ===========================================================================
 * ALLAI — provider registry
 *
 * A "provider" is one company or service that will answer a chat request.
 * A "model" is one specific AI that a provider hosts.
 *
 * Everything ALLAI knows about talking to the outside world goes through the
 * shapes described here. Adding a new provider later means writing one object
 * and calling registerProvider() — no other file has to change. That is the
 * whole point of this file.
 *
 * ---------------------------------------------------------------------------
 * Provider shape
 * ---------------------------------------------------------------------------
 *   id            stable short string, e.g. "pollinations"
 *   name          what a human sees, e.g. "Pollinations"
 *   docsUrl       where the facts below came from, so they can be re-checked
 *   auth          { required, scheme, keyLabel, howToGet }
 *                 scheme is "none" or "bearer". required:false means ALLAI can
 *                 call it with no key at all.
 *   restrictions  Plain-English summary of what the PROVIDER documents that it
 *                 restricts. Never write "uncensored" here. Write what is
 *                 actually documented, or say that it is not documented.
 *   hosting       "remote" or "local"
 *   listModels()  -> Model[]  (from the static catalog; may be refreshed live)
 *   fetchModels(cfg) -> Promise<Model[]> | null
 *                 Optional. Live model list when the provider offers one.
 *   send(req)     -> Promise<Reply>   The actual request. See below.
 *
 * ---------------------------------------------------------------------------
 * Model shape
 * ---------------------------------------------------------------------------
 *   id            provider-specific model id sent over the wire
 *   providerId    which provider hosts it
 *   name          human label
 *   free          true only when the provider documents it as costing $0
 *   pricing       { inPerMTok, outPerMTok } in US dollars, or null if unknown.
 *                 null means UNKNOWN. It does not mean free.
 *   contextTokens number, or null when the provider does not publish it
 *   vision        true when the provider documents image input
 *   tools         true when the provider documents tool/function calling
 *   hosting       "remote" or "local"
 *   notes         anything a person should know before picking it
 *
 * ---------------------------------------------------------------------------
 * send(req) request shape
 * ---------------------------------------------------------------------------
 *   { model, messages, signal, onDelta, config, params }
 *     model    a Model object
 *     messages [{ role: "system"|"user"|"assistant", content: string }]
 *     signal   an AbortSignal so the user can press Stop
 *     onDelta  fn(textChunk) called as text streams in; may be omitted
 *     config   { apiKey?, baseUrl? } for this provider, from settings
 *     params   { temperature?, maxTokens? }
 *
 * send() resolves to a Reply:
 *   { text, usage: {promptTokens, completionTokens}|null, latencyMs, modelReported }
 *
 * send() rejects with a ProviderError (below) so the UI can say something
 * useful instead of "something went wrong".
 * ======================================================================== */

export const ERROR_KIND = Object.freeze({
  AUTH: 'auth',              // key missing, wrong, or rejected
  RATE_LIMIT: 'rate_limit',  // too many requests, or free quota spent
  QUOTA: 'quota',            // account/credit exhausted
  UNAVAILABLE: 'unavailable',// provider down, 5xx, or unreachable
  MODEL: 'model',            // this model refused/failed/does not exist
  NETWORK: 'network',        // phone offline, DNS, CORS, connection dropped
  ABORTED: 'aborted',        // the user pressed Stop
  BLOCKED_BY_BUDGET: 'blocked_by_budget', // ALLAI refused to spend money
  UNKNOWN: 'unknown',
});

export class ProviderError extends Error {
  constructor(kind, message, { providerId = null, status = null, retryable = false } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.providerId = providerId;
    this.status = status;
    this.retryable = retryable;
  }
}

/** Turns an HTTP status into the closest error kind. */
export function kindFromStatus(status) {
  if (status === 401 || status === 403) return ERROR_KIND.AUTH;
  if (status === 402) return ERROR_KIND.QUOTA;
  if (status === 429) return ERROR_KIND.RATE_LIMIT;
  if (status === 404) return ERROR_KIND.MODEL;
  if (status >= 500) return ERROR_KIND.UNAVAILABLE;
  return ERROR_KIND.UNKNOWN;
}

const providers = new Map();

export function registerProvider(provider) {
  if (!provider || !provider.id) throw new Error('registerProvider: provider needs an id');
  if (typeof provider.send !== 'function') throw new Error(`provider ${provider.id} has no send()`);
  providers.set(provider.id, provider);
  return provider;
}

export function getProvider(id) {
  return providers.get(id) || null;
}

export function listProviders() {
  return [...providers.values()];
}

/**
 * Every model ALLAI currently knows about, across every registered provider.
 * `enabledIds` limits it to providers the user has actually turned on, so the
 * model list never advertises something that cannot be called.
 */
export function listModels({ enabledProviderIds = null } = {}) {
  const out = [];
  for (const p of providers.values()) {
    if (enabledProviderIds && !enabledProviderIds.includes(p.id)) continue;
    for (const m of p.listModels()) out.push(m);
  }
  return out;
}

export function findModel(providerId, modelId) {
  const p = providers.get(providerId);
  if (!p) return null;
  return p.listModels().find(m => m.id === modelId) || null;
}

/**
 * True when this provider can be called right now.
 * A provider that needs a key and has no key is NOT ready, and ALLAI must not
 * pretend otherwise — that is how fake fallbacks happen.
 */
export function isProviderReady(provider, config = {}) {
  if (!provider) return false;
  if (!provider.auth?.required) return true;
  return Boolean(config[provider.id]?.apiKey);
}
