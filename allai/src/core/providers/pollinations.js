/* ===========================================================================
 * ALLAI — Pollinations provider
 *
 * Why this one is first: it answers with no API key at all. That is what lets
 * ALLAI be genuinely usable on day one without anybody signing up for
 * anything or spending a cent.
 *
 * Everything below was checked against the live service on 2026-09-19:
 *   GET  https://text.pollinations.ai/models  -> anonymous tier lists exactly
 *        one model, "openai-fast" (GPT-OSS 20B), vision:false, tools:true
 *   POST https://text.pollinations.ai/openai  -> OpenAI-shaped, answered with
 *        no Authorization header, response reported "user_tier":"anonymous"
 *   The endpoint returns access-control-allow-origin: *, which is what lets a
 *   plain HTML file on a phone call it directly with no server in between.
 * ======================================================================== */

import { registerProvider } from './registry.js';
import { sendOpenAICompatible } from './openai-compat.js';

const ENDPOINT = 'https://text.pollinations.ai/openai';
const MODELS_URL = 'https://text.pollinations.ai/models';

const CATALOG = [
  {
    id: 'openai-fast',
    providerId: 'pollinations',
    name: 'GPT-OSS 20B (openai-fast)',
    free: true,
    pricing: { inPerMTok: 0, outPerMTok: 0 },
    // Pollinations does not publish a context limit for the anonymous tier,
    // so ALLAI says "not published" rather than inventing a number.
    contextTokens: null,
    vision: false,
    tools: true,
    hosting: 'remote',
    notes: 'Free, no account, no API key. The only model the anonymous tier offers.',
  },
];

export const pollinations = registerProvider({
  id: 'pollinations',
  name: 'Pollinations',
  docsUrl: 'https://pollinations.ai',
  hosting: 'remote',
  enabledByDefault: true,
  auth: {
    required: false,
    scheme: 'none',
    keyLabel: null,
    howToGet: 'Nothing to get. This provider answers without an account.',
  },
  restrictions:
    'Pollinations publishes an acceptable-use policy, and the model it serves (GPT-OSS 20B) ' +
    'carries its own safety training from the people who built it. ALLAI adds no moderation ' +
    'on top of that. Exactly what it will and will not discuss is not documented anywhere ' +
    'ALLAI can read, so treat it as unknown until you test it yourself.',
  costNote: 'Free. No billing exists on the anonymous tier, so this provider cannot spend money.',

  listModels() {
    return CATALOG.map(m => ({ ...m }));
  },

  /** Live list, so a model added or retired upstream shows up without a release. */
  async fetchModels() {
    const res = await fetch(MODELS_URL);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    return data.map(m => ({
      id: m.name,
      providerId: 'pollinations',
      name: m.description || m.name,
      free: m.tier === 'anonymous',
      pricing: m.tier === 'anonymous' ? { inPerMTok: 0, outPerMTok: 0 } : null,
      contextTokens: null,
      vision: Boolean(m.vision),
      tools: Boolean(m.tools),
      hosting: 'remote',
      notes: m.tier === 'anonymous'
        ? 'Free, no API key needed.'
        : `Requires a Pollinations key (tier: ${m.tier}).`,
    }));
  },

  send({ model, messages, signal, onDelta, params }) {
    return sendOpenAICompatible({
      endpoint: ENDPOINT,
      apiKey: null,
      model, messages, signal, onDelta, params,
      providerId: 'pollinations',
    });
  },
});
