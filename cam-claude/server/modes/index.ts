import type { Mode, ModeId, ModeContext } from './types.js';
import { summarize } from './types.js';
import { generalMode } from './general.js';
import { websearchMode } from './websearch.js';
import { brainstormMode } from './brainstorm.js';
import { writingMode } from './writing.js';
import { researchMode } from './research.js';
import { codeMode } from './code.js';
import { roleplayMode } from './roleplay/index.js';

/** Display order in the mode picker. */
export const modes: Mode[] = [
  generalMode,
  roleplayMode,
  websearchMode,
  codeMode,
  researchMode,
  writingMode,
  brainstormMode,
];

const byId = new Map<ModeId, Mode>(modes.map((m) => [m.id, m]));

export function getMode(id: string): Mode | undefined {
  return byId.get(id as ModeId);
}

export function requireMode(id: string): Mode {
  const mode = getMode(id);
  if (!mode) throw new Error(`Unknown mode: ${id}`);
  return mode;
}

export function listModeSummaries() {
  return modes.map(summarize);
}

export type { Mode, ModeId, ModeContext };
export { summarize };
