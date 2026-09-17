"use strict";

const $ = (id) => document.getElementById(id);

const state = {
  projects: [],
  projectId: localStorage.getItem("pc.project") || null,
  sessionId: null,
  attachments: [],
  turnId: null,
  streaming: false,
  stopped: false,
};

const ALL_TOOLS = ["Read", "Glob", "Grep", "WebSearch", "WebFetch", "Write", "Edit", "Bash", "TodoWrite"];

marked.setOptions({ breaks: true, gfm: true });

function renderMarkdown(text) {
  return DOMPurify.sanitize(marked.parse(text ?? ""));
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function scrollToBottom() {
  const box = $("messages");
  box.scrollTop = box.scrollHeight;
}

function setStatus(text) {
  $("status").textContent = text || "";
}

// ---------- API ----------

async function api(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

const qs = () => `projectId=${encodeURIComponent(state.projectId)}`;

// ---------- Projects ----------

async function loadProjects() {
  state.projects = await api("/api/projects");
  const select = $("project-select");
  select.innerHTML = "";
  for (const project of state.projects) {
    select.appendChild(new Option(project.name, project.id));
  }
  if (!state.projects.some((p) => p.id === state.projectId)) {
    const preferred = state.projects.find((p) => p.id === "general");
    state.projectId = (preferred ?? state.projects[0])?.id ?? null;
  }
  select.value = state.projectId;
  localStorage.setItem("pc.project", state.projectId);
}

const currentProject = () => state.projects.find((p) => p.id === state.projectId);

// ---------- Conversations ----------

async function loadConversations(searchText) {
  const nav = $("conversations");
  nav.innerHTML = "";
  let items;
  try {
    const url = searchText
      ? `/api/sessions?${qs()}&q=${encodeURIComponent(searchText)}`
      : `/api/sessions?${qs()}`;
    items = await api(url);
  } catch {
    nav.appendChild(el("p", "sidebar-foot", "Could not load conversations."));
    return;
  }
  if (items.length === 0) {
    nav.appendChild(el("p", "sidebar-foot", searchText ? "No matches." : "No conversations yet."));
    return;
  }
  for (const item of items) {
    const button = el("button", "conv");
    if (item.sessionId === state.sessionId) {
      button.classList.add("active");
      $("chat-title").textContent = item.title;
    }
    button.appendChild(el("span", null, item.title));
    if (item.matches?.length) {
      button.appendChild(el("span", "excerpt", item.matches[0].excerpt));
    }
    button.addEventListener("click", () => openConversation(item.sessionId, item.title));
    nav.appendChild(button);
  }
}

function showEmptyState() {
  const project = currentProject();
  $("messages").innerHTML = "";
  const box = el("div", "empty");
  box.appendChild(el("h3", null, project ? `${project.name}` : "Personal Claude"));
  box.appendChild(el("p", null, project?.systemPrompt?.trim() || "Ask anything to start."));
  $("messages").appendChild(box);
}

async function openConversation(sessionId, title) {
  state.sessionId = sessionId;
  $("chat-title").textContent = title || "Conversation";
  $("messages").innerHTML = "";
  setStatus("");
  try {
    const messages = await api(`/api/sessions/${encodeURIComponent(sessionId)}?${qs()}`);
    for (const message of messages) renderStoredMessage(message);
  } catch (error) {
    appendError(error.message);
  }
  scrollToBottom();
  loadConversations($("search").value.trim());
}

function newConversation() {
  state.sessionId = null;
  $("chat-title").textContent = "New conversation";
  showEmptyState();
  setStatus("");
  loadConversations($("search").value.trim());
}

// ---------- Rendering ----------

function messageShell(role, label) {
  const wrap = el("div", `msg ${role}`);
  wrap.appendChild(el("div", "msg-role", label));
  const body = el("div", "msg-body");
  wrap.appendChild(body);
  $("messages").appendChild(wrap);
  return { wrap, body };
}

function appendError(text) {
  const { body } = messageShell("error", "Error");
  body.textContent = text;
  scrollToBottom();
}

function renderBlocks(container, content) {
  if (typeof content === "string") {
    container.innerHTML = renderMarkdown(content);
    return;
  }
  if (!Array.isArray(content)) return;

  for (const block of content) {
    if (block.type === "text") {
      const div = el("div");
      div.innerHTML = renderMarkdown(block.text);
      container.appendChild(div);
    } else if (block.type === "thinking" && block.thinking) {
      const details = el("details", "thinking");
      details.appendChild(el("summary", null, "Thinking"));
      details.appendChild(el("div", "content", block.thinking));
      container.appendChild(details);
    } else if (block.type === "tool_use") {
      container.appendChild(el("div", "tool-chip", `${block.name}`));
      const details = el("details", "tool");
      details.appendChild(el("summary", null, `${block.name} input`));
      const pre = el("pre");
      pre.appendChild(el("code", null, JSON.stringify(block.input, null, 2)));
      details.appendChild(pre);
      container.appendChild(details);
    } else if (block.type === "tool_result") {
      const details = el("details", "tool");
      details.appendChild(el("summary", null, block.is_error ? "Tool error" : "Tool result"));
      const pre = el("pre");
      const text = typeof block.content === "string" ? block.content : JSON.stringify(block.content, null, 2);
      pre.appendChild(el("code", null, (text ?? "").slice(0, 8000)));
      details.appendChild(pre);
      container.appendChild(details);
    } else if (block.type === "image") {
      const img = el("img");
      img.src = `data:${block.source.media_type};base64,${block.source.data}`;
      container.appendChild(img);
    }
  }
}

function renderStoredMessage(message) {
  const content = message.content;
  const isToolResultOnly =
    Array.isArray(content) && content.length > 0 && content.every((b) => b.type === "tool_result");

  const role = message.type === "user" && !isToolResultOnly ? "user" : "assistant";
  const label = role === "user" ? "You" : isToolResultOnly ? "Tools" : "Claude";
  const { body } = messageShell(role, label);
  renderBlocks(body, content);
}

// ---------- Streaming turn ----------

function createLiveBlock() {
  const { wrap, body } = messageShell("assistant", "Claude");
  const thinkingDetails = el("details", "thinking hidden");
  thinkingDetails.appendChild(el("summary", null, "Thinking"));
  const thinkingContent = el("div", "content");
  thinkingDetails.appendChild(thinkingContent);

  const textDiv = el("div", "cursor");
  body.appendChild(thinkingDetails);
  body.appendChild(textDiv);

  return { wrap, body, thinkingDetails, thinkingContent, textDiv, text: "", thinking: "" };
}

function handleStreamEvent(live, event) {
  if (event.type === "content_block_delta") {
    const delta = event.delta;
    if (delta.type === "text_delta") {
      live.text += delta.text;
      live.textDiv.textContent = live.text;
    } else if (delta.type === "thinking_delta") {
      live.thinking += delta.thinking;
      live.thinkingDetails.classList.remove("hidden");
      live.thinkingDetails.open = true;
      live.thinkingContent.textContent = live.thinking;
    }
  }
}

async function send() {
  const text = $("input").value.trim();
  if ((!text && state.attachments.length === 0) || state.streaming) return;

  if ($("messages").querySelector(".empty")) $("messages").innerHTML = "";

  const { body } = messageShell("user", "You");
  renderBlocks(body, text || "(attachments)");
  for (const file of state.attachments) {
    if (file.mediaType.startsWith("image/")) {
      const img = el("img");
      img.src = `data:${file.mediaType};base64,${file.data}`;
      body.appendChild(img);
    } else {
      body.appendChild(el("div", "tool-chip", file.name));
    }
  }

  const payload = {
    projectId: state.projectId,
    sessionId: state.sessionId ?? undefined,
    text,
    attachments: state.attachments,
    turnId: crypto.randomUUID(),
  };
  state.turnId = payload.turnId;
  state.stopped = false;

  if (recognition) {
    try { recognition.stop(); } catch { /* not started */ }
  }
  $("input").value = "";
  $("input").style.height = "auto";
  clearAttachments();
  setStreaming(true);
  setStatus("Thinking…");
  scrollToBottom();

  let live = null;
  let turnBody = null;
  const finalizeLive = () => {
    if (!live) return;
    live.wrap.remove();
    live = null;
  };

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok || !res.body) throw new Error(`Server returned ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const eventLine = frame.match(/^event: (.+)$/m);
        const dataLine = frame.match(/^data: (.+)$/m);
        if (!eventLine || !dataLine) continue;

        const name = eventLine[1];
        let data;
        try {
          data = JSON.parse(dataLine[1]);
        } catch {
          continue;
        }

        if (name === "session") {
          state.sessionId = data.sessionId;
        } else if (name === "error") {
          finalizeLive();
          appendError(data.message);
        } else if (name === "message") {
          const message = data;
          if (message.type === "stream_event") {
            if (!live) live = createLiveBlock();
            handleStreamEvent(live, message.event);
            scrollToBottom();
          } else if (message.type === "assistant") {
            finalizeLive();
            if (!turnBody) turnBody = messageShell("assistant", "Claude").body;
            renderBlocks(turnBody, message.message?.content);
            scrollToBottom();
          } else if (message.type === "user" && Array.isArray(message.message?.content)) {
            const hasToolResult = message.message.content.some((b) => b.type === "tool_result");
            if (hasToolResult) {
              const { body: toolBody } = messageShell("assistant", "Tools");
              renderBlocks(toolBody, message.message.content);
              turnBody = null;
              scrollToBottom();
            }
          } else if (message.type === "result") {
            const seconds = (message.duration_ms / 1000).toFixed(1);
            const cost = message.total_cost_usd;
            const parts = [`${seconds}s`];
            if (typeof cost === "number") parts.push(`$${cost.toFixed(4)}`);
            // A user-pressed Stop comes back as an error subtype; saying so
            // would read as a failure rather than the thing they just did.
            if (state.stopped) parts.push("stopped");
            else if (message.subtype !== "success") parts.push(message.subtype);
            setStatus(parts.join("  ·  "));
          }
        }
      }
    }
  } catch (error) {
    appendError(error.message);
  } finally {
    finalizeLive();
    setStreaming(false);
    state.turnId = null;
    loadConversations($("search").value.trim());
  }
}

function setStreaming(active) {
  state.streaming = active;
  $("send").classList.toggle("hidden", active);
  $("stop").classList.toggle("hidden", !active);
  $("send").disabled = active;
  if (!active && !$("status").textContent.includes("$")) setStatus("");
}

async function stop() {
  if (!state.turnId) return;
  state.stopped = true;
  setStatus("Stopping…");
  await fetch("/api/interrupt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ turnId: state.turnId }),
  }).catch(() => {});
}

// ---------- Attachments ----------

function clearAttachments() {
  state.attachments = [];
  $("attachments").innerHTML = "";
  $("attachments").classList.add("hidden");
}

function renderAttachments() {
  const box = $("attachments");
  box.innerHTML = "";
  box.classList.toggle("hidden", state.attachments.length === 0);
  state.attachments.forEach((file, index) => {
    const chip = el("span", "chip", file.name);
    const remove = el("button", null, "×");
    remove.addEventListener("click", () => {
      state.attachments.splice(index, 1);
      renderAttachments();
    });
    chip.appendChild(remove);
    box.appendChild(chip);
  });
}

async function addFiles(fileList) {
  for (const file of fileList) {
    if (file.size > 12 * 1024 * 1024) {
      setStatus(`${file.name} is larger than 12 MB — skipped.`);
      continue;
    }
    const data = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.readAsDataURL(file);
    });
    state.attachments.push({
      name: file.name,
      mediaType: file.type || "application/octet-stream",
      data,
    });
  }
  renderAttachments();
}

// ---------- Project dialog ----------

function openProjectDialog() {
  const project = currentProject();
  if (!project) return;
  $("p-name").value = project.name;
  $("p-model").value = project.model;
  $("p-prompt").value = project.systemPrompt;
  $("p-preset").checked = project.preset === "claude_code";
  const mcp = project.mcpServers ?? {};
  $("p-mcp").value = Object.keys(mcp).length ? JSON.stringify(mcp, null, 2) : "";
  $("p-mcp-error").classList.add("hidden");

  const grid = $("p-tools");
  grid.innerHTML = "";
  for (const tool of ALL_TOOLS) {
    const label = el("label");
    const input = el("input");
    input.type = "checkbox";
    input.value = tool;
    input.checked = project.tools.includes(tool);
    label.appendChild(input);
    label.appendChild(el("span", null, tool));
    grid.appendChild(label);
  }
  $("project-dialog").showModal();
}

async function saveProject(event) {
  if (event.submitter?.value !== "save") return;
  const project = currentProject();
  const tools = [...$("p-tools").querySelectorAll("input:checked")].map((i) => i.value);

  const raw = $("p-mcp").value.trim();
  let mcpServers = {};
  if (raw) {
    try {
      mcpServers = JSON.parse(raw);
    } catch (error) {
      // dialog already closed on submit, so report it where the user will look
      setStatus(`MCP config is not valid JSON: ${error.message}`);
      return;
    }
  }

  await api("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: project.id,
      name: $("p-name").value.trim() || project.name,
      model: $("p-model").value,
      systemPrompt: $("p-prompt").value,
      preset: $("p-preset").checked ? "claude_code" : null,
      mcpServers,
      tools,
      permissionMode: project.permissionMode,
    }),
  });
  await loadProjects();
  const saved = currentProject();
  const count = Object.keys(saved?.mcpServers ?? {}).length;
  const dropped = Object.keys(mcpServers).length - count;
  setStatus(
    `Project saved. New conversations use the updated settings.` +
      (count ? `  ${count} MCP server(s) configured.` : "") +
      (dropped > 0 ? `  ${dropped} MCP entr(y/ies) rejected as malformed.` : "")
  );
}

// ---------- Voice input ----------

// Web Speech API: Chrome and Safari only, and it needs network access to
// Google's recogniser. Absent elsewhere, so the button hides rather than
// sitting there doing nothing.
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

function setupVoice() {
  const mic = $("mic");
  if (!SpeechRecognition) {
    mic.classList.add("hidden");
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = navigator.language || "en-US";

  // Text already in the box when dictation started; interim results are
  // rewritten on every event, so they must not accumulate on top of it.
  let base = "";
  let listening = false;

  const stopListening = () => {
    listening = false;
    mic.classList.remove("recording");
    mic.title = "Dictate";
  };

  recognition.addEventListener("result", (event) => {
    let finalText = "";
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (result.isFinal) finalText += result[0].transcript;
      else interim += result[0].transcript;
    }
    if (finalText) base = `${base}${base && !base.endsWith(" ") ? " " : ""}${finalText.trim()}`;
    $("input").value = interim ? `${base}${base ? " " : ""}${interim.trim()}` : base;
    autoGrow();
  });

  recognition.addEventListener("error", (event) => {
    setStatus(
      event.error === "not-allowed"
        ? "Microphone permission denied."
        : `Dictation stopped: ${event.error}`
    );
    stopListening();
  });

  recognition.addEventListener("end", stopListening);

  mic.addEventListener("click", () => {
    if (listening) {
      recognition.stop();
      return;
    }
    base = $("input").value.trim();
    try {
      recognition.start();
    } catch {
      return;
    }
    listening = true;
    mic.classList.add("recording");
    mic.title = "Stop dictating";
    setStatus("Listening…");
  });
}

// ---------- Wiring ----------

function autoGrow() {
  const input = $("input");
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 240)}px`;
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("pc.theme", theme);
}

function wire() {
  $("send").addEventListener("click", send);
  $("stop").addEventListener("click", stop);
  $("new-chat").addEventListener("click", newConversation);
  $("attach").addEventListener("click", () => $("file-input").click());
  $("file-input").addEventListener("change", (e) => {
    addFiles(e.target.files);
    e.target.value = "";
  });

  $("input").addEventListener("input", autoGrow);
  $("input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  $("project-select").addEventListener("change", async (e) => {
    state.projectId = e.target.value;
    localStorage.setItem("pc.project", state.projectId);
    newConversation();
  });
  $("edit-project").addEventListener("click", openProjectDialog);
  $("project-dialog").querySelector("form").addEventListener("submit", saveProject);

  let searchTimer;
  $("search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    const value = e.target.value.trim();
    searchTimer = setTimeout(() => loadConversations(value), 220);
  });

  $("export-md").addEventListener("click", () => {
    if (!state.sessionId) return;
    window.location.href = `/api/sessions/${encodeURIComponent(state.sessionId)}/export?${qs()}&format=md`;
  });

  $("delete-chat").addEventListener("click", async () => {
    if (!state.sessionId) return;
    if (!confirm("Delete this conversation? This cannot be undone.")) return;
    await api(`/api/sessions/${encodeURIComponent(state.sessionId)}?${qs()}`, { method: "DELETE" });
    newConversation();
  });

  $("toggle-theme").addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    applyTheme(next);
  });

  let dragDepth = 0;
  document.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragDepth += 1;
    document.body.classList.add("dragging");
  });
  document.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) document.body.classList.remove("dragging");
  });
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove("dragging");
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  });

  $("input").addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.items ?? [])]
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  });
}

(async function start() {
  applyTheme(localStorage.getItem("pc.theme") || "dark");
  wire();
  setupVoice();
  await loadProjects();
  newConversation();
})();
