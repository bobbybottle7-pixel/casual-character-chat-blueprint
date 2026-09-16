/**
 * Joins labelled prompt sections, dropping any that are empty.
 *
 * Every mode builds its system prompt through this so the block order is
 * visible in one place per mode instead of being buried in string concatenation.
 */
export function sections(...parts: Array<string | null | undefined | false>): string {
  return parts
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .map((p) => p.trim())
    .join('\n\n');
}

/** A `--- LABEL ---` delimited block, or nothing when the body is empty. */
export function block(label: string, body: string | null | undefined): string | null {
  if (!body || !body.trim()) return null;
  return `--- ${label.toUpperCase()} ---\n${body.trim()}`;
}

/** Bullet list from non-empty lines. */
export function bullets(items: Array<string | null | undefined | false>): string {
  return items
    .filter((i): i is string => typeof i === 'string' && i.trim().length > 0)
    .map((i) => `- ${i.trim()}`)
    .join('\n');
}
