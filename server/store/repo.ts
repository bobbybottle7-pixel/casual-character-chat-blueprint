import { db, newId, now } from './db.js';
import type {
  Character,
  InventoryBlock,
  Memory,
  ModeId,
  Persona,
  ReplyKind,
  StatBlock,
  WorldState,
} from '../modes/types.js';

export interface ConversationRow {
  id: string;
  mode_id: ModeId;
  title: string;
  sdk_session_id: string | null;
  cwd: string | null;
  persona_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  thinking: string | null;
  tool_calls: string | null;
  reply_kind: ReplyKind | null;
  aborted: number;
  created_at: number;
}

export interface GmEvent {
  id: string;
  conversation_id: string;
  kind: 'roll' | 'scene' | 'stat' | 'inventory';
  data: unknown;
  created_at: number;
}

/* ------------------------------- conversations ------------------------------ */

export function createConversation(modeId: ModeId, opts: { title?: string; cwd?: string } = {}) {
  const id = newId('conv');
  const ts = now();
  db.prepare(
    `INSERT INTO conversations (id, mode_id, title, cwd, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, modeId, opts.title ?? 'New conversation', opts.cwd ?? null, ts, ts);
  return getConversation(id)!;
}

export function getConversation(id: string): ConversationRow | undefined {
  return db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(id) as
    | ConversationRow
    | undefined;
}

export function listConversations(): ConversationRow[] {
  return db
    .prepare(`SELECT * FROM conversations ORDER BY updated_at DESC`)
    .all() as ConversationRow[];
}

export function updateConversation(
  id: string,
  patch: Partial<Pick<ConversationRow, 'title' | 'sdk_session_id' | 'cwd' | 'mode_id' | 'persona_id'>>,
) {
  const fields = Object.keys(patch) as Array<keyof typeof patch>;
  if (!fields.length) return;
  const assignments = fields.map((f) => `${f} = ?`).join(', ');
  db.prepare(`UPDATE conversations SET ${assignments}, updated_at = ? WHERE id = ?`).run(
    ...fields.map((f) => patch[f] ?? null),
    now(),
    id,
  );
}

export function touchConversation(id: string) {
  db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(now(), id);
}

export function deleteConversation(id: string) {
  db.prepare(`DELETE FROM conversations WHERE id = ?`).run(id);
}

/* ---------------------------------- messages -------------------------------- */

export function addMessage(m: {
  conversationId: string;
  role: MessageRow['role'];
  text: string;
  thinking?: string | null;
  toolCalls?: unknown[] | null;
  replyKind?: ReplyKind | null;
  aborted?: boolean;
}): MessageRow {
  const id = newId('msg');
  db.prepare(
    `INSERT INTO messages
       (id, conversation_id, role, text, thinking, tool_calls, reply_kind, aborted, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    m.conversationId,
    m.role,
    m.text,
    m.thinking ?? null,
    m.toolCalls ? JSON.stringify(m.toolCalls) : null,
    m.replyKind ?? null,
    m.aborted ? 1 : 0,
    now(),
  );
  touchConversation(m.conversationId);
  return db.prepare(`SELECT * FROM messages WHERE id = ?`).get(id) as MessageRow;
}

export function listMessages(conversationId: string): MessageRow[] {
  return db
    .prepare(`SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid`)
    .all(conversationId) as MessageRow[];
}

/** Text of the last few turns, used to match lorebook keys. */
export function recentText(conversationId: string, turns = 6): string {
  const rows = db
    .prepare(
      `SELECT text FROM messages WHERE conversation_id = ?
       ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(conversationId, turns) as Array<{ text: string }>;
  return rows.map((r) => r.text).join('\n');
}

/* --------------------------------- characters ------------------------------- */

export function upsertCharacter(c: Character): Character {
  const ts = now();
  db.prepare(
    `INSERT INTO characters (id, name, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, data = excluded.data, updated_at = ?`,
  ).run(c.id, c.name, JSON.stringify(c), ts, ts, ts);
  return c;
}

export function listCharacters(): Character[] {
  const rows = db.prepare(`SELECT data FROM characters ORDER BY name`).all() as Array<{
    data: string;
  }>;
  return rows.map((r) => JSON.parse(r.data) as Character);
}

export function getCharacter(id: string): Character | undefined {
  const row = db.prepare(`SELECT data FROM characters WHERE id = ?`).get(id) as
    | { data: string }
    | undefined;
  return row ? (JSON.parse(row.data) as Character) : undefined;
}

export function deleteCharacter(id: string) {
  db.prepare(`DELETE FROM characters WHERE id = ?`).run(id);
}

export function setConversationCharacters(conversationId: string, characterIds: string[]) {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM conversation_characters WHERE conversation_id = ?`).run(conversationId);
    const insert = db.prepare(
      `INSERT OR IGNORE INTO conversation_characters (conversation_id, character_id) VALUES (?, ?)`,
    );
    for (const cid of characterIds) insert.run(conversationId, cid);
  });
  tx();
}

export function getConversationCharacters(conversationId: string): Character[] {
  const rows = db
    .prepare(
      `SELECT c.data FROM conversation_characters cc
       JOIN characters c ON c.id = cc.character_id
       WHERE cc.conversation_id = ?`,
    )
    .all(conversationId) as Array<{ data: string }>;
  return rows.map((r) => JSON.parse(r.data) as Character);
}

/* ---------------------------------- personas -------------------------------- */

export function upsertPersona(p: Persona): Persona {
  const ts = now();
  db.prepare(
    `INSERT INTO personas (id, name, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, data = excluded.data, updated_at = ?`,
  ).run(p.id, p.name, JSON.stringify(p), ts, ts, ts);
  return p;
}

export function listPersonas(): Persona[] {
  const rows = db.prepare(`SELECT data FROM personas ORDER BY name`).all() as Array<{
    data: string;
  }>;
  return rows.map((r) => JSON.parse(r.data) as Persona);
}

export function getPersona(id: string): Persona | undefined {
  const row = db.prepare(`SELECT data FROM personas WHERE id = ?`).get(id) as
    | { data: string }
    | undefined;
  return row ? (JSON.parse(row.data) as Persona) : undefined;
}

/* -------------------------------- world state ------------------------------- */

export interface WorldRow {
  state: WorldState;
  stats: StatBlock;
  inventory: InventoryBlock;
}

export function getWorld(conversationId: string): WorldRow {
  const row = db
    .prepare(`SELECT state, stats, inventory FROM world_state WHERE conversation_id = ?`)
    .get(conversationId) as { state: string; stats: string; inventory: string } | undefined;
  if (!row) return { state: {}, stats: {}, inventory: {} };
  return {
    state: JSON.parse(row.state) as WorldState,
    stats: JSON.parse(row.stats) as StatBlock,
    inventory: JSON.parse(row.inventory) as InventoryBlock,
  };
}

export function saveWorld(conversationId: string, world: WorldRow) {
  db.prepare(
    `INSERT INTO world_state (conversation_id, state, stats, inventory, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(conversation_id) DO UPDATE SET
       state = excluded.state, stats = excluded.stats,
       inventory = excluded.inventory, updated_at = excluded.updated_at`,
  ).run(
    conversationId,
    JSON.stringify(world.state),
    JSON.stringify(world.stats),
    JSON.stringify(world.inventory),
    now(),
  );
}

/* --------------------------------- memories --------------------------------- */

export function addMemory(conversationId: string, kind: Memory['kind'], text: string) {
  db.prepare(
    `INSERT INTO memories (id, conversation_id, kind, text, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(newId('mem'), conversationId, kind, text, now());
}

export function listMemories(conversationId: string): Memory[] {
  const rows = db
    .prepare(`SELECT kind, text FROM memories WHERE conversation_id = ? ORDER BY created_at`)
    .all(conversationId) as Array<{ kind: Memory['kind']; text: string }>;
  return rows;
}

/* -------------------------------- GM events --------------------------------- */

export function addGmEvent(conversationId: string, kind: GmEvent['kind'], data: unknown): GmEvent {
  const id = newId('gm');
  const ts = now();
  db.prepare(
    `INSERT INTO gm_events (id, conversation_id, kind, data, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, conversationId, kind, JSON.stringify(data), ts);
  return { id, conversation_id: conversationId, kind, data, created_at: ts };
}

export function listGmEvents(conversationId: string): GmEvent[] {
  const rows = db
    .prepare(`SELECT * FROM gm_events WHERE conversation_id = ? ORDER BY created_at`)
    .all(conversationId) as Array<Omit<GmEvent, 'data'> & { data: string }>;
  return rows.map((r) => ({ ...r, data: JSON.parse(r.data) as unknown }));
}
