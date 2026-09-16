import type {
  Character,
  InventoryBlock,
  LoreEntry,
  Memory,
  ModeContext,
  Persona,
  StatBlock,
  WorldState,
} from '../types.js';
import { block, bullets, sections } from '../prompt-utils.js';

/**
 * Lorebook entries fire when one of their keys appears in recent conversation
 * text, which keeps the prompt from carrying an entire setting bible every turn.
 * Entries marked `constant` are always in.
 */
export function matchLore(entries: LoreEntry[] | undefined, recentText: string): LoreEntry[] {
  if (!entries?.length) return [];
  const haystack = recentText.toLowerCase();
  return entries.filter(
    (e) => e.constant || e.keys.some((k) => k.trim() && haystack.includes(k.trim().toLowerCase())),
  );
}

function describeCharacter(c: Character, recentText: string): string {
  const lore = matchLore(c.loreEntries, recentText);
  return sections(
    `## ${c.chatName || c.name}`,
    c.description,
    c.instructions ? `How to play them: ${c.instructions}` : null,
    c.speechPatterns ? `Speech: ${c.speechPatterns}` : null,
    c.lore,
    lore.length ? lore.map((e) => e.content.trim()).join('\n\n') : null,
  );
}

function describePersona(p: Persona | undefined): string | null {
  if (!p) return null;
  return sections(`The user is playing **${p.name}**.`, p.description);
}

function describeWorld(w: WorldState | undefined): string | null {
  if (!w) return null;
  return sections(
    w.scene ? `Scene: ${w.scene}` : null,
    w.location ? `Location: ${w.location}` : null,
    w.time ? `Time: ${w.time}` : null,
    w.present?.length ? `Present: ${w.present.join(', ')}` : null,
    w.flags && Object.keys(w.flags).length
      ? `Established facts:\n${JSON.stringify(w.flags, null, 2)}`
      : null,
  );
}

function describeStats(stats: StatBlock | undefined, inv: InventoryBlock | undefined): string | null {
  const statLines = Object.entries(stats ?? {}).map(
    ([who, values]) =>
      `${who}: ${Object.entries(values)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')}`,
  );
  const invLines = Object.entries(inv ?? {})
    .filter(([, items]) => items.length)
    .map(([who, items]) => `${who} carries: ${items.join(', ')}`);
  const all = [...statLines, ...invLines];
  return all.length ? all.join('\n') : null;
}

function describeMemories(memories: Memory[] | undefined): string | null {
  if (!memories?.length) return null;
  const pinned = memories.filter((m) => m.kind === 'pinned');
  const auto = memories.filter((m) => m.kind === 'auto');
  return sections(
    pinned.length ? bullets(pinned.map((m) => m.text)) : null,
    auto.length ? `Earlier in this story:\n${auto.map((m) => m.text).join('\n')}` : null,
  );
}

/** The contract that makes this a roleplay session rather than a chat about one. */
const MODE_CONTRACT = sections(
  'You are running a collaborative fiction session. You play every character except the user\'s, and you narrate the world.',
  bullets([
    'Stay in the fiction. No out-of-character commentary, no asking whether the user is enjoying it, no summarizing what just happened as if reporting on it.',
    'Write only your own characters. Never write the user\'s dialogue, thoughts, decisions, or actions — leave them room to act.',
    'End each turn somewhere the user can respond: an action landing, a question asked, a situation changing. Do not close every thread.',
    'Give characters their own agency. They want things, refuse things, lie, misread situations, and act when the user is passive.',
    'Prose style: past tense, third person limited unless the scene has established otherwise. Actions and description in plain text, *asterisks* for emphasis, "quotes" for speech.',
    'Keep continuity with what is established below. If something contradicts it, the established record wins.',
    'Let the story go where it goes. Tone, intensity, and subject matter follow the scene the user is building.',
  ]),
);

const GM_TOOLS_CONTRACT = sections(
  'You have game-master tools. The values they return are authoritative — narrate the result you got, never a number you would have preferred.',
  bullets([
    'roll_dice — for any genuinely uncertain outcome: combat, skill checks, chance. Roll first, then narrate what the result means.',
    'read_world_state / update_world_state — record changes as they happen: location, time, who is present, facts established in play.',
    'advance_scene — on a real scene break (time skip, location change, chapter turn).',
    'adjust_stat / update_inventory — when something is spent, gained, lost, or damaged.',
    'recall_lore — when the story reaches a corner of the setting you do not have loaded.',
  ]),
  'Call these as part of playing the scene. Do not announce that you are using a tool or ask permission first.',
);

export function buildRoleplayPrompt(ctx: ModeContext): string {
  const recent = ctx.recentText ?? '';
  const chars = ctx.characters ?? [];

  return sections(
    MODE_CONTRACT,
    GM_TOOLS_CONTRACT,
    block('the user', describePersona(ctx.persona)),
    block(
      'your characters',
      chars.length ? chars.map((c) => describeCharacter(c, recent)).join('\n\n') : null,
    ),
    block('world state', describeWorld(ctx.world)),
    block('stats and inventory', describeStats(ctx.stats, ctx.inventory)),
    block('story memory', describeMemories(ctx.memories)),
    block(
      'scene',
      chars.find((c) => c.scenario)?.scenario ?? null,
    ),
  );
}

/**
 * Injected into one user turn only. This is how the Dialog and Narrator send
 * buttons steer a reply without rewriting the system prompt.
 */
export function roleplayTurnReminder(ctx: ModeContext): string | null {
  if (ctx.replyKind === 'narrator') {
    return '[Respond as the narrator: describe the world, events, and what other characters do. Pull back from any single character\'s head.]';
  }
  if (ctx.replyKind === 'dialog') {
    const name = ctx.characters?.[0]?.chatName || ctx.characters?.[0]?.name;
    return name
      ? `[Respond in character as ${name}, in the scene, right now.]`
      : '[Respond in character, in the scene, right now.]';
  }
  return null;
}
