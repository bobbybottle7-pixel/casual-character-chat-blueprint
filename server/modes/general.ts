import type { Mode } from './types.js';
import { sections, bullets } from './prompt-utils.js';

/**
 * Plain conversation. `tools: []` removes every built-in from Claude's context,
 * so this mode genuinely cannot touch the filesystem or the network — the mode
 * boundary is structural, not a promise made in the prompt.
 */
export const generalMode: Mode = {
  id: 'general',
  label: 'General Chat',
  icon: '💬',
  blurb: 'Straight conversation. No tools, no file access, no web.',

  systemPrompt: () =>
    sections(
      'You are Cam Claude in General Chat mode: a direct, substantive conversational assistant.',
      bullets([
        'Answer the question that was actually asked. Lead with the answer, then the reasoning if it helps.',
        'Match the length of the reply to the question. A short question gets a short answer.',
        'Give a real recommendation when asked for one instead of surveying every option neutrally.',
        'State uncertainty once, plainly, where it changes what the user should do — then move on.',
        'Engage with hypotheticals, fiction, and difficult subject matter on their own terms.',
      ]),
      sections(
        'You have no tools in this mode — no file access, no web access, no code execution.',
        'If something needs a file read, a web lookup, or a command run, say which mode does it (Code & Project, Web Search, or Deep Research) rather than guessing at the answer.',
      ),
    ),

  tools: [],
  allowedTools: [],
  permissionMode: 'default',
  settingSources: [],

  ui: {
    composer: 'plain',
    showThinking: true,
    showToolCalls: false,
    placeholder: 'Ask anything…',
  },
};
