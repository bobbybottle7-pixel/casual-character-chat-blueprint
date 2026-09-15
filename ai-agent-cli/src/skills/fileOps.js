import fs from "node:fs";
import path from "node:path";

// All file access is confined to the current working directory the CLI
// was launched from — no absolute paths, no "..' escapes. This is the
// one skill that touches disk, so it gets the strictest guardrails.
function resolveSafe(cwd, target) {
  const resolved = path.resolve(cwd, target);
  const relative = path.relative(cwd, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to access "${target}" — outside the working directory.`);
  }
  return resolved;
}

function parseIntent(input) {
  const listMatch = input.match(/\blist\b.*?(?:files?|directory|dir)\b(?:\s+(?:in|of)\s+([^\s]+))?/i);
  if (listMatch) return { action: "list", target: listMatch[1] || "." };

  const writeMatch = input.match(/\b(?:write|create|save)\b.*?\bto\b\s+([^\s]+)/i);
  if (writeMatch) return { action: "write", target: writeMatch[1] };

  const readMatch = input.match(/\bread\b.*?([^\s]+\.[A-Za-z0-9]+)/i) || input.match(/\bread\b\s+([^\s]+)/i);
  if (readMatch) return { action: "read", target: readMatch[1] };

  return null;
}

const skill = {
  name: "fileOps",
  description: "Reads, lists, or writes files scoped to the current working directory.",
  match(task) {
    return /\b(read|list|write|create|save)\b.*\b(file|files|dir|directory)\b|\.[a-z0-9]{1,5}\b/i.test(task);
  },
  needsConfirmation(input) {
    const intent = parseIntent(input);
    return intent?.action === "write";
  },
  async run(input, ctx) {
    const cwd = ctx?.cwd || process.cwd();
    const intent = parseIntent(input) || { action: "list", target: "." };

    if (intent.action === "list") {
      const dir = resolveSafe(cwd, intent.target);
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const lines = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
      return { ok: true, output: lines.length ? lines.join(", ") : "(empty directory)" };
    }

    if (intent.action === "read") {
      const file = resolveSafe(cwd, intent.target);
      if (!fs.existsSync(file)) return { ok: false, output: `File not found: ${intent.target}` };
      const content = fs.readFileSync(file, "utf8");
      return { ok: true, output: content.length > 2000 ? content.slice(0, 2000) + "\n…(truncated)" : content };
    }

    if (intent.action === "write") {
      const file = resolveSafe(cwd, intent.target);
      // The body to write is anything after the target path, minus filler words.
      const bodyMatch = input.match(/(?:with content|containing|saying)\s+["“]?([\s\S]+?)["”]?$/i);
      const body = bodyMatch ? bodyMatch[1] : "";
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body, "utf8");
      return { ok: true, output: `Wrote ${body.length} bytes to ${intent.target}` };
    }

    return { ok: false, output: "Could not determine a file action (read/list/write) from that request." };
  },
};

export default skill;
