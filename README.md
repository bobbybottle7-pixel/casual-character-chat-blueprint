# Personal Claude

A personal Claude workspace you run on your own machine, powered by your own
Claude subscription. Conversations, projects and attachments stay on your disk.

```bash
cd personal-claude
npm install
npm start
```

Then open <http://127.0.0.1:8787>. Full documentation lives in
[`personal-claude/README.md`](personal-claude/README.md).

---

## What it is

A daily-driver Claude client you control, built on the
[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview). Because
it runs the real agent harness rather than a bare chat endpoint, a workspace can
actually do things — read your files, run commands, search the web, and reach
your own tools over MCP.

- **Projects** — a directory, a system prompt, a model and a tool set. The
  directory *is* Claude's working directory, so files you drop in are readable
  with no upload step, and each project keeps its own history.
- **Thinking** — extended thinking on, summarized, in a collapsible panel.
- **Attachments** — images inline, other files written into the project for
  Claude to read.
- **MCP servers** — configured per project, same JSON shape as Claude Code.
- **Voice input**, search across conversations, Markdown export, and mid-turn
  interrupt that keeps partial output.

Every turn reports its duration and cost.

## How it's authenticated

It uses your existing Claude login — the same one Claude Code uses — rather than
a pay-per-token API key. The server says which credential it resolved at boot; if
it warns that `ANTHROPIC_API_KEY` is set, unset it and restart, or you'll bill API
credits instead of your plan.

Anthropic's terms allow this for **your own** use. If you ever put it in front of
other people, switch it to an API key.

## Architecture

Subscription auth is only available through the Agent SDK, which is a Node
library and cannot run in a browser. So this is a small local server plus a
browser UI on `127.0.0.1` — not a static page you open from disk. Nothing leaves
the machine.

Conversations are stored and resumed by the SDK's own session store rather than
re-implemented, so full context comes back on resume with nothing to keep in sync.

---

## History

This repository previously held a fork of **Casual Character Chat**, a
browser-only character chat app that talked to OpenRouter. It was replaced
wholesale by Personal Claude. The old app remains in git history on `main` if you
want it back.
