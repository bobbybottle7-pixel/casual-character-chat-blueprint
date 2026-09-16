import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Mode } from './types.js';
import { sections, bullets } from './prompt-utils.js';

/** Where reports land. Overridable so the workspace is not hardcoded to $HOME. */
export const researchRoot =
  process.env.CAM_CLAUDE_RESEARCH_DIR?.trim() || join(homedir(), 'cam-claude-research');

/**
 * Multi-step research. Task subagents let the reading fan out without filling
 * the main thread's context with raw page text.
 */
export const researchMode: Mode = {
  id: 'research',
  label: 'Deep Research',
  icon: '🔬',
  blurb: 'Multi-step research with subagents, ending in a cited report.',

  systemPrompt: (ctx) =>
    sections(
      'You are Cam Claude in Deep Research mode. You run multi-step investigations and produce cited reports.',
      sections(
        'Process:',
        bullets([
          'Start by stating the question as you understand it and the 3-6 sub-questions you will investigate. Keep this to a few lines, then begin — do not wait for approval.',
          'Use the Task tool to farm out sub-questions to subagents in parallel. Each subagent reads sources and returns findings; that keeps raw page text out of this thread.',
          'Follow claims back to primary sources. A secondary article describing a study is not the study.',
          'Actively look for the strongest disagreeing view. A report that found only confirming evidence was not a search, it was a retrieval.',
        ]),
      ),
      sections(
        'The report:',
        bullets([
          `Write the finished report to ${researchRoot}/<slug>.md and also give the user the findings in the conversation.`,
          'Inline markdown links on the specific claim they support. Not a bibliography dump at the end.',
          'Open with what you actually concluded, in a few sentences, before the supporting detail.',
          'Give a confidence read per major finding, grounded in the evidence you found — how many independent sources, how direct, how recent.',
          'Include a section for what you could not establish. An honest gap is a finding.',
          'Where the evidence is genuinely split, present the split rather than averaging it into a non-answer.',
        ]),
      ),
      ctx.cwd ? `Working directory: ${ctx.cwd}` : null,
    ),

  tools: ['WebSearch', 'WebFetch', 'Read', 'Write', 'Glob', 'Grep', 'Task', 'TodoWrite'],
  allowedTools: ['WebSearch', 'WebFetch', 'Read', 'Write', 'Glob', 'Grep', 'Task', 'TodoWrite'],
  permissionMode: 'acceptEdits',
  settingSources: [],
  maxTurns: 120,
  cwd: () => researchRoot,

  ui: {
    composer: 'research',
    showThinking: true,
    showToolCalls: true,
    sidebar: 'sources',
    placeholder: 'What should I investigate?',
  },
};
