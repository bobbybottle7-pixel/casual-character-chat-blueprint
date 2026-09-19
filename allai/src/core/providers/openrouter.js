/* ===========================================================================
 * ALLAI — OpenRouter provider
 *
 * OpenRouter is a front door to hundreds of models from many companies. It
 * needs an API key, so it stays OFF until Cam chooses to add one.
 *
 * Deliberate decision: the model catalog here is EMPTY. OpenRouter publishes
 * every model's real price, real context length and real capabilities at
 * https://openrouter.ai/api/v1/models, readable without a key. ALLAI fetches
 * that instead of shipping a hardcoded list, because a hardcoded list is a
 * list of numbers that quietly go stale and become lies about what something
 * costs. If the fetch fails, ALLAI shows no models rather than guesses.
 * ======================================================================== */

import { registerProvider } from './registry.js';
import { sendOpenAICompatible } from './openai-compat.js';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const MODELS_URL = 'https://openrouter.ai/api/v1/models';

let cached = null;

/** OpenRouter prices in dollars per token; people think in dollars per million. */
function perMillion(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n * 1_000_000 : null;
}

export const openrouter = registerProvider({
  id: 'openrouter',
  name: 'OpenRouter',
  docsUrl: 'https://openrouter.ai/docs',
  hosting: 'remote',
  enabledByDefault: false,
  auth: {
    required: true,
    scheme: 'bearer',
    keyLabel: 'OpenRouter API key',
    howToGet: 'Make a free account at openrouter.ai, then Keys -> Create Key. Models whose name ends in ":free" cost $0.',
  },
  restrictions:
    'Varies per model, because OpenRouter is a middleman for many different companies. ' +
    'Each model in the list below reports whether the company serving it applies its own ' +
    'moderation layer — ALLAI shows that flag as OpenRouter publishes it. The underlying ' +
    'model still has whatever training its makers gave it.',
  costNote:
    'Mixed. Some models are free; most are paid. ALLAI reads the real price per model from ' +
    'OpenRouter and will not send a paid request without your say-so.',

  listModels() {
    return cached ? cached.map(m => ({ ...m })) : [];
  },

  async fetchModels() {
    const res = await fetch(MODELS_URL);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data?.data)) return null;

    cached = data.data.map(m => {
      const inPerMTok = perMillion(m.pricing?.prompt);
      const outPerMTok = perMillion(m.pricing?.completion);
      const free = inPerMTok === 0 && outPerMTok === 0;
      const moderated = m.top_provider?.is_moderated;
      return {
        id: m.id,
        providerId: 'openrouter',
        name: m.name || m.id,
        free,
        pricing: (inPerMTok == null || outPerMTok == null) ? null : { inPerMTok, outPerMTok },
        contextTokens: m.context_length ?? m.top_provider?.context_length ?? null,
        vision: Array.isArray(m.architecture?.input_modalities)
          ? m.architecture.input_modalities.includes('image')
          : false,
        tools: Array.isArray(m.supported_parameters) ? m.supported_parameters.includes('tools') : false,
        hosting: 'remote',
        moderated: typeof moderated === 'boolean' ? moderated : null,
        notes: typeof moderated === 'boolean'
          ? (moderated
              ? 'The company serving this model applies its own moderation layer.'
              : 'OpenRouter reports no extra moderation layer from the serving company.')
          : 'OpenRouter does not report a moderation flag for this model.',
      };
    });
    return cached.map(m => ({ ...m }));
  },

  send({ model, messages, signal, onDelta, params, config }) {
    return sendOpenAICompatible({
      endpoint: config?.baseUrl || ENDPOINT,
      apiKey: config?.apiKey || null,
      model, messages, signal, onDelta, params,
      providerId: 'openrouter',
    });
  },
});
