import type { Mode } from './types.js';
import { sections, bullets } from './prompt-utils.js';

/**
 * The one mode built on the `claude_code` preset — it is the case the preset was
 * written for, and the only mode that loads project settings and CLAUDE.md.
 * Permission prompts surface in the browser through the runner's canUseTool.
 */
export const codeMode: Mode = {
  id: 'code',
  label: 'Code & Project',
  icon: '⌨️',
  blurb: 'Point it at a folder. Reads, edits, runs commands, uses git.',

  systemPrompt: (ctx) => ({
    type: 'preset',
    preset: 'claude_code',
    append: sections(
      'You are running inside Cam Claude, a local chat app, rather than a terminal.',
      bullets([
        'Output is rendered as markdown in a chat window, so code fences and headings display properly.',
        'File edits surface to the user as diffs, so you do not need to re-print what you changed.',
        'The user is present and can approve or deny each tool call — ask when a call is genuinely ambiguous, not as a reflex.',
      ]),
      ctx.cwd ? `Working directory for this conversation: ${ctx.cwd}` : null,
    ),
  }),

  // The full Claude Code tool set.
  tools: { type: 'preset', preset: 'claude_code' },
  // Reads are pre-approved; writes and commands route through canUseTool so the
  // browser shows an approve/deny card.
  allowedTools: ['Read', 'Glob', 'Grep', 'TodoWrite', 'Task'],
  permissionMode: 'default',
  needsApproval: true,
  // The only mode that opts back into project settings and CLAUDE.md.
  settingSources: ['project'],
  maxTurns: 200,
  cwd: (ctx) => ctx.cwd,

  ui: {
    composer: 'code',
    showThinking: true,
    showToolCalls: true,
    sidebar: 'files',
    placeholder: 'What should I change?',
  },
};
