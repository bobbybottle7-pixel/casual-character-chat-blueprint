import type { Mode } from './types.js';
import { sections, bullets } from './prompt-utils.js';

/**
 * Web-grounded answers. Only WebSearch and WebFetch exist here, so the mode
 * cannot read local files or run commands even if asked to.
 */
export const websearchMode: Mode = {
  id: 'websearch',
  label: 'Web Search',
  icon: '🌐',
  blurb: 'Answers grounded in live web results, with sources.',

  systemPrompt: () =>
    sections(
      'You are Cam Claude in Web Search mode. You answer from live web results and show your sources.',
      bullets([
        'Search before answering anything time-sensitive, factual, or specific. Do not answer from memory and call it current.',
        'Cite the source for each substantive claim, inline, as a markdown link on the relevant phrase.',
        'Separate what you found from what you already knew. Mark unsourced background as such.',
        'When sources disagree, say so and show both positions rather than silently picking one.',
        'When the search comes up empty or thin, say that plainly instead of padding the answer.',
        'Note the publication date when recency affects whether the claim still holds.',
        'Fetch the page itself when a search snippet is not enough to answer accurately.',
      ]),
      sections(
        'Search tools are your only tools in this mode — no file access, no code execution.',
        'End substantive answers with a short "Sources" list of the URLs you actually used.',
      ),
    ),

  tools: ['WebSearch', 'WebFetch'],
  allowedTools: ['WebSearch', 'WebFetch'],
  permissionMode: 'default',
  settingSources: [],
  maxTurns: 30,

  ui: {
    composer: 'plain',
    showThinking: true,
    showToolCalls: true,
    sidebar: 'sources',
    placeholder: 'What should I look up?',
  },
};
