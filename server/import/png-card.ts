import { newId } from '../store/db.js';
import type { Character, LoreEntry } from '../modes/types.js';

/**
 * Character card importers, ported from the Casual Character Chat app
 * (`casual-character-chat-app/script.js`: extractDataFromPng around line 1027,
 * convertExternalCardToCCC around line 1117) and rewritten for Node Buffers and
 * this app's Character shape.
 */

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Pulls the `chara` tEXt chunk out of a V2/V3 character card PNG. */
export function extractCardFromPng(buffer: Buffer): unknown | null {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;

  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);

    if (type === 'tEXt') {
      const chunk = buffer.toString('utf8', offset + 8, offset + 8 + length);
      if (chunk.startsWith('chara\0')) {
        const payload = chunk.slice(6);
        // Cards store the JSON either raw or base64-encoded; try both.
        try {
          return JSON.parse(payload);
        } catch {
          try {
            return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
          } catch {
            return null;
          }
        }
      }
    }

    offset += 12 + length;
  }
  return null;
}

type CardData = Record<string, unknown>;

function txt(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Card lorebooks arrive in several shapes: a V3 `character_book` object with an
 * entries array, a bare string, or one of the older flat fields.
 */
function extractLorebook(data: CardData): { flat: string[]; entries: LoreEntry[] } {
  const flat: string[] = [];
  const entries: LoreEntry[] = [];
  const push = (v: unknown) => {
    const t = txt(v);
    if (t) flat.push(t);
  };

  const book = (data.character_book ?? data.embedded_lorebook ?? null) as
    | { entries?: unknown[] }
    | unknown[]
    | string
    | null;

  if (typeof book === 'string') push(book);

  const list = Array.isArray(book)
    ? book
    : book && typeof book === 'object' && Array.isArray(book.entries)
      ? book.entries
      : null;

  if (list) {
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue;
      const e = raw as CardData;
      const rawKeys = e.keys ?? e.key ?? e.keyword ?? '';
      const keys = (Array.isArray(rawKeys) ? rawKeys : String(rawKeys).split(','))
        .map((k) => String(k).trim())
        .filter(Boolean);
      const content = txt(e.content ?? e.value ?? e.entry);
      if (!content) continue;

      entries.push({ keys, content, ...(keys.length ? {} : { constant: true }) });
      flat.push([keys.length ? `[${keys.join(', ')}]` : '', content].filter(Boolean).join('\n'));
    }
  }

  push(data.lorebook);
  push(data.lore);
  push(data.world_scenario);

  return { flat, entries };
}

/** Converts a V2/V3 character card object into this app's Character shape. */
export function cardToCharacter(card: unknown, avatarDataUrl?: string): Character {
  const data = ((card as CardData)?.data ?? card ?? {}) as CardData;

  const tagline = txt(data.card_description ?? data.tagline);
  const personality = txt(data.personality ?? data.tavern_personality);
  const description = txt(data.description);
  const examples = txt(data.mes_example ?? data.example_dialogs);

  // Creator notes are deliberately left behind: they are a message from the
  // card's author to whoever downloads it, not anything the character is.
  const descriptionParts = [
    tagline,
    [personality, description].filter(Boolean).join('\n\n'),
    examples ? `Example exchanges:\n${examples}` : '',
  ].filter(Boolean);

  const book = extractLorebook(data);

  // Always-on lore is prepended to every prompt, which is fine for a few
  // paragraphs and ruinous for a real lorebook — cards routinely carry 150+
  // entries. When most entries came with trigger keywords, that is the author
  // saying "inject these on demand", so keep those keyed and leave `lore` empty.
  const keyed = book.entries.filter((e) => e.keys.length).length;
  const useKeywords = book.entries.length > 0 && keyed >= book.entries.length / 2;
  const flatLore = useKeywords
    ? ''
    : book.flat.filter((p) => p && p !== tagline).join('\n\n').trim();

  const scenario = [txt(data.scenario), txt(data.first_mes)].filter(Boolean).join('\n\n').trim();

  // V2 cards conventionally write the literal string "none" when they carry no
  // picture, which would otherwise be handed to an <img> as a src.
  const cardAvatar = /^(data:|https?:|blob:)/i.test(txt(data.avatar)) ? txt(data.avatar) : '';

  const character: Character = {
    id: newId('char'),
    name: txt(data.name) || 'Unnamed import',
  };

  const chatName = txt(data.nickname);
  const instructions = txt(data.system_prompt);
  const greeting = txt(data.first_mes);
  const avatar = avatarDataUrl || cardAvatar;

  if (chatName) character.chatName = chatName;
  if (descriptionParts.length) character.description = descriptionParts.join('\n\n');
  if (instructions) character.instructions = instructions;
  if (flatLore) character.lore = flatLore;
  if (book.entries.length) character.loreEntries = book.entries;
  if (avatar) character.avatar = avatar;
  if (greeting) character.greeting = greeting;
  if (scenario) character.scenario = scenario;

  return character;
}
