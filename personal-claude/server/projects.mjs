import { mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PROJECTS_DIR = join(ROOT, "projects");
const META_DIR = join(PROJECTS_DIR, ".meta");

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

// Project ids become filesystem paths and the agent's cwd, so anything outside
// this alphabet is rejected rather than sanitised.
function assertId(id) {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    throw Object.assign(new Error(`Invalid project id: ${JSON.stringify(id)}`), { status: 400 });
  }
  return id;
}

const READ_ONLY_TOOLS = ["Read", "Glob", "Grep", "WebSearch", "WebFetch"];
const FULL_TOOLS = [...READ_ONLY_TOOLS, "Write", "Edit", "Bash", "TodoWrite"];

const DEFAULTS = [
  {
    id: "general",
    name: "General",
    systemPrompt:
      "You are Claude, a thoughtful assistant. Answer directly and substantively. " +
      "Say what you actually think, flag real uncertainty, and skip the hedging and filler.",
    preset: null,
    model: "claude-opus-5",
    tools: READ_ONLY_TOOLS,
    permissionMode: "default",
  },
  {
    id: "writing",
    name: "Writing",
    systemPrompt:
      "You are a writing collaborator. Match the user's voice rather than imposing your own. " +
      "Prefer concrete detail over abstraction. When you critique, be specific about what to change and why.",
    preset: null,
    model: "claude-opus-5",
    tools: [],
    permissionMode: "default",
  },
  {
    id: "code",
    name: "Code",
    systemPrompt: "",
    preset: "claude_code",
    model: "claude-opus-5",
    tools: FULL_TOOLS,
    permissionMode: "acceptEdits",
  },
];

function normalize(raw, id) {
  return {
    id,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : id,
    systemPrompt: typeof raw.systemPrompt === "string" ? raw.systemPrompt : "",
    preset: raw.preset === "claude_code" ? "claude_code" : null,
    model: typeof raw.model === "string" && raw.model ? raw.model : "claude-opus-5",
    tools: Array.isArray(raw.tools) ? raw.tools.filter((t) => typeof t === "string") : READ_ONLY_TOOLS,
    permissionMode: typeof raw.permissionMode === "string" ? raw.permissionMode : "default",
  };
}

export function projectDir(id) {
  return join(PROJECTS_DIR, assertId(id));
}

function metaPath(id) {
  return join(META_DIR, `${assertId(id)}.json`);
}

export async function init() {
  await mkdir(META_DIR, { recursive: true });
  const existing = await list();
  if (existing.length > 0) return existing;
  for (const project of DEFAULTS) await save(project);
  return list();
}

export async function list() {
  await mkdir(META_DIR, { recursive: true });
  const files = (await readdir(META_DIR)).filter((f) => f.endsWith(".json"));
  const projects = [];
  for (const file of files) {
    try {
      const id = file.slice(0, -5);
      projects.push(normalize(JSON.parse(await readFile(join(META_DIR, file), "utf8")), id));
    } catch {
      // A corrupt sidecar shouldn't take down the whole project list.
    }
  }
  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

export async function get(id) {
  try {
    return normalize(JSON.parse(await readFile(metaPath(id), "utf8")), assertId(id));
  } catch {
    return null;
  }
}

export async function save(project) {
  const id = assertId(project.id);
  const clean = normalize(project, id);
  await mkdir(META_DIR, { recursive: true });
  await mkdir(projectDir(id), { recursive: true });
  await writeFile(metaPath(id), JSON.stringify(clean, null, 2));
  return clean;
}

export async function remove(id) {
  await rm(metaPath(id), { force: true });
  await rm(projectDir(id), { recursive: true, force: true });
}
