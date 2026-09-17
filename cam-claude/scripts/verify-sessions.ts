/**
 * Session-lifecycle regression tests. Run with `npm run verify`.
 *
 * These go over real HTTP against the real routes, but never send a message, so
 * nothing here calls Claude and the whole file is free to run.
 *
 * The bug these exist to prevent: the SDK snapshots a session's system prompt on
 * its first request and reuses that snapshot across `resume`. So a route that
 * changes a prompt input and only drops the runner leaves the *old* prompt in
 * place — the change looks applied and does nothing. Every prompt input needs
 * `invalidatePrompt`, which clears `sdk_session_id`, and only a title change
 * may leave the session intact.
 */

import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app.js';
import { db } from '../server/store/db.js';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const server = createApp().listen(0, '127.0.0.1');
await new Promise<void>((resolve) => server.once('listening', () => resolve()));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const api = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${base}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return res.status === 204 ? null : ((await res.json()) as Record<string, unknown>);
};

/** Stands in for a session the SDK has already started and snapshotted. */
async function conversationWithLiveSession(modeId = 'general') {
  const conv = (await api('POST', '/api/conversations', { modeId })) as { id: string };
  db.prepare(`UPDATE conversations SET sdk_session_id = ? WHERE id = ?`).run('sess-fixture', conv.id);
  // A turn of history, so the handoff recap has something to carry.
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, text, aborted, created_at)
     VALUES (?, ?, 'user', 'remember the passphrase is orrery', 0, ?)`,
  ).run(`msg-${Math.random().toString(36).slice(2)}`, conv.id, Date.now());
  return conv.id;
}

const sessionId = (id: string) =>
  (db.prepare(`SELECT sdk_session_id AS s FROM conversations WHERE id = ?`).get(id) as { s: string | null })
    .s;

console.log('\nCam Claude — session lifecycle\n');

/* Each of these changes something the system prompt is built from, so each must
 * force a new SDK session. */
for (const [label, method, path, body] of [
  ['adding a memory', 'POST', '/memories', { text: 'The cat is called Quibble.' }],
  ['changing the persona', 'PATCH', '', { personaId: 'persona-x' }],
  ['changing the characters', 'PATCH', '', { characterIds: [] }],
  ['changing the folder', 'PATCH', '', { cwd: '/tmp/elsewhere' }],
  ['switching mode', 'PATCH', '', { modeId: 'brainstorm' }],
] as const) {
  const id = await conversationWithLiveSession();
  await api(method, `/api/conversations/${id}${path}`, body);
  check(`${label} starts a new session`, sessionId(id) === null, `sdk_session_id is still ${sessionId(id)}`);
}

/* The title is the one field the prompt is not built from. Discarding a live
 * session to rename a chat would throw away context for nothing. */
{
  const id = await conversationWithLiveSession();
  await api('PATCH', `/api/conversations/${id}`, { title: 'Renamed' });
  check('renaming keeps the session', sessionId(id) === 'sess-fixture');
}

/* A no-op PATCH must not be treated as a change. */
{
  const id = await conversationWithLiveSession('general');
  await api('PATCH', `/api/conversations/${id}`, { modeId: 'general' });
  check('re-selecting the same mode keeps the session', sessionId(id) === 'sess-fixture');
}

/* Continuity: the replacement session must be told what came before, or every
 * prompt change would read as amnesia to the user. */
{
  const { invalidatePrompt, pendingHandoff } = await import('../server/agent/manager.js');
  const id = await conversationWithLiveSession();
  invalidatePrompt(id, 'a new memory was added');
  const handoff = pendingHandoff(id) ?? '';

  check(
    'the recap carries the earlier exchange',
    handoff.includes('orrery'),
    `recap was ${JSON.stringify(handoff.slice(0, 80))}`,
  );
  check(
    'the recap says why the session restarted',
    handoff.includes('a new memory was added'),
    `recap was ${JSON.stringify(handoff.slice(0, 80))}`,
  );
}

/* A conversation with nothing to recap must not fabricate one. */
{
  const { invalidatePrompt, pendingHandoff } = await import('../server/agent/manager.js');
  const conv = (await api('POST', '/api/conversations', { modeId: 'general' })) as { id: string };
  invalidatePrompt(conv.id, 'its setup was changed');
  check('an empty conversation gets no recap', pendingHandoff(conv.id) === undefined);
}

server.close();

if (failures) {
  console.error(`\n${failures} check${failures === 1 ? '' : 's'} failed.\n`);
  process.exit(1);
}
console.log('\nSession lifecycle verified.\n');
