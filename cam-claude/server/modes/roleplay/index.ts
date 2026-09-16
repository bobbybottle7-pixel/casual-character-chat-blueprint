import type { Mode } from '../types.js';
import { buildRoleplayPrompt, roleplayTurnReminder } from './prompt.js';
import { createGmServer, GM_TOOL_NAMES } from '../../tools/gm.js';
import type { GmEvent } from '../../store/repo.js';

/**
 * Collaborative fiction with a game-master layer.
 *
 * `tools: []` strips every built-in, so the only things Claude can call here are
 * the GM tools below — it cannot wander into the filesystem mid-scene.
 */
export const roleplayMode: Mode = {
  id: 'roleplay',
  label: 'Roleplay',
  icon: '🎭',
  blurb: 'Collaborative fiction with dice, world state, stats, and inventory.',

  systemPrompt: (ctx) => buildRoleplayPrompt(ctx),
  turnReminder: roleplayTurnReminder,

  tools: [],
  allowedTools: GM_TOOL_NAMES,
  mcpServers: (ctx) => ({
    gm: createGmServer(ctx.conversationId, (e: GmEvent) => ctx.emitGmEvent?.(e)),
  }),
  permissionMode: 'default',
  settingSources: [],
  maxTurns: 40,

  ui: {
    composer: 'roleplay',
    showThinking: false,
    showToolCalls: true,
    sidebar: 'characters',
    placeholder: 'What do you do?',
  },
};
