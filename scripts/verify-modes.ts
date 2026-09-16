/**
 * Structural checks over every mode. Run with `npm run verify`.
 *
 * Nothing here calls the API, so it is free to run and safe in CI. It asserts
 * the two properties that are easy to break by accident later:
 *
 *  1. Capability boundaries — the tools a mode actually resolves to, not the
 *     tools its prompt claims. This is checked against `modeToOptions`, the
 *     same function the runner uses.
 *  2. Prompt hygiene — that no mode prompt has grown hedging, disclaimers, or
 *     restrictions beyond what the mode functionally needs.
 */

import { z } from 'zod';
import { modes } from '../server/modes/index.js';
import { modeToOptions } from '../server/agent/options.js';
import { gmToolDefinitions, GM_TOOL_NAMES, rollDice } from '../server/tools/gm.js';
import type { Mode, ModeContext, ModeId } from '../server/modes/types.js';

const fixture: ModeContext = {
  conversationId: 'conv_fixture',
  cwd: '/tmp/fixture-project',
  characters: [
    {
      id: 'char_fixture',
      name: 'Mira',
      description: 'A tired locksmith with a grudge.',
      instructions: 'Terse. Never explains herself twice.',
      loreEntries: [{ keys: ['garrison'], content: 'The northern garrison fell two winters ago.' }],
      scenario: 'Mira is picking a lock she should not be picking.',
    },
  ],
  persona: { id: 'persona_fixture', name: 'Rook', description: 'A fence with a bad reputation.' },
  world: { scene: 'A back alley', location: 'Ward Six', time: 'past midnight', present: ['Mira'] },
  stats: { Mira: { health: 9 } },
  inventory: { Mira: ['lockpicks'] },
  memories: [{ kind: 'pinned', text: 'Rook still owes Mira for the Vance job.' }],
  recentText: 'the garrison',
  replyKind: 'dialog',
};

/** What each mode must resolve to. `tools` is the availability boundary. */
const EXPECTED: Record<ModeId, { tools: string[] | 'claude_code'; mustAllow?: string[]; mustNotAllow?: string[] }> = {
  general:    { tools: [] },
  roleplay:   { tools: [], mustAllow: ['mcp__gm__roll_dice'], mustNotAllow: ['Bash', 'Read', 'Write', 'Edit'] },
  websearch:  { tools: ['WebSearch', 'WebFetch'], mustNotAllow: ['Bash', 'Write', 'Edit'] },
  brainstorm: { tools: [] },
  writing:    { tools: ['Read'], mustNotAllow: ['Write', 'Edit', 'Bash'] },
  research:   { tools: ['WebSearch', 'WebFetch', 'Read', 'Write', 'Glob', 'Grep', 'Task', 'TodoWrite'], mustNotAllow: ['Bash'] },
  code:       { tools: 'claude_code' },
};

/**
 * Phrasings that mean a prompt has started adding caution the model did not
 * need. Matched case-insensitively against the assembled system prompt.
 */
const HEDGING_DENYLIST = [
  'consult a professional',
  'seek professional',
  'it is important to note',
  "it's important to note",
  'i must caution',
  'i should caution',
  'as an ai',
  'i am an ai',
  'be mindful that',
  'please be aware that',
  'remember that i cannot',
  'avoid harmful',
  'inappropriate content',
  'sensitive topics',
  'err on the side of caution',
  'decline to',
  'i am not able to help with',
];

let failures = 0;
const fail = (mode: string, message: string) => {
  failures += 1;
  console.error(`  ✗ ${mode}: ${message}`);
};

function promptText(mode: Mode): string {
  const spec = mode.systemPrompt(fixture);
  if (typeof spec === 'string') return spec;
  if (Array.isArray(spec)) return spec.join('\n');
  if (spec.type === 'preset') return spec.append ?? '';
  return Array.isArray(spec.prompt) ? spec.prompt.join('\n') : spec.prompt;
}

console.log('\nCam Claude — mode verification\n');

for (const mode of modes) {
  const expected = EXPECTED[mode.id];
  if (!expected) {
    fail(mode.id, 'no expectation declared in verify-modes.ts — add one');
    continue;
  }

  const options = modeToOptions(mode, fixture);

  // 1. Capability boundary.
  if (expected.tools === 'claude_code') {
    const usesPreset =
      options.tools && !Array.isArray(options.tools) && options.tools.preset === 'claude_code';
    if (!usesPreset) fail(mode.id, `expected the claude_code tool preset, got ${JSON.stringify(options.tools)}`);
  } else {
    const actual = Array.isArray(options.tools) ? options.tools : null;
    if (!actual) {
      fail(mode.id, `expected an explicit tool list, got ${JSON.stringify(options.tools)}`);
    } else {
      const extra = actual.filter((t) => !expected.tools.includes(t));
      const missing = expected.tools.filter((t) => !actual.includes(t));
      if (extra.length) fail(mode.id, `tools not in the declared boundary: ${extra.join(', ')}`);
      if (missing.length) fail(mode.id, `declared tools missing: ${missing.join(', ')}`);
    }
  }

  const allowed = options.allowedTools ?? [];
  for (const tool of expected.mustAllow ?? []) {
    if (!allowed.includes(tool)) fail(mode.id, `should pre-approve ${tool}`);
  }
  for (const tool of expected.mustNotAllow ?? []) {
    if (allowed.includes(tool)) fail(mode.id, `must not pre-approve ${tool}`);
  }

  // 2. Personal Claude Code config must not leak into non-coding modes.
  const sources = options.settingSources ?? [];
  if (mode.id === 'code') {
    if (!sources.includes('project')) fail(mode.id, 'Code mode should load project settings');
  } else if (sources.length) {
    fail(mode.id, `settingSources should be empty, got [${sources.join(', ')}]`);
  }

  // 3. Prompt hygiene.
  const prompt = promptText(mode).toLowerCase();
  for (const phrase of HEDGING_DENYLIST) {
    if (prompt.includes(phrase)) fail(mode.id, `prompt contains hedging phrase "${phrase}"`);
  }
  if (!prompt.trim()) fail(mode.id, 'assembled an empty system prompt');

  if (!failures) console.log(`  ✓ ${mode.label}`);
}

// Roleplay's prompt is assembled per turn, so check that the pieces land.
const roleplay = modes.find((m) => m.id === 'roleplay')!;
const rpPrompt = promptText(roleplay);
for (const fragment of ['Mira', 'Rook', 'Ward Six', 'lockpicks', 'Vance job', 'northern garrison']) {
  if (!rpPrompt.includes(fragment)) fail('roleplay', `context "${fragment}" never reached the prompt`);
}
if (roleplay.turnReminder?.({ ...fixture, replyKind: 'narrator' })?.includes('narrator') !== true) {
  fail('roleplay', 'narrator turn reminder did not render');
}

/*
 * 4. Custom tool schemas must survive JSON-Schema conversion.
 *
 * This exists because of a real failure: a `z.record()` field converted to a
 * schema using `propertyNames`/`additionalProperties`, the CLI rejected it, and
 * it took down *every* tool on the server rather than just its own. The symptom
 * was Claude narrating dice rolls it had never made, which reads like a
 * prompting problem and is not one.
 */
for (const tool of gmToolDefinitions('conv_fixture', () => undefined)) {
  let json: { properties?: Record<string, unknown> };
  try {
    json = z.toJSONSchema(z.object(tool.inputSchema), { io: 'input' }) as typeof json;
  } catch (error) {
    fail('gm tools', `${tool.name}: schema will not convert — ${(error as Error).message}`);
    continue;
  }

  for (const [field, schema] of Object.entries(json.properties ?? {})) {
    const s = schema as { propertyNames?: unknown; additionalProperties?: unknown; default?: unknown };
    if (s.propertyNames !== undefined) {
      fail('gm tools', `${tool.name}.${field} converts to an open-ended map (propertyNames). Use a list of {name, value} pairs instead.`);
    }
    if (s.additionalProperties !== undefined && s.additionalProperties !== false) {
      fail('gm tools', `${tool.name}.${field} converts with open additionalProperties, which the CLI rejects.`);
    }
    // `.default()` registers fine but fails the CLI's call-time validation with
    // "expected nonoptional, received undefined" when the model omits the field.
    if (s.default !== undefined) {
      fail('gm tools', `${tool.name}.${field} uses .default(); use .optional() and apply the default in the handler.`);
    }
  }
}

const roleplayAllowed = modeToOptions(roleplay, fixture).allowedTools ?? [];
for (const name of GM_TOOL_NAMES) {
  if (!roleplayAllowed.includes(name)) fail('roleplay', `${name} is not pre-approved`);
}
const declared = new Set(gmToolDefinitions('conv_fixture', () => undefined).map((t) => `mcp__gm__${t.name}`));
for (const name of GM_TOOL_NAMES) {
  if (!declared.has(name)) fail('gm tools', `GM_TOOL_NAMES lists ${name}, which no tool defines`);
}
for (const name of declared) {
  if (!GM_TOOL_NAMES.includes(name)) fail('gm tools', `${name} exists but is missing from GM_TOOL_NAMES, so it would never be approved`);
}

// 5. Dice are real: the notation parser must reject junk rather than guess.
for (const bad of ['', 'd', '2d', 'abc', '0d6', '2d1']) {
  try {
    rollDice(bad);
    fail('gm tools', `rollDice accepted invalid notation "${bad}"`);
  } catch {
    // expected
  }
}
const sample = rollDice('3d6+2');
if (sample.rolls.length !== 3) fail('gm tools', 'rollDice returned the wrong number of dice');
if (sample.total !== sample.rolls.reduce((a, b) => a + b, 0) + 2) fail('gm tools', 'rollDice total does not match its dice');

if (failures) {
  console.error(`\n${failures} check${failures === 1 ? '' : 's'} failed.\n`);
  process.exit(1);
}
console.log(`\nAll ${modes.length} modes verified.\n`);
