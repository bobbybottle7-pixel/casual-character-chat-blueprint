/**
 * A test client that talks to a running Cam Claude the way the browser does.
 *
 * The point of this file is `send()`. Driving the app with `curl` plus a
 * `sleep` guess is unreliable: a reply that takes longer than the guess reads
 * as a failure, and a reply that arrives early wastes the difference. This
 * client subscribes to the conversation's event stream and resolves when the
 * turn actually ends, so tests are both faster and trustworthy.
 */

import type { CamEvent } from '../../server/agent/events.js';

export interface TurnResult {
  text: string;
  events: CamEvent[];
  toolCalls: Array<{ name: string; input: unknown }>;
  gmEvents: unknown[];
  aborted: boolean;
  error?: string;
}

export interface CamClientOptions {
  baseUrl?: string;
  /** What to do when a mode asks permission for a tool call. Default: allow. */
  onPermission?: (toolName: string, input: unknown) => boolean;
  /** How long a single turn may take before the test gives up. */
  turnTimeoutMs?: number;
}

export class CamClient {
  readonly baseUrl: string;
  #onPermission: (toolName: string, input: unknown) => boolean;
  #turnTimeoutMs: number;

  constructor(options: CamClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? 'http://127.0.0.1:8787';
    this.#onPermission = options.onPermission ?? (() => true);
    this.#turnTimeoutMs = options.turnTimeoutMs ?? 180_000;
  }

  async api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    if (!res.ok) {
      let detail = `${res.status} ${res.statusText}`;
      try {
        const payload = (await res.json()) as { error?: string };
        if (payload?.error) detail = payload.error;
      } catch {
        // Keep the status line when the body is not JSON.
      }
      throw new Error(`${method} ${path} failed: ${detail}`);
    }
    return res.status === 204 ? (null as T) : ((await res.json()) as T);
  }

  /** True once the server answers, so tests can wait for a boot rather than sleep. */
  async waitUntilReady(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        await this.api('GET', '/api/health');
        return;
      } catch {
        if (Date.now() > deadline) throw new Error(`Server at ${this.baseUrl} never became ready.`);
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  }

  async newConversation(modeId: string, extra: Record<string, unknown> = {}): Promise<string> {
    const conv = await this.api<{ id: string }>('POST', '/api/conversations', { modeId, ...extra });
    return conv.id;
  }

  /**
   * Sends one message and resolves when that turn finishes.
   *
   * Permission requests are answered as they arrive, otherwise a Code-mode turn
   * would block forever waiting for a click that a test will never make.
   */
  async send(
    conversationId: string,
    text: string,
    opts: { replyKind?: 'dialog' | 'narrator' } = {},
  ): Promise<TurnResult> {
    const controller = new AbortController();
    const result: TurnResult = { text: '', events: [], toolCalls: [], gmEvents: [], aborted: false };

    const stream = await fetch(`${this.baseUrl}/api/conversations/${conversationId}/stream`, {
      signal: controller.signal,
      headers: { accept: 'text/event-stream' },
    });
    if (!stream.body) throw new Error('Event stream had no body.');

    const finished = this.#consume(stream.body, conversationId, result, controller);

    await this.api('POST', `/api/conversations/${conversationId}/messages`, {
      text,
      ...(opts.replyKind ? { replyKind: opts.replyKind } : {}),
    });

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Turn did not finish within ${this.#turnTimeoutMs / 1000}s.`)),
        this.#turnTimeoutMs,
      ),
    );

    try {
      await Promise.race([finished, timeout]);
    } finally {
      controller.abort();
    }
    return result;
  }

  async #consume(
    body: ReadableStream<Uint8Array>,
    conversationId: string,
    result: TurnResult,
    controller: AbortController,
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line.
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';

      for (const frame of frames) {
        const line = frame.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;

        let event: CamEvent;
        try {
          event = JSON.parse(line.slice(6)) as CamEvent;
        } catch {
          continue;
        }
        result.events.push(event);

        switch (event.type) {
          case 'text_delta':
            result.text += event.text;
            break;
          case 'tool_use':
            result.toolCalls.push({ name: event.name, input: event.input });
            break;
          case 'gm_event':
            result.gmEvents.push(event.event);
            break;
          case 'permission_request':
            void this.api(
              'POST',
              `/api/conversations/${conversationId}/permissions/${event.id}`,
              { allow: this.#onPermission(event.toolName, event.input) },
            ).catch(() => undefined);
            break;
          case 'error':
            result.error = event.message;
            break;
          case 'turn_end':
            result.aborted = Boolean(event.aborted);
            controller.abort();
            return;
          default:
            break;
        }
      }
    }
  }
}
