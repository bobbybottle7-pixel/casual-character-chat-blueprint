import { query, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';
import type { Mode, ModeContext, ReplyKind } from '../modes/types.js';
import { modeToOptions } from './options.js';
import type { CamEvent, Subscriber } from './events.js';
import { addMessage, updateConversation } from '../store/repo.js';

/** The one stream-event shape the SDK hands us; narrowed from SDKMessage. */
type StreamEvent = Extract<SDKMessage, { type: 'stream_event' }>['event'];

interface PendingPermission {
  resolve: (allow: boolean) => void;
}

/**
 * One live Claude session per open conversation.
 *
 * The SDK is driven in streaming-input mode — the recommended mode, and the only
 * one that supports image attachments, queued messages, and interruption. That
 * means the `query()` call outlives any single turn: user messages are pushed
 * onto a queue that an async generator drains.
 */
export class SessionRunner {
  readonly conversationId: string;
  readonly mode: Mode;

  #ctx: ModeContext;
  #query?: Query;
  #queue: SDKUserMessage[] = [];
  #wake?: () => void;
  #closed = false;
  #subscribers = new Set<Subscriber>();
  #pending = new Map<string, PendingPermission>();

  #sessionId?: string;
  /**
   * Recap carried across a mode switch. The SDK snapshots a session's system
   * prompt on its first request, so switching modes needs a new session — this
   * is what keeps the new one from starting blind.
   */
  #handoff?: string;
  /** Text accumulated for the assistant turn currently streaming. */
  #turnText = '';
  #turnThinking = '';
  #turnTools: unknown[] = [];
  #turnMessageId?: string;
  #replyKind?: ReplyKind;

  constructor(conversationId: string, mode: Mode, ctx: ModeContext, handoff?: string) {
    this.conversationId = conversationId;
    this.mode = mode;
    this.#handoff = handoff;
    this.#ctx = { ...ctx, emitGmEvent: (event) => this.#emit({ type: 'gm_event', event }) };
  }

  /* --------------------------------- lifecycle ------------------------------- */

  start(resume?: string) {
    if (this.#query) return;
    this.#query = query({
      prompt: this.#messages(),
      options: modeToOptions(this.mode, this.#ctx, {
        ...(this.mode.needsApproval ? { canUseTool: this.#canUseTool } : {}),
        ...(resume ? { resume } : {}),
      }),
    });
    void this.#pump();
  }

  close() {
    this.#closed = true;
    this.#wake?.();
    // Unblock anything waiting on an approval that will now never be answered.
    for (const [, pending] of this.#pending) pending.resolve(false);
    this.#pending.clear();
    this.#query?.close();
    this.#query = undefined;
  }

  async interrupt() {
    await this.#query?.interrupt().catch(() => undefined);
  }

  get sessionId() {
    return this.#sessionId;
  }

  /* -------------------------------- subscribers ------------------------------ */

  subscribe(fn: Subscriber): () => void {
    this.#subscribers.add(fn);
    fn({ type: 'ready', conversationId: this.conversationId, ...(this.#sessionId ? { sessionId: this.#sessionId } : {}) });
    return () => this.#subscribers.delete(fn);
  }

  #emit(event: CamEvent) {
    for (const fn of this.#subscribers) {
      try {
        fn(event);
      } catch {
        // A dead SSE connection must not take down the session.
      }
    }
  }

  /* ----------------------------------- input --------------------------------- */

  /**
   * Queue a user turn. `replyKind` steers Roleplay's dialogue/narration switch
   * for this message only, via the mode's turnReminder.
   */
  send(text: string, opts: { replyKind?: ReplyKind; images?: Array<{ mediaType: string; data: string }> } = {}) {
    if (this.#closed) throw new Error('Session is closed.');
    this.#replyKind = opts.replyKind;

    const reminder = this.mode.turnReminder?.({ ...this.#ctx, replyKind: opts.replyKind });
    const handoff = this.#handoff;
    this.#handoff = undefined;
    const body = [handoff, text, reminder].filter(Boolean).join('\n\n');

    const content: SDKUserMessage['message']['content'] = opts.images?.length
      ? [
          ...opts.images.map((img) => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: img.mediaType as 'image/png', data: img.data },
          })),
          { type: 'text' as const, text: body },
        ]
      : body;

    this.#queue.push({
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
    });
    this.#wake?.();
  }

  /** Answer a permission request raised by canUseTool. */
  resolvePermission(id: string, allow: boolean) {
    const pending = this.#pending.get(id);
    if (!pending) return false;
    this.#pending.delete(id);
    pending.resolve(allow);
    return true;
  }

  async *#messages(): AsyncGenerator<SDKUserMessage> {
    try {
      while (!this.#closed) {
        while (this.#queue.length) {
          const next = this.#queue.shift();
          if (next) yield next;
        }
        if (this.#closed) break;
        await new Promise<void>((resolve) => {
          this.#wake = resolve;
        });
        this.#wake = undefined;
      }
    } catch (error) {
      // The TS SDK reports a generator throw as "Claude Code process aborted by
      // user", which hides the real cause — so log it here where it is visible.
      console.error('[cam-claude] message generator failed:', error);
      throw error;
    }
  }

  /* -------------------------------- permissions ------------------------------ */

  #canUseTool = async (
    toolName: string,
    input: Record<string, unknown>,
    options: { signal: AbortSignal; permissionSuggestions?: unknown; toolUseConfirmationPrompt?: string },
  ): Promise<{ behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string }> => {
    const id = randomUUID();
    const allowed = await new Promise<boolean>((resolve) => {
      this.#pending.set(id, { resolve });
      this.#emit({
        type: 'permission_request',
        id,
        toolName,
        input,
        ...(options.toolUseConfirmationPrompt ? { prompt: options.toolUseConfirmationPrompt } : {}),
      });
      options.signal.addEventListener('abort', () => {
        if (this.#pending.delete(id)) resolve(false);
      });
    });

    return allowed
      ? { behavior: 'allow', updatedInput: input }
      : { behavior: 'deny', message: 'Denied by the user in Cam Claude.' };
  };

  /* ---------------------------------- output --------------------------------- */

  async #pump() {
    if (!this.#query) return;
    try {
      for await (const message of this.#query) {
        this.#handle(message);
      }
    } catch (error) {
      if (this.#closed) return;
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[cam-claude] session error:', error);
      this.#emit({ type: 'error', message: msg });
    }
  }

  #handle(message: SDKMessage) {
    switch (message.type) {
      case 'system': {
        if (process.env.CAM_CLAUDE_DEBUG && 'subtype' in message && message.subtype === 'init') {
          console.log('[cam-claude debug] init tools:', JSON.stringify((message as { tools?: string[] }).tools));
          console.log('[cam-claude debug] init mcp:', JSON.stringify((message as { mcp_servers?: unknown }).mcp_servers));
        }
        if ('session_id' in message && message.session_id && !this.#sessionId) {
          this.#sessionId = message.session_id;
          updateConversation(this.conversationId, { sdk_session_id: message.session_id });
          this.#emit({ type: 'ready', conversationId: this.conversationId, sessionId: message.session_id });
        }
        return;
      }

      case 'stream_event': {
        this.#handleStreamEvent(message.event);
        return;
      }

      case 'assistant': {
        for (const b of message.message.content) {
          if (b.type === 'tool_use') {
            this.#turnTools.push({ id: b.id, name: b.name, input: b.input });
            this.#emit({ type: 'tool_use', id: b.id, name: b.name, input: b.input });
          }
        }
        return;
      }

      case 'user': {
        // Tool results come back as user messages.
        const content = message.message.content;
        if (Array.isArray(content)) {
          for (const b of content) {
            if (typeof b === 'object' && b && 'type' in b && b.type === 'tool_result') {
              const block = b as { tool_use_id: string; is_error?: boolean; content?: unknown };
              this.#emit({
                type: 'tool_result',
                id: block.tool_use_id,
                isError: Boolean(block.is_error),
                preview: previewToolResult(block.content),
              });
            }
          }
        }
        return;
      }

      case 'result': {
        this.#finishTurn(message.subtype !== 'success');
        if ('usage' in message && message.usage) {
          const usage = message.usage as { input_tokens?: number; output_tokens?: number };
          this.#emit({
            type: 'usage',
            ...(usage.input_tokens !== undefined ? { inputTokens: usage.input_tokens } : {}),
            ...(usage.output_tokens !== undefined ? { outputTokens: usage.output_tokens } : {}),
            ...('total_cost_usd' in message && typeof message.total_cost_usd === 'number'
              ? { costUsd: message.total_cost_usd }
              : {}),
          });
        }
        if (message.subtype !== 'success' && 'errorMessage' in message) {
          this.#emit({ type: 'error', message: String(message.errorMessage ?? message.subtype) });
        }
        return;
      }

      default:
        return;
    }
  }

  #handleStreamEvent(event: StreamEvent) {
    if (event.type === 'message_start') {
      this.#turnMessageId = randomUUID();
      this.#turnText = '';
      this.#turnThinking = '';
      this.#turnTools = [];
      this.#emit({ type: 'turn_start', messageId: this.#turnMessageId });
      return;
    }

    if (event.type === 'content_block_delta') {
      const delta: { type: string; text?: string; thinking?: string } = event.delta;
      if (delta.type === 'text_delta' && delta.text) {
        this.#turnText += delta.text;
        this.#emit({ type: 'text_delta', text: delta.text });
      } else if (delta.type === 'thinking_delta' && delta.thinking) {
        this.#turnThinking += delta.thinking;
        this.#emit({ type: 'thinking_delta', text: delta.thinking });
      }
    }
  }

  #finishTurn(aborted: boolean) {
    if (!this.#turnMessageId) return;
    const row = addMessage({
      conversationId: this.conversationId,
      role: 'assistant',
      text: this.#turnText,
      thinking: this.#turnThinking || null,
      toolCalls: this.#turnTools.length ? this.#turnTools : null,
      replyKind: this.#replyKind ?? null,
      aborted,
    });
    this.#emit({
      type: 'turn_end',
      messageId: row.id,
      text: this.#turnText,
      ...(aborted ? { aborted: true } : {}),
    });
    this.#turnMessageId = undefined;
    this.#turnText = '';
    this.#turnThinking = '';
    this.#turnTools = [];
  }
}

function previewToolResult(content: unknown): string {
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .map((b) => (typeof b === 'object' && b && 'text' in b ? String((b as { text: unknown }).text) : ''))
            .join('\n')
        : JSON.stringify(content ?? '');
  return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
}
