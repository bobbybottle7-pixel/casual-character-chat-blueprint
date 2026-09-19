/* ===========================================================================
 * ALLAI — OpenAI-compatible transport
 *
 * Most AI providers copied OpenAI's request format, so one piece of code can
 * talk to a lot of them: Pollinations, OpenRouter, Venice, and anything else
 * that offers a /chat/completions endpoint. Providers that do NOT follow it
 * (Anthropic's own API, for example) get their own adapter file instead of
 * being forced through this one.
 *
 * This file does transport only. It does not decide whether a request is
 * allowed to cost money — budget.js does that, before we ever get here.
 * ======================================================================== */

import { ERROR_KIND, ProviderError, kindFromStatus } from './registry.js';

/** Pulls a human-readable reason out of whatever shape the error body is in. */
function describeErrorBody(body) {
  if (!body) return '';
  if (typeof body === 'string') return body.slice(0, 400);
  const err = body.error ?? body;
  if (typeof err === 'string') return err.slice(0, 400);
  return String(err?.message || err?.detail || JSON.stringify(err)).slice(0, 400);
}

/**
 * One chat request against an OpenAI-shaped endpoint.
 *
 * Streaming is used when onDelta is supplied AND the caller has not opted out,
 * because streaming is what makes Stop work and what makes the app feel alive
 * on a slow phone connection. If the endpoint refuses to stream we fall back
 * to reading the whole body — we never silently drop the request.
 */
export async function sendOpenAICompatible({
  endpoint,
  apiKey = null,
  model,
  messages,
  signal,
  onDelta = null,
  params = {},
  extraHeaders = {},
  providerId = null,
  stream = true,
}) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const wantsStream = Boolean(onDelta) && stream;
  const body = {
    model: model.id,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    stream: wantsStream,
  };
  if (params.temperature != null) body.temperature = Number(params.temperature);
  if (params.maxTokens != null) body.max_tokens = Number(params.maxTokens);

  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new ProviderError(ERROR_KIND.ABORTED, 'Stopped.', { providerId });
    }
    // In a browser this is also what a blocked CORS request looks like, which
    // is why the message names both possibilities instead of guessing.
    throw new ProviderError(
      ERROR_KIND.NETWORK,
      `Could not reach ${endpoint}. The phone may be offline, or this endpoint may not allow browser requests.`,
      { providerId, retryable: true },
    );
  }

  if (!response.ok) {
    let parsed = null;
    try { parsed = await response.json(); } catch { try { parsed = await response.text(); } catch { /* body unreadable */ } }
    const detail = describeErrorBody(parsed);
    throw new ProviderError(
      kindFromStatus(response.status),
      detail ? `${response.status}: ${detail}` : `${response.status} from ${providerId || endpoint}`,
      { providerId, status: response.status, retryable: response.status === 429 || response.status >= 500 },
    );
  }

  if (wantsStream && response.body) {
    return await readStream(response, { onDelta, startedAt, providerId });
  }
  return await readWhole(response, { onDelta, startedAt, providerId });
}

async function readWhole(response, { onDelta, startedAt, providerId }) {
  let data;
  try {
    data = await response.json();
  } catch {
    throw new ProviderError(ERROR_KIND.UNKNOWN, 'The provider sent a reply ALLAI could not read.', { providerId });
  }
  const choice = data?.choices?.[0];
  const text = choice?.message?.content ?? '';
  if (onDelta && text) onDelta(text);
  return {
    text,
    usage: normalizeUsage(data?.usage),
    latencyMs: Date.now() - startedAt,
    modelReported: data?.model ?? null,
    finishReason: choice?.finish_reason ?? null,
  };
}

/**
 * Reads server-sent events. The wire format is a series of `data: {...}` lines
 * ending in `data: [DONE]`. Chunks can be split across network reads, so we
 * keep a buffer and only consume whole lines.
 */
async function readStream(response, { onDelta, startedAt, providerId }) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let usage = null;
  let modelReported = null;
  let finishReason = null;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineAt;
      while ((newlineAt = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineAt).trim();
        buffer = buffer.slice(newlineAt + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') { buffer = ''; break; }
        let parsed;
        try { parsed = JSON.parse(payload); } catch { continue; }

        if (parsed.model) modelReported = parsed.model;
        if (parsed.usage) usage = normalizeUsage(parsed.usage);
        const choice = parsed.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        const piece = choice?.delta?.content;
        if (piece) { text += piece; if (onDelta) onDelta(piece); }
      }
    }
  } catch (err) {
    if (err?.name === 'AbortError') {
      // Partial text is still worth keeping — the user asked to stop, not to
      // throw away what already arrived.
      return { text, usage, latencyMs: Date.now() - startedAt, modelReported, finishReason: 'aborted', aborted: true };
    }
    throw new ProviderError(ERROR_KIND.NETWORK, 'The connection dropped while the reply was arriving.', { providerId, retryable: true });
  }

  return { text, usage, latencyMs: Date.now() - startedAt, modelReported, finishReason };
}

function normalizeUsage(usage) {
  if (!usage) return null;
  const promptTokens = usage.prompt_tokens ?? usage.promptTokens ?? null;
  const completionTokens = usage.completion_tokens ?? usage.completionTokens ?? null;
  if (promptTokens == null && completionTokens == null) return null;
  return { promptTokens, completionTokens };
}
