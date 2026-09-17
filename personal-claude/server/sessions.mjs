import {
  listSessions,
  getSessionMessages,
  renameSession,
  tagSession,
  deleteSession,
} from "@anthropic-ai/claude-agent-sdk";
import { projectDir } from "./projects.mjs";

// SessionMessage.message is the raw Anthropic message: content is either a
// plain string or an array of blocks. Only text and thinking carry prose.
function blocksToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && (b.type === "text" || b.type === "thinking"))
    .map((b) => (b.type === "text" ? b.text : b.thinking) ?? "")
    .join("\n");
}

function messageText(entry) {
  const message = entry?.message;
  if (!message || typeof message !== "object") return "";
  return blocksToText(message.content);
}

export async function listForProject(projectId) {
  const sessions = await listSessions({ dir: projectDir(projectId) });
  return sessions
    .map((s) => ({
      sessionId: s.sessionId,
      title: s.customTitle || s.summary || s.firstPrompt || "Untitled",
      lastModified: s.lastModified,
      createdAt: s.createdAt,
      tag: s.tag,
    }))
    .sort((a, b) => b.lastModified - a.lastModified);
}

export async function transcript(sessionId, projectId) {
  const messages = await getSessionMessages(sessionId, { dir: projectDir(projectId) });
  return messages
    .filter((m) => m.type === "user" || m.type === "assistant")
    .map((m) => ({
      uuid: m.uuid,
      type: m.type,
      content: m.message?.content ?? "",
      parentToolUseId: m.parent_tool_use_id,
    }));
}

export async function rename(sessionId, title, projectId) {
  await renameSession(sessionId, title, { dir: projectDir(projectId) });
}

export async function tag(sessionId, value, projectId) {
  await tagSession(sessionId, value, { dir: projectDir(projectId) });
}

export async function remove(sessionId, projectId) {
  await deleteSession(sessionId, { dir: projectDir(projectId) });
}

export async function search(projectId, queryText) {
  const needle = queryText.toLowerCase();
  const sessions = await listForProject(projectId);
  const hits = [];
  for (const session of sessions) {
    let messages;
    try {
      messages = await getSessionMessages(session.sessionId, { dir: projectDir(projectId) });
    } catch {
      continue;
    }
    const matches = [];
    for (const entry of messages) {
      if (entry.type !== "user" && entry.type !== "assistant") continue;
      const text = messageText(entry);
      const at = text.toLowerCase().indexOf(needle);
      if (at === -1) continue;
      matches.push({
        type: entry.type,
        excerpt: text.slice(Math.max(0, at - 60), at + needle.length + 100).trim(),
      });
      if (matches.length >= 3) break;
    }
    if (matches.length > 0) hits.push({ ...session, matches });
  }
  return hits;
}

export async function exportSession(sessionId, projectId, format) {
  const messages = await transcript(sessionId, projectId);
  if (format === "json") return JSON.stringify(messages, null, 2);

  const lines = [];
  for (const m of messages) {
    const text = blocksToText(m.content).trim();
    if (!text) continue;
    lines.push(m.type === "user" ? "## You" : "## Claude", "", text, "");
  }
  return lines.join("\n");
}
