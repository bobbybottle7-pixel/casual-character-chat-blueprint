/* ===========================================================================
 * ALLAI — Venice provider
 *
 * Venice is OpenAI-shaped and needs a key, so it stays OFF until Cam adds one.
 * As with OpenRouter, the catalog is fetched rather than hardcoded: Venice
 * publishes pricing, context length and per-model capabilities at
 * https://api.venice.ai/api/v1/models, readable without a key.
 *
 * Unit note: the numbers under model_spec.pricing.*.usd are the figures Venice
 * publishes per million tokens. ALLAI passes them through and labels them as
 * Venice's own published prices rather than converting or estimating.
 * ======================================================================== */

import { registerProvider } from './registry.js';
import { sendOpenAICompatible } from './openai-compat.js';

const ENDPOINT = 'https://api.venice.ai/api/v1/chat/completions';
const MODELS_URL = 'https://api.venice.ai/api/v1/models';

let cached = null;

export const venice = registerProvider({
  id: 'venice',
  name: 'Venice',
  docsUrl: 'https://docs.venice.ai',
  hosting: 'remote',
  enabledByDefault: false,
  auth: {
    required: true,
    scheme: 'bearer',
    keyLabel: 'Venice API key',
    howToGet: 'Create an account at venice.ai, then generate an API key in your account settings.',
  },
  restrictions:
    'Venice markets itself on privacy and on not retaining conversations, and it offers models ' +
    'with fewer refusals than most hosted services. That is their claim about their own service, ' +
    'not something ALLAI can verify, and every model still has whatever training its makers gave ' +
    'it. Check their current terms before relying on any of it.',
  costNote: 'Paid. Venice publishes a price for each model; ALLAI reads it and will not spend without your say-so.',

  listModels() {
    return cached ? cached.map(m => ({ ...m })) : [];
  },

  async fetchModels() {
    const res = await fetch(MODELS_URL);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data?.data)) return null;

    cached = data.data.map(m => {
      const spec = m.model_spec || {};
      const caps = spec.capabilities || {};
      const inUsd = spec.pricing?.input?.usd;
      const outUsd = spec.pricing?.output?.usd;
      return {
        id: m.id,
        providerId: 'venice',
        name: m.id,
        free: inUsd === 0 && outUsd === 0,
        pricing: (typeof inUsd === 'number' && typeof outUsd === 'number')
          ? { inPerMTok: inUsd, outPerMTok: outUsd }
          : null,
        contextTokens: spec.availableContextTokens ?? m.context_length ?? null,
        vision: Boolean(caps.supportsVision),
        tools: Boolean(caps.supportsFunctionCalling),
        hosting: 'remote',
        moderated: null,
        notes: spec.description ? String(spec.description).slice(0, 200) : '',
      };
    });
    return cached.map(m => ({ ...m }));
  },

  send({ model, messages, signal, onDelta, params, config }) {
    return sendOpenAICompatible({
      endpoint: config?.baseUrl || ENDPOINT,
      apiKey: config?.apiKey || null,
      model, messages, signal, onDelta, params,
      providerId: 'venice',
    });
  },
});
