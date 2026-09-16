/** Events the server pushes to the browser over SSE. */
export type CamEvent =
  | { type: 'ready'; conversationId: string; sessionId?: string }
  | { type: 'turn_start'; messageId: string }
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; isError: boolean; preview: string }
  | { type: 'gm_event'; event: unknown }
  | {
      type: 'permission_request';
      id: string;
      toolName: string;
      input: unknown;
      prompt?: string;
    }
  | { type: 'turn_end'; messageId: string; text: string; aborted?: boolean }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; costUsd?: number }
  | { type: 'error'; message: string };

export type Subscriber = (event: CamEvent) => void;
