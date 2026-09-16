import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const dbPath =
  process.env.CAM_CLAUDE_DB?.trim() || join(here, '..', '..', 'data', 'cam-claude.db');

mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);

// `characters` is referenced by conversation_characters but declared after it,
// so foreign keys go on only once the whole schema is applied.
db.pragma('foreign_keys = OFF');
db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));
db.pragma('foreign_keys = ON');

export function now(): number {
  return Date.now();
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
