import type {
  McpServerConfig,
  Options,
  PermissionMode,
  SettingSource,
} from '@anthropic-ai/claude-agent-sdk';

export type ModeId =
  | 'general'
  | 'roleplay'
  | 'websearch'
  | 'code'
  | 'research'
  | 'writing'
  | 'brainstorm';

/** The `systemPrompt` shapes the SDK accepts, narrowed to the ones we use. */
export type SystemPromptSpec = NonNullable<Options['systemPrompt']>;

/** Roleplay sends either in-character dialogue or omniscient narration. */
export type ReplyKind = 'dialog' | 'narrator';

export interface Character {
  id: string;
  name: string;
  /** Name the character uses for itself in chat, when it differs from `name`. */
  chatName?: string;
  description?: string;
  /** Free-form directives about how this character should be played. */
  instructions?: string;
  speechPatterns?: string;
  lore?: string;
  loreEntries?: LoreEntry[];
  avatar?: string;
  greeting?: string;
  scenario?: string;
}

export interface LoreEntry {
  keys: string[];
  content: string;
  /** Always include, regardless of whether a key matched recent turns. */
  constant?: boolean;
}

export interface Persona {
  id: string;
  name: string;
  description?: string;
  avatar?: string;
}

export interface WorldState {
  scene?: string;
  location?: string;
  time?: string;
  present?: string[];
  flags?: Record<string, unknown>;
}

export type StatBlock = Record<string, Record<string, number>>;
export type InventoryBlock = Record<string, string[]>;

export interface Memory {
  kind: 'pinned' | 'auto';
  text: string;
}

/**
 * Everything a mode needs to assemble its prompt for one turn. Modes read only
 * the fields they care about; General Chat ignores nearly all of it.
 */
export interface ModeContext {
  conversationId: string;
  /** Directory Code mode operates in. Ignored by every other mode. */
  cwd?: string;
  characters?: Character[];
  persona?: Persona;
  world?: WorldState;
  stats?: StatBlock;
  inventory?: InventoryBlock;
  memories?: Memory[];
  replyKind?: ReplyKind;
  /** Recent turn text, used to match lorebook keys. */
  recentText?: string;
  model?: string;
  /**
   * Lets a mode's in-process tools push events straight to the browser.
   * Supplied by the SessionRunner; modes without tools ignore it.
   */
  emitGmEvent?: (event: unknown) => void;
}

export interface ModeUi {
  composer: 'plain' | 'roleplay' | 'research' | 'code';
  showThinking: boolean;
  showToolCalls: boolean;
  sidebar?: 'characters' | 'files' | 'sources';
  /** Placeholder text for the message box. */
  placeholder: string;
}

export interface Mode {
  id: ModeId;
  label: string;
  icon: string;
  blurb: string;

  /** How Claude is instructed. Assembled fresh for each new session. */
  systemPrompt: (ctx: ModeContext) => SystemPromptSpec;
  /**
   * Appended to a single user turn, not the system prompt. Used for things that
   * change per message — e.g. Roleplay's dialogue/narration switch.
   */
  turnReminder?: (ctx: ModeContext) => string | null;

  /**
   * Which built-in tools exist in Claude's context at all.
   * `[]` removes every built-in; `undefined` keeps the Claude Code default set.
   * This is the real mode boundary — prompt text alone would not hold.
   */
  tools?: string[] | { type: 'preset'; preset: 'claude_code' };
  /** Pre-approved, so these never raise a permission prompt. */
  allowedTools: string[];
  disallowedTools?: string[];
  mcpServers?: (ctx: ModeContext) => Record<string, McpServerConfig>;
  permissionMode: PermissionMode;
  /** `[]` keeps your personal CLAUDE.md and Claude Code settings out of the app. */
  settingSources: SettingSource[];
  /**
   * Whether tool calls outside `allowedTools` should raise an approve/deny card
   * in the browser. Only true for Code mode; elsewhere `allowedTools` already
   * covers every tool the mode has, so a callback would never fire.
   */
  needsApproval?: boolean;

  model?: string;
  maxTurns?: number;
  cwd?: (ctx: ModeContext) => string | undefined;

  ui: ModeUi;
}

/** Shape sent to the browser for the mode picker. */
export interface ModeSummary {
  id: ModeId;
  label: string;
  icon: string;
  blurb: string;
  ui: ModeUi;
}

export function summarize(mode: Mode): ModeSummary {
  return { id: mode.id, label: mode.label, icon: mode.icon, blurb: mode.blurb, ui: mode.ui };
}
