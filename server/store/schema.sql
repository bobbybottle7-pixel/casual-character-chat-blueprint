PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS conversations (
  id             TEXT PRIMARY KEY,
  mode_id        TEXT NOT NULL,
  title          TEXT NOT NULL DEFAULT 'New conversation',
  sdk_session_id TEXT,
  cwd            TEXT,
  persona_id     TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,          -- 'user' | 'assistant' | 'system'
  text            TEXT NOT NULL DEFAULT '',
  thinking        TEXT,
  tool_calls      TEXT,                   -- JSON array
  reply_kind      TEXT,                   -- roleplay: 'dialog' | 'narrator'
  aborted         INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON messages(conversation_id, created_at);

-- Conversation participants (roleplay). A conversation can stage several cards.
CREATE TABLE IF NOT EXISTS conversation_characters (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  character_id    TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  PRIMARY KEY (conversation_id, character_id)
);

CREATE TABLE IF NOT EXISTS characters (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  data       TEXT NOT NULL,               -- JSON Character
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS personas (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  data       TEXT NOT NULL,               -- JSON Persona
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS world_state (
  conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  state           TEXT NOT NULL DEFAULT '{}',
  stats           TEXT NOT NULL DEFAULT '{}',
  inventory       TEXT NOT NULL DEFAULT '{}',
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,          -- 'pinned' | 'auto'
  text            TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_conversation
  ON memories(conversation_id, created_at);

-- Rolled dice and scene changes, so the UI can render them as cards and the
-- history survives a restart.
CREATE TABLE IF NOT EXISTS gm_events (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,          -- 'roll' | 'scene' | 'stat' | 'inventory'
  data            TEXT NOT NULL,          -- JSON
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gm_events_conversation
  ON gm_events(conversation_id, created_at);
