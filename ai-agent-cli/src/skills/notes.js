// A tiny scratchpad the agent can use to carry facts between steps and
// turns within one session (backed by session.notes in memory.js).

function parseIntent(input) {
  const remember = input.match(/\bremember\b(?:\s+that)?\s+([^:=]+?)\s*(?:[:=]|is)\s*(.+)/i);
  if (remember) return { action: "remember", key: remember[1].trim(), value: remember[2].trim() };

  const recall = input.match(/\b(?:recall|what(?:'s| is))\b\s+(?:the\s+)?(.+?)\??\s*$/i);
  if (recall) return { action: "recall", key: recall[1].trim() };

  return { action: "list" };
}

const skill = {
  name: "notes",
  description: "Remembers and recalls short facts within the current session.",
  match(task) {
    return /\b(remember|recall|note)\b/i.test(task);
  },
  needsConfirmation: false,
  async run(input, ctx) {
    const notes = ctx?.session?.notes || {};
    const intent = parseIntent(input);

    if (intent.action === "remember") {
      notes[intent.key.toLowerCase()] = intent.value;
      if (ctx?.session) ctx.session.notes = notes;
      return { ok: true, output: `Noted: ${intent.key} = ${intent.value}` };
    }

    if (intent.action === "recall") {
      const value = notes[intent.key.toLowerCase()];
      return value
        ? { ok: true, output: `${intent.key}: ${value}` }
        : { ok: false, output: `Nothing remembered under "${intent.key}" yet.` };
    }

    const keys = Object.keys(notes);
    return { ok: true, output: keys.length ? keys.map((k) => `${k} = ${notes[k]}`).join("; ") : "No notes yet." };
  },
};

export default skill;
