import { Router } from 'express';
import { newId } from '../store/db.js';
import {
  deleteCharacter,
  getCharacter,
  listCharacters,
  listPersonas,
  upsertCharacter,
  upsertPersona,
} from '../store/repo.js';
import { cardToCharacter, extractCardFromPng } from '../import/png-card.js';
import { readCccExport } from '../import/ccc-export.js';
import type { Character, Persona } from '../modes/types.js';

export const characterRoutes = Router();

characterRoutes.get('/characters', (_req, res) => {
  res.json(listCharacters());
});

characterRoutes.post('/characters', (req, res) => {
  const body = req.body as Partial<Character>;
  if (!body?.name?.trim()) {
    res.status(400).json({ error: 'A character needs a name.' });
    return;
  }
  const character: Character = { ...body, id: body.id || newId('char'), name: body.name.trim() };
  res.status(201).json(upsertCharacter(character));
});

characterRoutes.get('/characters/:id', (req, res) => {
  const character = getCharacter(req.params.id);
  if (!character) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(character);
});

characterRoutes.delete('/characters/:id', (req, res) => {
  deleteCharacter(req.params.id);
  res.status(204).end();
});

characterRoutes.get('/personas', (_req, res) => {
  res.json(listPersonas());
});

characterRoutes.post('/personas', (req, res) => {
  const body = req.body as Partial<Persona>;
  if (!body?.name?.trim()) {
    res.status(400).json({ error: 'A persona needs a name.' });
    return;
  }
  const persona: Persona = { ...body, id: body.id || newId('persona'), name: body.name.trim() };
  res.status(201).json(upsertPersona(persona));
});

/**
 * Accepts a V2/V3 character card PNG, a bare card JSON, or a Casual Character
 * Chat `{version:3,...}` export. The client sends base64 so a single JSON
 * endpoint covers all three rather than needing multipart upload handling.
 */
characterRoutes.post('/import', (req, res) => {
  const { filename, base64, json } = req.body ?? {};

  try {
    if (typeof base64 === 'string' && base64) {
      const buffer = Buffer.from(base64, 'base64');

      if (filename?.toLowerCase().endsWith('.png')) {
        const card = extractCardFromPng(buffer);
        if (!card) {
          res.status(400).json({ error: 'That PNG has no embedded character card.' });
          return;
        }
        const dataUrl = `data:image/png;base64,${base64}`;
        const character = upsertCharacter(cardToCharacter(card, dataUrl));
        res.status(201).json({ characters: [character], personas: [] });
        return;
      }

      const parsed: unknown = JSON.parse(buffer.toString('utf8'));
      res.status(201).json(importJson(parsed));
      return;
    }

    if (json !== undefined) {
      res.status(201).json(importJson(json));
      return;
    }

    res.status(400).json({ error: 'Send either a base64 file or a json body.' });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

function importJson(parsed: unknown): { characters: Character[]; personas: Persona[] } {
  const root = parsed as { characters?: unknown; personas?: unknown };

  // A Casual Character Chat export keys characters by id; a bare card does not.
  if (root && typeof root === 'object' && (root.characters || root.personas)) {
    const result = readCccExport(parsed);
    return {
      characters: result.characters.map(upsertCharacter),
      personas: result.personas.map(upsertPersona),
    };
  }

  return { characters: [upsertCharacter(cardToCharacter(parsed))], personas: [] };
}
