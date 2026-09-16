import type { CanUseTool, Options } from '@anthropic-ai/claude-agent-sdk';
import type { Mode, ModeContext } from '../modes/types.js';

export const DEFAULT_MODEL = process.env.CAM_CLAUDE_MODEL?.trim() || 'opus';

/**
 * Turns a Mode plus its per-conversation context into SDK options.
 *
 * This is the single place a mode's declared boundary becomes real, which is
 * why `scripts/verify-modes.ts` asserts against the output of this function
 * rather than against the mode definitions.
 */
export function modeToOptions(
  mode: Mode,
  ctx: ModeContext,
  extra: { canUseTool?: CanUseTool; resume?: string; abortController?: AbortController } = {},
): Options {
  const options: Options = {
    systemPrompt: mode.systemPrompt(ctx),
    allowedTools: mode.allowedTools,
    permissionMode: mode.permissionMode,
    // Empty for every mode but Code: your personal CLAUDE.md and Claude Code
    // settings should not leak into a roleplay session.
    settingSources: mode.settingSources,
    model: ctx.model || mode.model || DEFAULT_MODEL,
    includePartialMessages: true,
    persistSession: true,
  };

  if (mode.tools !== undefined) options.tools = mode.tools;
  if (mode.disallowedTools) options.disallowedTools = mode.disallowedTools;
  if (mode.maxTurns !== undefined) options.maxTurns = mode.maxTurns;
  if (mode.mcpServers) options.mcpServers = mode.mcpServers(ctx);

  const cwd = mode.cwd?.(ctx);
  if (cwd) options.cwd = cwd;

  if (extra.canUseTool) options.canUseTool = extra.canUseTool;
  if (extra.resume) options.resume = extra.resume;
  if (extra.abortController) options.abortController = extra.abortController;

  return options;
}
