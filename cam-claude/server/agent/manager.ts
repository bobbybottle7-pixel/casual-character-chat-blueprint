import { SessionRunner } from './runner.js';
import { requireMode } from '../modes/index.js';
import type { ModeContext } from '../modes/types.js';
import {
  getConversation,
  getConversationCharacters,
  getPersona,
  getWorld,
  listMemories,
  recentText,
} from '../store/repo.js';

const runners = new Map<string, SessionRunner>();
/** Recaps waiting to be folded into the next session's first message. */
const handoffs = new Map<string, string>();

/** Assembles everything a mode's prompt builder might want from the database. */
export function buildContext(conversationId: string): ModeContext {
  const conv = getConversation(conversationId);
  if (!conv) throw new Error(`Unknown conversation: ${conversationId}`);

  const world = getWorld(conversationId);
  const persona = conv.persona_id ? getPersona(conv.persona_id) : undefined;

  return {
    conversationId,
    ...(conv.cwd ? { cwd: conv.cwd } : {}),
    characters: getConversationCharacters(conversationId),
    ...(persona ? { persona } : {}),
    world: world.state,
    stats: world.stats,
    inventory: world.inventory,
    memories: listMemories(conversationId),
    recentText: recentText(conversationId),
  };
}

/**
 * Returns the live session for a conversation, starting one if needed.
 *
 * A session is started once and kept alive; the SDK snapshots the system prompt
 * on a session's first request, so a mode change must go through `restart`
 * rather than being applied to a running session.
 */
export function getRunner(conversationId: string): SessionRunner {
  const existing = runners.get(conversationId);
  if (existing) return existing;

  const conv = getConversation(conversationId);
  if (!conv) throw new Error(`Unknown conversation: ${conversationId}`);

  const mode = requireMode(conv.mode_id);
  const handoff = handoffs.get(conversationId);
  handoffs.delete(conversationId);
  const runner = new SessionRunner(conversationId, mode, buildContext(conversationId), handoff);
  runners.set(conversationId, runner);
  runner.start(conv.sdk_session_id ?? undefined);
  return runner;
}

/** Tears the session down so the next send rebuilds it with a fresh prompt. */
export function restart(conversationId: string, handoff?: string) {
  runners.get(conversationId)?.close();
  runners.delete(conversationId);
  if (handoff) handoffs.set(conversationId, handoff);
  else handoffs.delete(conversationId);
}

export function peekRunner(conversationId: string): SessionRunner | undefined {
  return runners.get(conversationId);
}

export function closeAll() {
  for (const runner of runners.values()) runner.close();
  runners.clear();
}
