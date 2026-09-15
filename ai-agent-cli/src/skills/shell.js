import { execSync } from "node:child_process";

const DESTRUCTIVE_PATTERNS = [/rm\s+-rf/i, /force/i, /--force/i, /git\s+push/i, /:\s*\(\)\s*\{/];

function extractCommand(input) {
  // Prefer an explicit backtick/quote block; otherwise strip a leading
  // "run"/"execute" and treat the remainder as the command.
  const quoted = input.match(/`([^`]+)`/) || input.match(/"([^"]+)"/);
  if (quoted) return quoted[1];
  return input.replace(/^\s*(please\s+)?(run|execute)\s+/i, "").trim();
}

const skill = {
  name: "shell",
  description: "Runs one shell command in the working directory (always confirmed first).",
  match(task) {
    return /\b(run|execute)\b.*\b(command|script|npm|node|python|ls|pwd|git)\b/i.test(task) || /`[^`]+`/.test(task);
  },
  needsConfirmation() {
    return true; // shell always confirms, no exceptions — see DESIGN.md §7
  },
  isDestructive(input) {
    const cmd = extractCommand(input);
    return DESTRUCTIVE_PATTERNS.some((p) => p.test(cmd));
  },
  async run(input, ctx) {
    const cwd = ctx?.cwd || process.cwd();
    const command = extractCommand(input);
    if (!command) return { ok: false, output: "No command found to run." };
    try {
      const output = execSync(command, {
        cwd,
        timeout: 15000,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { ok: true, output: output.trim() || "(command produced no output)", command };
    } catch (err) {
      const out = (err.stdout || "") + (err.stderr || err.message || "");
      return { ok: false, output: out.trim() || String(err), command };
    }
  },
};

export default skill;
