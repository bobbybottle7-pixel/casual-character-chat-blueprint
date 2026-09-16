import { newId } from '../store/db.js';
import type { Character, LoreEntry, Persona } from '../modes/types.js';

/**
 * Reader for the Casual Character Chat app's JSON export
 * (`{ version: 3, characters: {...}, personas: {...} }`).
 *
 * Only the fields Cam Claude uses are carried across — chat transcripts, model
 * presets, and gallery images are left behind on purpose.
 */

interface CccCharacter {
  name?: string;
  chatName?: string;
  avatar?: string;
  description?: string;
  instructions?: string;
  lore?: string;
  loreEntries?: Array<{ keywords?: string; text?: string }>;
  scenarios?: Array<{ name?: string; greeting?: string }>;
}

interface CccPersona {
  name?: string;
  chatName?: string;
  description?: string;
  avatar?: string;
}

export interface CccImportResult {
  characters: Character[];
  personas: Persona[];
}

function convertLoreEntries(entries: CccCharacter['loreEntries']): LoreEntry[] {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((e) => {
      const keys = String(e?.keywords ?? '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
      const content = String(e?.text ?? '').trim();
      if (!content) return null;
      const entry: LoreEntry = { keys, content };
      if (!keys.length) entry.constant = true;
      return entry;
    })
    .filter((e): e is LoreEntry => e !== null);
}

export function readCccExport(raw: unknown): CccImportResult {
  const root = (raw ?? {}) as { characters?: Record<string, CccCharacter>; personas?: Record<string, CccPersona> };
  const characters: Character[] = [];
  const personas: Persona[] = [];

  for (const source of Object.values(root.characters ?? {})) {
    if (!source?.name) continue;
    const character: Character = { id: newId('char'), name: source.name.trim() };

    const loreEntries = convertLoreEntries(source.loreEntries);
    const greeting = source.scenarios?.find((s) => s?.greeting)?.greeting?.trim();

    if (source.chatName?.trim()) character.chatName = source.chatName.trim();
    if (source.description?.trim()) character.description = source.description.trim();
    if (source.instructions?.trim()) character.instructions = source.instructions.trim();
    if (source.lore?.trim()) character.lore = source.lore.trim();
    if (loreEntries.length) character.loreEntries = loreEntries;
    if (source.avatar?.trim()) character.avatar = source.avatar.trim();
    if (greeting) {
      character.greeting = greeting;
      character.scenario = greeting;
    }

    characters.push(character);
  }

  for (const source of Object.values(root.personas ?? {})) {
    if (!source?.name) continue;
    const persona: Persona = { id: newId('persona'), name: source.name.trim() };
    if (source.description?.trim()) persona.description = source.description.trim();
    if (source.avatar?.trim()) persona.avatar = source.avatar.trim();
    personas.push(persona);
  }

  return { characters, personas };
}
