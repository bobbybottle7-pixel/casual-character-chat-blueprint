# Personal Claude

A personal Claude workspace you run on your own machine, powered by your own
Claude subscription. Conversations, projects, and attachments stay on your disk.

It is built on the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview),
which means it inherits real capabilities — file access, shell, web search, and
MCP servers — not just a chat box. Projects turn those into workspaces you can
actually work in.

---

## Setup

You need **Node 18+** and a working `claude` login (the same one Claude Code uses).

```bash
cd personal-claude
npm install
npm start
```

Open <http://127.0.0.1:8787>.

On boot the server prints which credential it resolved. You want:

```
Auth: using your Claude Code login (no ANTHROPIC_API_KEY set).
```

If it warns that `ANTHROPIC_API_KEY` is set, requests bill API credits instead of
your plan. `unset ANTHROPIC_API_KEY` and restart.

### A note on which account pays

Your Claude plan carries a monthly Agent SDK credit that covers usage like this.
Confirm what's active on your own account — the amounts and rollout have moved
around. Anthropic's terms allow this for **your own** use; if you ever put it in
front of other people, switch it to an API key.

---

## Projects

A project is a directory plus a few settings: a system prompt, a model, and the
tools Claude may use. Three ship by default:

| Project | Tools | For |
|---|---|---|
| **General** | read-only + web | Everyday questions |
| **Writing** | none | Drafting and editing, no tool noise |
| **Code** | full, auto-accept edits | Actual work on files |

The project's directory **is** Claude's working directory. Drop files in
`projects/<name>/` and Claude can read them with no upload step. Each project
keeps its own conversation history.

Edit a project with the ⚙ button. Changes apply to new conversations — an
existing conversation keeps the prompt it started with, by design, so its
history stays coherent.

### MCP servers

Each project can connect its own MCP servers, using the same JSON shape Claude
Code uses, so an existing config pastes straight in:

```json
{
  "github": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": { "GITHUB_TOKEN": "..." }
  },
  "internal": { "type": "http", "url": "https://mcp.example.com/sse" }
}
```

Configuring a server is the opt-in for its tools — you don't also have to tick
them in the tool list, since MCP tools are named `mcp__<server>__<tool>` and
aren't known in advance. Malformed entries are dropped and reported rather than
passed through, because a stdio entry launches a process.

---

## Using it

- **Enter** sends, **Shift+Enter** makes a newline.
- **🎙 Dictate** appends speech to whatever is already in the composer. Chrome
  and Safari only — the button hides elsewhere, and dictation needs network
  access to the browser's recognizer.
- **Drag, paste, or 📎** to attach. Images go inline; other files are written
  into the project directory and Claude reads them from there.
- **Stop** interrupts a running turn. Partial output is kept.
- **Search** matches across every conversation in the project.
- **Export** downloads the conversation as Markdown.
- Each turn footers its duration and cost.

Thinking is on and summarized — the collapsible **Thinking** panel shows Claude's
reasoning before the answer.

---

## Where things live

| What | Where |
|---|---|
| Conversations | `~/.claude/projects/<encoded-dir>/*.jsonl` (owned by the SDK) |
| Project settings | `projects/.meta/*.json` |
| Project files | `projects/<id>/` |
| Theme, last project | browser `localStorage` |

Conversations are managed by the Agent SDK rather than re-implemented here, so
`resume` restores full context and nothing needs syncing between two stores.

---

## Layout

```
server/
  server.mjs     HTTP + SSE, one Agent SDK turn per request
  sessions.mjs   list / read / rename / search / export
  projects.mjs   project CRUD and the seeded defaults
web/
  index.html     app shell
  app.js         UI and the SSE client
  style.css
  vendor/        marked + DOMPurify, vendored so it works offline
```

The server binds to `127.0.0.1` only. Markdown from the model is sanitized with
DOMPurify before it reaches the DOM.

One deliberate quirk: launching from inside a Claude Code session leaks
`CLAUDE_CODE_REMOTE_SESSION_ID` into the child process, which would bind every
conversation to that one session. The server strips it.
