/**
 * Show what a conversation would actually send to Claude.
 *
 * The system prompt is assembled from several sources and then frozen for the
 * life of a session, which makes "why didn't it know that?" hard to answer by
 * looking at the app. This prints the exact text, so a prompt problem can be
 * told apart from a lifecycle problem without spending a single token.
 *
 *   npm run inspect                 list conversations
 *   npm run inspect <id>            show the assembled prompt
 *   npm run inspect <id> --grep foo report whether the prompt contains "foo"
 */

import { buildContext } from '../server/agent/manager.js';
import { requireMode } from '../server/modes/index.js';
import { getConversation, listConversations, listMessages } from '../server/store/repo.js';

const [, , id, ...rest] = process.argv;

if (!id) {
  const rows = listConversations();
  if (!rows.length) {
    console.log('\nNo conversations yet.\n');
    process.exit(0);
  }
  console.log('\n  id                       mode        session      title');
  for (const c of rows.slice(0, 25)) {
    console.log(
      `  ${c.id.padEnd(24)} ${c.mode_id.padEnd(11)} ${(c.sdk_session_id ? 'live' : 'none').padEnd(12)} ${c.title.slice(0, 40)}`,
    );
  }
  console.log('');
  process.exit(0);
}

const conv = getConversation(id);
if (!conv) {
  console.error(`No conversation ${id}. Run without arguments to list them.`);
  process.exit(1);
}

const mode = requireMode(conv.mode_id);
const ctx = buildContext(conv.id);
const spec = mode.systemPrompt(ctx);
const prompt = typeof spec === 'string' ? spec : JSON.stringify(spec, null, 2);
const reminder = mode.turnReminder?.(ctx) ?? null;

const grepIndex = rest.indexOf('--grep');
if (grepIndex !== -1) {
  const needle = rest[grepIndex + 1];
  if (!needle) {
    console.error('--grep needs something to look for.');
    process.exit(1);
  }
  const hit = prompt.toLowerCase().includes(needle.toLowerCase());
  console.log(`\n  "${needle}" ${hit ? 'IS' : 'is NOT'} in the assembled prompt.\n`);
  process.exit(hit ? 0 : 1);
}

console.log(`
  conversation : ${conv.id}
  mode         : ${mode.label} (${mode.id})
  sdk session  : ${conv.sdk_session_id ?? 'none — next turn starts a new one'}
  messages     : ${listMessages(conv.id).length}

  context loaded:
    characters : ${ctx.characters?.map((c) => c.name).join(', ') || '(none)'}
    persona    : ${ctx.persona?.name ?? '(none)'}
    memories   : ${ctx.memories?.length ?? 0}
    world keys : ${Object.keys(ctx.world ?? {}).join(', ') || '(none)'}
    cwd        : ${ctx.cwd ?? '(none)'}

  tools available : ${Array.isArray(mode.tools) ? mode.tools.join(', ') || '(none)' : 'claude_code preset'}
  turn reminder   : ${reminder ?? '(none)'}

${'─'.repeat(72)}
${prompt}
${'─'.repeat(72)}
  ${prompt.length} characters
`);
