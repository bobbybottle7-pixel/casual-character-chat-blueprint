import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, extname, normalize as normalizePath, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { query } from "@anthropic-ai/claude-agent-sdk";
import * as projects from "./projects.mjs";
import * as sessions from "./sessions.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB_DIR = join(ROOT, "web");
const PORT = Number(process.env.PORT) || 8787;
const HOST = "127.0.0.1";
const MAX_BODY = 25 * 1024 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// Live turns, so /api/interrupt can reach the Query that is mid-flight.
const activeTurns = new Map();

// Launching from inside a Claude Code session leaks that session's identity into
// the child, so every conversation binds to it instead of getting its own.
// CLAUDE_CODE_REMOTE_SESSION_ID is the one that actually wins; the others are
// stripped for the same reason.
const INHERITED_SESSION_VARS = [
  "CLAUDE_CODE_REMOTE_SESSION_ID",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
];
const CHILD_ENV = (() => {
  const env = { ...process.env };
  for (const key of INHERITED_SESSION_VARS) delete env[key];
  return env;
})();

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error("Payload too large"), { status: 413 });
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveStatic(res, urlPath) {
  const rel = normalizePath(urlPath === "/" ? "/index.html" : urlPath).replace(/^(\.\.[/\\])+/, "");
  const file = join(WEB_DIR, rel);
  if (!file.startsWith(WEB_DIR)) return json(res, 403, { error: "Forbidden" });
  try {
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch {
    json(res, 404, { error: "Not found" });
  }
}

// Images ride inline as content blocks. Anything else lands in the project
// directory so the agent can open it with Read instead of us pushing a whole
// document through the message channel.
async function buildUserContent(text, attachments, dir) {
  if (!Array.isArray(attachments) || attachments.length === 0) return text;

  const blocks = [];
  const notes = [];
  for (const file of attachments) {
    if (!file?.data || !file?.name) continue;
    if (typeof file.mediaType === "string" && file.mediaType.startsWith("image/")) {
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: file.mediaType, data: file.data },
      });
    } else {
      const safeName = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120);
      const target = join(dir, "attachments", safeName);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(file.data, "base64"));
      notes.push(`attachments/${safeName}`);
    }
  }

  let body = text || "";
  if (notes.length > 0) {
    body += `\n\nAttached files (read them from the working directory): ${notes.join(", ")}`;
  }
  blocks.unshift({ type: "text", text: body || "(see attachments)" });
  return blocks;
}

async function handleChat(req, res) {
  const body = await readBody(req);
  const project = await projects.get(body.projectId);
  if (!project) return json(res, 404, { error: "Unknown project" });

  const turnId = typeof body.turnId === "string" ? body.turnId : randomUUID();
  const dir = projects.projectDir(project.id);
  await mkdir(dir, { recursive: true });

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (event, data) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const content = await buildUserContent(body.text ?? "", body.attachments, dir);
  const abortController = new AbortController();

  // Streaming input mode: the only mode that accepts image blocks and exposes
  // interrupt(). Yielding once makes this generator exactly one turn.
  async function* singleTurn() {
    yield {
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
    };
  }

  const allowed = new Set(project.tools);
  const mcpServers = project.mcpServers ?? {};
  const hasMcp = Object.keys(mcpServers).length > 0;
  // MCP tools arrive as mcp__<server>__<tool>, which no project tool list names.
  // Configuring a server is the opt-in, so its tools are allowed on that basis.
  const isAllowed = (name) => allowed.has(name) || (hasMcp && name.startsWith("mcp__"));

  const options = {
    cwd: dir,
    model: project.model,
    allowedTools: project.tools,
    permissionMode: project.permissionMode,
    includePartialMessages: true,
    // Opus 5 defaults thinking display to "omitted", which streams empty
    // thinking blocks and just looks like a long pause. Ask for the summary.
    thinking: { type: "adaptive", display: "summarized" },
    abortController,
    settingSources: [],
    env: CHILD_ENV,
    ...(hasMcp ? { mcpServers } : {}),
    canUseTool: async (toolName, input) =>
      isAllowed(toolName)
        ? { behavior: "allow", updatedInput: input }
        : { behavior: "deny", message: `${toolName} is not enabled for this project.` },
  };
  // The claude_code preset is a coding-agent prompt, so only the Code-style
  // projects opt into it; a chat project gets its own prompt verbatim.
  if (project.preset === "claude_code") {
    options.systemPrompt = project.systemPrompt?.trim()
      ? { type: "preset", preset: "claude_code", append: project.systemPrompt }
      : { type: "preset", preset: "claude_code" };
  } else if (project.systemPrompt?.trim()) {
    options.systemPrompt = { type: "custom", prompt: project.systemPrompt };
  }
  if (body.sessionId) options.resume = body.sessionId;

  const run = query({ prompt: singleTurn(), options });
  activeTurns.set(turnId, { run, abortController });
  send("turn", { turnId });

  req.on("close", () => {
    if (activeTurns.has(turnId)) abortController.abort();
    activeTurns.delete(turnId);
  });

  try {
    for await (const message of run) {
      if (message.type === "system" && message.subtype === "init") {
        send("session", { sessionId: message.session_id });
      }
      send("message", message);
    }
  } catch (error) {
    send("error", { message: error?.message ?? String(error) });
  } finally {
    activeTurns.delete(turnId);
    if (!res.writableEnded) {
      send("done", {});
      res.end();
    }
  }
}

async function handleApi(req, res, url) {
  const path = url.pathname;
  const method = req.method;

  if (path === "/api/chat" && method === "POST") return handleChat(req, res);

  if (path === "/api/interrupt" && method === "POST") {
    const { turnId } = await readBody(req);
    const turn = activeTurns.get(turnId);
    if (!turn) return json(res, 404, { error: "No such turn" });
    try {
      await turn.run.interrupt();
    } catch {
      turn.abortController.abort();
    }
    return json(res, 200, { ok: true });
  }

  if (path === "/api/projects") {
    if (method === "GET") return json(res, 200, await projects.list());
    if (method === "POST") return json(res, 200, await projects.save(await readBody(req)));
  }

  const projectMatch = path.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch && method === "DELETE") {
    await projects.remove(decodeURIComponent(projectMatch[1]));
    return json(res, 200, { ok: true });
  }

  const projectId = url.searchParams.get("projectId");

  if (path === "/api/sessions" && method === "GET") {
    const search = url.searchParams.get("q");
    if (search) return json(res, 200, await sessions.search(projectId, search));
    return json(res, 200, await sessions.listForProject(projectId));
  }

  const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
  if (sessionMatch) {
    const id = decodeURIComponent(sessionMatch[1]);
    if (method === "GET") return json(res, 200, await sessions.transcript(id, projectId));
    if (method === "PATCH") {
      const patch = await readBody(req);
      if (typeof patch.title === "string") await sessions.rename(id, patch.title, projectId);
      if (typeof patch.tag === "string") await sessions.tag(id, patch.tag, projectId);
      return json(res, 200, { ok: true });
    }
    if (method === "DELETE") {
      await sessions.remove(id, projectId);
      return json(res, 200, { ok: true });
    }
  }

  const exportMatch = path.match(/^\/api\/sessions\/([^/]+)\/export$/);
  if (exportMatch && method === "GET") {
    const id = decodeURIComponent(exportMatch[1]);
    const format = url.searchParams.get("format") === "json" ? "json" : "md";
    const content = await sessions.exportSession(id, projectId, format);
    res.writeHead(200, {
      "Content-Type": format === "json" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="conversation-${id.slice(0, 8)}.${format}"`,
    });
    return res.end(content);
  }

  return json(res, 404, { error: "Not found" });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    if (req.method === "GET") return await serveStatic(res, url.pathname);
    json(res, 405, { error: "Method not allowed" });
  } catch (error) {
    const status = error?.status ?? 500;
    if (!res.headersSent) json(res, status, { error: error?.message ?? "Server error" });
    else res.end();
  }
});

await projects.init();

// An API key silently outranks the subscription login and starts billing
// credits, so this is worth saying out loud rather than discovering on a bill.
if (process.env.ANTHROPIC_API_KEY) {
  console.warn("! ANTHROPIC_API_KEY is set - requests will bill API credits, not your Claude plan.");
  console.warn("  Unset it to use your subscription: unset ANTHROPIC_API_KEY\n");
} else {
  console.log("Auth: using your Claude Code login (no ANTHROPIC_API_KEY set).\n");
}

server.listen(PORT, HOST, () => {
  console.log(`Personal Claude  ->  http://${HOST}:${PORT}`);
});
