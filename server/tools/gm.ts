import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import {
  addGmEvent,
  getWorld,
  saveWorld,
  getConversationCharacters,
} from '../store/repo.js';
import type { GmEvent } from '../store/repo.js';
import { matchLore } from '../modes/roleplay/prompt.js';

export type GmEventSink = (event: GmEvent) => void;

const DICE = /^\s*(\d*)\s*d\s*(\d+)\s*(?:([+-])\s*(\d+))?\s*$/i;

export interface RollResult {
  notation: string;
  rolls: number[];
  modifier: number;
  total: number;
}

/**
 * Parses `2d6+3`, `d20`, `4d8-2`. Throws on anything else rather than guessing,
 * so a malformed roll surfaces to Claude as a tool error it can correct.
 */
export function rollDice(notation: string): RollResult {
  const m = DICE.exec(notation);
  if (!m) throw new Error(`Unrecognized dice notation: "${notation}". Use forms like 2d6+3 or d20.`);

  const count = m[1] ? Number.parseInt(m[1], 10) : 1;
  const sides = Number.parseInt(m[2]!, 10);
  const sign = m[3] === '-' ? -1 : 1;
  const modifier = m[4] ? sign * Number.parseInt(m[4], 10) : 0;

  if (count < 1 || count > 100) throw new Error('Dice count must be between 1 and 100.');
  if (sides < 2 || sides > 1000) throw new Error('Dice must have between 2 and 1000 sides.');

  // crypto.randomInt rather than Math.random: the point of this tool is that
  // the result is not something the model produced.
  const rolls = Array.from({ length: count }, () => randomInt(1, sides + 1));
  const total = rolls.reduce((a, b) => a + b, 0) + modifier;
  return { notation: notation.trim(), rolls, modifier, total };
}

function text(body: string) {
  return { content: [{ type: 'text' as const, text: body }] };
}

function failure(body: string) {
  return { content: [{ type: 'text' as const, text: body }], isError: true };
}

/**
 * Game-master tools for one conversation. Results are recorded to SQLite and
 * pushed to the browser so the UI can render them as cards instead of relying
 * on Claude to restate them in prose.
 */
export function gmToolDefinitions(conversationId: string, emit: GmEventSink) {
  const record = (kind: GmEvent['kind'], data: unknown) => {
    const event = addGmEvent(conversationId, kind, data);
    emit(event);
    return event;
  };

  const rollDiceTool = tool(
    'roll_dice',
    'Roll dice for an uncertain outcome. Returns a real random result that you must narrate faithfully.',
    {
      notation: z.string().describe('Dice notation, e.g. "2d6+3", "d20", "4d8-2"'),
      reason: z.string().describe('What is being rolled for, e.g. "Mira picking the lock"'),
    },
    async (args) => {
      let result: RollResult;
      try {
        result = rollDice(args.notation);
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
      record('roll', { ...result, reason: args.reason });
      const breakdown = result.rolls.join(' + ');
      const mod = result.modifier ? ` ${result.modifier > 0 ? '+' : '-'} ${Math.abs(result.modifier)}` : '';
      return text(`${args.reason}\n${result.notation} → [${breakdown}]${mod} = ${result.total}`);
    },
    { annotations: { readOnlyHint: false, openWorldHint: false } },
  );

  const readWorldState = tool(
    'read_world_state',
    'Read the current scene, location, time, who is present, and established facts.',
    {},
    async () => text(JSON.stringify(getWorld(conversationId), null, 2)),
    { annotations: { readOnlyHint: true, openWorldHint: false } },
  );

  const updateWorldState = tool(
    'update_world_state',
    'Record a change to the world: location, time, who is present, or a fact established in play. Only pass the fields that changed.',
    {
      scene: z.string().optional().describe('What is happening right now'),
      location: z.string().optional(),
      time: z.string().optional().describe('In-fiction time, e.g. "just past midnight"'),
      present: z.array(z.string()).optional().describe('Characters currently in the scene'),
      // A list of pairs rather than a record: `z.record` fails this SDK's
      // JSON-Schema conversion silently, and one bad schema drops every tool on
      // the server, not just its own.
      facts: z
        .array(z.object({ name: z.string(), value: z.string() }))
        .optional()
        .describe('Facts to set or overwrite, e.g. [{"name":"knows_about_the_letter","value":"yes"}]'),
      reason: z.string().describe('Why this changed, in one line'),
    },
    async (args) => {
      const world = getWorld(conversationId);
      const next = {
        ...world,
        state: {
          ...world.state,
          ...(args.scene !== undefined ? { scene: args.scene } : {}),
          ...(args.location !== undefined ? { location: args.location } : {}),
          ...(args.time !== undefined ? { time: args.time } : {}),
          ...(args.present !== undefined ? { present: args.present } : {}),
          flags: {
            ...(world.state.flags ?? {}),
            ...Object.fromEntries((args.facts ?? []).map((f) => [f.name, f.value])),
          },
        },
      };
      saveWorld(conversationId, next);
      record('scene', { kind: 'update', reason: args.reason, state: next.state });
      return text(`World state updated.\n${JSON.stringify(next.state, null, 2)}`);
    },
    { annotations: { readOnlyHint: false, openWorldHint: false } },
  );

  const advanceScene = tool(
    'advance_scene',
    'Mark a real scene break — a time skip, a location change, or a chapter turn.',
    {
      location: z.string().describe('Where the new scene takes place'),
      time: z.string().describe('When, in fiction, e.g. "three days later"'),
      present: z.array(z.string()).optional().describe('Who is in the new scene'),
      summary: z.string().describe('One or two lines on what happened in the scene just ended'),
    },
    async (args) => {
      const world = getWorld(conversationId);
      const next = {
        ...world,
        state: {
          ...world.state,
          scene: args.summary,
          location: args.location,
          time: args.time,
          present: args.present ?? [],
        },
      };
      saveWorld(conversationId, next);
      record('scene', { kind: 'break', ...args, present: args.present ?? [] });
      return text(`Scene advanced to ${args.location}, ${args.time}.`);
    },
    { annotations: { readOnlyHint: false, openWorldHint: false } },
  );

  const adjustStat = tool(
    'adjust_stat',
    'Change a tracked numeric stat for a character, e.g. health, ammo, coin, a relationship score.',
    {
      target: z.string().describe('Whose stat, e.g. "Mira" or the player persona name'),
      stat: z.string().describe('Stat name, e.g. "health"'),
      delta: z.number().describe('Change to apply; negative to reduce'),
      reason: z.string().describe('Why, in one line'),
    },
    async (args) => {
      const world = getWorld(conversationId);
      const forTarget = { ...(world.stats[args.target] ?? {}) };
      const before = forTarget[args.stat] ?? 0;
      const after = before + args.delta;
      forTarget[args.stat] = after;
      const next = { ...world, stats: { ...world.stats, [args.target]: forTarget } };
      saveWorld(conversationId, next);
      record('stat', { ...args, before, after });
      return text(`${args.target} ${args.stat}: ${before} → ${after} (${args.reason})`);
    },
    { annotations: { readOnlyHint: false, openWorldHint: false } },
  );

  const updateInventory = tool(
    'update_inventory',
    'Add or remove items a character is carrying.',
    {
      target: z.string().describe('Whose inventory'),
      add: z.array(z.string()).optional().describe('Items gained'),
      remove: z.array(z.string()).optional().describe('Items lost, spent, or destroyed'),
      reason: z.string().describe('Why, in one line'),
    },
    async (args) => {
      const world = getWorld(conversationId);
      const current = world.inventory[args.target] ?? [];
      const add = args.add ?? [];
      const remove = args.remove ?? [];
      const removed: string[] = [];
      const kept = current.filter((item) => {
        const hit = remove.some((r) => r.toLowerCase() === item.toLowerCase());
        if (hit) removed.push(item);
        return !hit;
      });
      const missing = remove.filter(
        (r) => !removed.some((d) => d.toLowerCase() === r.toLowerCase()),
      );
      const items = [...kept, ...add];
      const next = { ...world, inventory: { ...world.inventory, [args.target]: items } };
      saveWorld(conversationId, next);
      record('inventory', { ...args, add, remove, items });

      const note = missing.length
        ? `\nNot carried, so nothing was removed: ${missing.join(', ')}.`
        : '';
      return text(`${args.target} now carries: ${items.join(', ') || '(nothing)'}${note}`);
    },
    { annotations: { readOnlyHint: false, openWorldHint: false } },
  );

  const recallLore = tool(
    'recall_lore',
    'Look up setting detail from the loaded character and world cards that is not already in your context.',
    { query: z.string().describe('What you need to know about, e.g. "the northern garrison"') },
    async (args) => {
      const chars = getConversationCharacters(conversationId);
      const hits = chars.flatMap((c) =>
        matchLore(c.loreEntries, args.query).map((e) => `[${c.name}] ${e.content}`),
      );
      if (!hits.length) {
        return text(
          `No lore entry matches "${args.query}". Nothing is established about it, so you are free to invent it — then record it with update_world_state.`,
        );
      }
      return text(hits.join('\n\n'));
    },
    { annotations: { readOnlyHint: true, openWorldHint: false } },
  );

  return [
    rollDiceTool,
    readWorldState,
    updateWorldState,
    advanceScene,
    adjustStat,
    updateInventory,
    recallLore,
  ];
}

export function createGmServer(conversationId: string, emit: GmEventSink) {
  return createSdkMcpServer({
    name: 'gm',
    version: '1.0.0',
    // Roleplay runs with `tools: []`, which removes the built-in ToolSearch
    // along with everything else. Tool search defers SDK MCP tools by default,
    // so without this the model would see the tool names, be unable to load
    // their schemas, and narrate a dice roll instead of making one.
    alwaysLoad: true,
    tools: gmToolDefinitions(conversationId, emit),
  });
}

/** Fully-qualified names, for the mode's allowedTools. */
export const GM_TOOL_NAMES = [
  'mcp__gm__roll_dice',
  'mcp__gm__read_world_state',
  'mcp__gm__update_world_state',
  'mcp__gm__advance_scene',
  'mcp__gm__adjust_stat',
  'mcp__gm__update_inventory',
  'mcp__gm__recall_lore',
];
