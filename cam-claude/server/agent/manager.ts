import { SessionRunner } from './runner.js';
import { requireMode } from '../modes/index.js';
import type { ModeContext } from '../modes/types.js';
import {
  getConversation,
  getConversationCharacters,
  getPersona,
  getWorld,
  listMemories,
  listMessages,
  recentText,
  updateConversation,
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

/**
 * Drops the live session without discarding the SDK session behind it.
 *
 * Use this when nothing about the prompt changed — closing a conversation, or
 * deleting one. To make a prompt change take effect, use `invalidatePrompt`.
 */
export function restart(conversationId: string) {
  runners.get(conversationId)?.close();
  runners.delete(conversationId);
  handoffs.delete(conversationId);
}

/**
 * Call this whenever anything the system prompt is built from has changed:
 * the mode, the characters, the persona, the working directory, a memory.
 *
 * Why it has to exist: the SDK snapshots the system prompt on a session's
 * first request and keeps using that snapshot for the life of the session,
 * including across `resume`. Rebuilding the prompt is therefore not enough —
 * dropping the runner and letting it resume the same session silently restores
 * the old prompt, and the change looks applied while doing nothing at all.
 *
 * So the SDK session id is cleared, which forces a genuinely new session on the
 * next turn, and a recap of the recent exchange is carried into it so the new
 * session does not start blind.
 */
export function invalidatePrompt(conversationId: string, reason: string) {
  const handoff = buildHandoff(conversationId, reason);
  updateConversation(conversationId, { sdk_session_id: null });
  runners.get(conversationId)?.close();
  runners.delete(conversationId);
  if (handoff) handoffs.set(conversationId, handoff);
  else handoffs.delete(conversationId);
}

/**
 * A short recap of the recent exchange, folded into the first message of the
 * replacement session so continuity survives the restart.
 */
function buildHandoff(conversationId: string, reason: string): string {
  const recent = listMessages(conversationId)
    .filter((m) => m.role !== 'system' && m.text.trim())
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'You'}: ${m.text.slice(0, 500)}`)
    .join('\n');

  if (!recent) return '';
  return [
    `[Continuing a conversation already in progress — ${reason}.`,
    'Recent exchange, for context:',
    recent,
    'Pick up from here, following the instructions above.]',
  ].join('\n');
}

/** The recap waiting for the next session. Exposed so tests can assert on it. */
export function pendingHandoff(conversationId: string): string | undefined {
  return handoffs.get(conversationId);
}

export function peekRunner(conversationId: string): SessionRunner | undefined {
  return runners.get(conversationId);
}

export function closeAll() {
  for (const runner of runners.values()) runner.close();
  runners.clear();
}
