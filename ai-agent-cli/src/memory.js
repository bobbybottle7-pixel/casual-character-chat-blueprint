import fs from "node:fs";
import path from "node:path";

const SESSION_DIR = ".agent";
const SESSION_FILE = "session.json";

function sessionPath(cwd) {
  return path.join(cwd, SESSION_DIR, SESSION_FILE);
}

function defaultSession() {
  return {
    createdAt: new Date().toISOString(),
    tutorialSeen: false,
    teach: false,
    notes: {},
    history: [], // { role: 'user'|'agent', task, answer, at }
  };
}

export function loadSession(cwd = process.cwd()) {
  const file = sessionPath(cwd);
  if (!fs.existsSync(file)) return defaultSession();
  try {
    const raw = fs.readFileSync(file, "utf8");
    return { ...defaultSession(), ...JSON.parse(raw) };
  } catch {
    // A corrupt session file should never crash the agent — start fresh.
    return defaultSession();
  }
}

export function saveSession(session, cwd = process.cwd()) {
  const dir = path.join(cwd, SESSION_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(sessionPath(cwd), JSON.stringify(session, null, 2), "utf8");
}

export function recordTurn(session, task, answer) {
  session.history.push({ task, answer, at: new Date().toISOString() });
  // Keep the on-disk history bounded so long-lived sessions don't grow forever.
  if (session.history.length > 200) {
    session.history = session.history.slice(-200);
  }
}

export function recentContext(session, n = 5) {
  return session.history.slice(-n);
}
