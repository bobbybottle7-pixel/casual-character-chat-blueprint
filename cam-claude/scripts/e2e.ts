/**
 * End-to-end scenarios. These DO call Claude, so they cost tokens and are not
 * part of `npm run verify`.
 *
 *   npm run e2e                  run every scenario
 *   npm run e2e prompt-refresh   run one
 *
 * Each scenario states what it proves, because a behavioural test that nobody
 * can interpret later is worse than no test. Scenarios avoid questions the mode
 * is designed to deflect — asking a roleplay character an out-of-character
 * question proves nothing, since staying in character is the correct answer.
 */

import { CamClient } from './lib/client.js';
import { deleteConversation, upsertCharacter } from '../server/store/repo.js';
import { newId } from '../server/store/db.js';

const client = new CamClient();
const created: string[] = [];

let failures = 0;
const assert = (label: string, ok: boolean, detail = '') => {
  if (ok) console.log(`    ✓ ${label}`);
  else {
    failures += 1;
    console.error(`    ✗ ${label}${detail ? `\n      ${detail}` : ''}`);
  }
};

async function conversation(modeId: string, extra: Record<string, unknown> = {}) {
  const id = await client.newConversation(modeId, extra);
  created.push(id);
  return id;
}

/** Two characters that could not be mistaken for one another. */
function fixtures() {
  const mira = upsertCharacter({
    id: newId('char'),
    name: 'Mira Vance',
    chatName: 'Mira',
    description: 'A terse locksmith picking a lock in an alley at midnight. Hates small talk.',
    scenario: 'Mira is picking a lock she should not be picking, in an alley, past midnight.',
  });
  const calloway = upsertCharacter({
    id: newId('char'),
    name: 'Brother Calloway',
    chatName: 'Calloway',
    description:
      'An elderly, garrulous monk tending beehives in a sunlit monastery garden at noon. Cannot stop talking about bees.',
    scenario: 'Calloway is tending his hives in the monastery garden at noon.',
  });
  return { mira, calloway };
}

const scenarios: Record<string, { proves: string; run: () => Promise<void> }> = {
  'mode-isolation': {
    proves: 'a mode without file tools cannot read files, whatever it is asked',
    run: async () => {
      const id = await conversation('general');
      const turn = await client.send(id, 'Read package.json and tell me the "name" field.');
      assert('no file tool was called', turn.toolCalls.length === 0, `called ${JSON.stringify(turn.toolCalls)}`);
      assert(
        'it says it cannot, instead of inventing an answer',
        /can'?t|cannot|don'?t have|no (file|tool)/i.test(turn.text),
        turn.text.slice(0, 160),
      );
    },
  },

  'prompt-refresh': {
    proves:
      'changing a prompt input mid-conversation reaches the model — the Stage 1 fix. ' +
      'The cast is swapped for a character who could not be confused with the first.',
    run: async () => {
      const { mira, calloway } = fixtures();
      const id = await conversation('roleplay', { characterIds: [mira.id] });

      const first = await client.send(id, 'I lean against the wall and watch.', { replyKind: 'narrator' });
      assert('the first turn features the original character', /mira/i.test(first.text), first.text.slice(0, 140));

      await client.api('PATCH', `/api/conversations/${id}`, { characterIds: [calloway.id] });

      // Deterministic half: the rebuilt prompt must carry the new cast and drop
      // the old one. Asserted on the prompt rather than the reply, because the
      // reply is generated text and will vary.
      const { buildContext } = await import('../server/agent/manager.js');
      const cast = buildContext(id).characters?.map((c) => c.name) ?? [];
      assert('the rebuilt cast is the new character', cast.join() === 'Brother Calloway', `cast: ${cast.join(', ')}`);

      // Behavioural half: the model must actually use it.
      const second = await client.send(id, 'Describe who is here and what they are doing.', {
        replyKind: 'narrator',
      });
      assert('the model plays the new character', /calloway|bee|monast|hive/i.test(second.text), second.text.slice(0, 200));

      // Deliberately NOT asserted: that the old character is never mentioned.
      // The GM tools record world state as play proceeds, so after turn 1 the
      // stored scene still says "Present: Mira Vance". Swapping the cast does
      // not reconcile that, so the old name can legitimately resurface through
      // the WORLD STATE block. That is a known gap, tracked separately — it is
      // not a prompt-refresh failure, and asserting on it here made this
      // scenario pass or fail at random.
    },
  },

  'gm-dice': {
    proves: 'roleplay rolls real dice through the tool rather than narrating a number',
    run: async () => {
      const { mira } = fixtures();
      const id = await conversation('roleplay', { characterIds: [mira.id] });
      const turn = await client.send(id, 'Roll to see whether Mira picks the lock.', { replyKind: 'dialog' });
      const rolls = turn.gmEvents.filter((e) => (e as { kind?: string }).kind === 'roll');
      assert('the dice tool actually ran', rolls.length > 0, `gm events: ${JSON.stringify(turn.gmEvents)}`);
      const data = (rolls[0] as { data?: { total?: number; rolls?: number[] } })?.data;
      assert(
        'the result is a real number from real dice',
        typeof data?.total === 'number' && Array.isArray(data.rolls) && data.rolls.length > 0,
        JSON.stringify(data),
      );
    },
  },

  websearch: {
    proves: 'web search mode searches and cites, rather than answering from memory',
    run: async () => {
      const id = await conversation('websearch');
      const turn = await client.send(id, 'What is the current stable version of Node.js? Cite your source.');
      assert(
        'a search tool ran',
        turn.toolCalls.some((t) => /WebSearch|WebFetch/.test(t.name)),
        JSON.stringify(turn.toolCalls.map((t) => t.name)),
      );
      assert('the answer carries a link', /https?:\/\//.test(turn.text), turn.text.slice(0, 160));
    },
  },
};

const wanted = process.argv[2];
const names = wanted ? [wanted] : Object.keys(scenarios);
if (wanted && !scenarios[wanted]) {
  console.error(`Unknown scenario "${wanted}". Available: ${Object.keys(scenarios).join(', ')}`);
  process.exit(1);
}

console.log('\nCam Claude — end-to-end scenarios\n');
await client.waitUntilReady().catch(() => {
  console.error('  The server is not running. Start it with `npm run dev:start`.\n');
  process.exit(1);
});

for (const name of names) {
  const scenario = scenarios[name]!;
  console.log(`  ${name}`);
  console.log(`    proves: ${scenario.proves}`);
  const started = Date.now();
  try {
    await scenario.run();
  } catch (error) {
    failures += 1;
    console.error(`    ✗ threw: ${error instanceof Error ? error.message : String(error)}`);
  }
  console.log(`    (${Math.round((Date.now() - started) / 1000)}s)\n`);
}

for (const id of created) deleteConversation(id);

if (failures) {
  console.error(`${failures} assertion${failures === 1 ? '' : 's'} failed.\n`);
  process.exit(1);
}
console.log('All scenarios passed.\n');
