/* ===========================================================================
 * ALLAI — Custom OpenAI-compatible endpoint
 *
 * The escape hatch. Any service that speaks OpenAI's /chat/completions format
 * can be used here by pasting its address and, if it needs one, a key. That
 * includes a local model server running on the phone or on the same wifi
 * later on — nothing here assumes the endpoint is on the internet.
 *
 * Models are whatever Cam types in, because ALLAI genuinely does not know
 * what lives behind an address it has never seen. Rather than guess at a
 * context window or a price, unknown fields stay null and the UI shows
 * "not published".
 * ======================================================================== */

import { registerProvider } from './registry.js';
import { sendOpenAICompatible } from './openai-compat.js';

/** Filled from settings: [{ id, name, contextTokens, vision, tools, free, local }] */
let userModels = [];

export function setCustomModels(models) {
  userModels = (Array.isArray(models) ? models : []).map(m => ({
    id: String(m.id || '').trim(),
    providerId: 'custom',
    name: m.name || m.id,
    // A custom endpoint is only marked free when Cam says so. ALLAI cannot
    // know, and assuming free is how a surprise bill happens.
    free: m.free === true,
    pricing: m.free === true ? { inPerMTok: 0, outPerMTok: 0 } : null,
    contextTokens: Number.isFinite(Number(m.contextTokens)) ? Number(m.contextTokens) : null,
    vision: m.vision === true,
    tools: m.tools === true,
    hosting: m.local === true ? 'local' : 'remote',
    moderated: null,
    notes: m.notes || 'A custom endpoint you configured. ALLAI reports only what you told it.',
  })).filter(m => m.id);
}

export const custom = registerProvider({
  id: 'custom',
  name: 'Custom endpoint',
  docsUrl: null,
  hosting: 'remote',
  enabledByDefault: false,
  auth: {
    required: false,
    scheme: 'bearer',
    keyLabel: 'API key (leave blank if the endpoint does not need one)',
    howToGet: 'Whatever the service you are connecting to tells you.',
  },
  restrictions:
    'Unknown to ALLAI. This is an address you supplied, so its rules are whatever the service ' +
    'behind it says they are.',
  costNote:
    'Unknown to ALLAI. A model here counts as paid unless you tick the free box yourself, ' +
    'so the budget guard errs on the side of not spending your money.',

  listModels() {
    return userModels.map(m => ({ ...m }));
  },

  send({ model, messages, signal, onDelta, params, config }) {
    if (!config?.baseUrl) {
      return Promise.reject(new Error('No address set for the custom endpoint. Add one in Settings.'));
    }
    return sendOpenAICompatible({
      endpoint: config.baseUrl,
      apiKey: config.apiKey || null,
      model, messages, signal, onDelta, params,
      providerId: 'custom',
    });
  },
});
