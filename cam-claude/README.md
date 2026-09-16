# Cam Claude

A personal, multi-mode Claude app that runs on your own machine and uses your
existing Claude Code login — no API key, no per-token bill.

Seven modes, each of which changes both what Claude is told to do **and** which
tools exist at all: General Chat, Roleplay (with a game-master layer), Web
Search, Code & Project, Deep Research, Writing, and Brainstorm.

---

## How the subscription part works

The [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) is
Claude Code packaged as a library. It spawns a bundled Claude Code binary, which
resolves credentials the same way the `claude` CLI does. On a machine where you
are logged into Claude Code, Cam Claude runs on that login.

This is why the app runs locally. Two things worth being clear about:

- **For you, on your machine, this just works.** It is your own Claude Code
  entitlement, used by an app you run.
- **It does not extend to other people.** Anthropic's Agent SDK docs state that
  third-party developers may not offer claude.ai login or subscription rate
  limits in their products without prior approval. Running this yourself is
  fine; distributing it so other people sign in with *their* claude.ai accounts
  is not. If you ever want to share it, set `ANTHROPIC_API_KEY` instead — the
  app supports that path and says which one it is using at startup.

---

## Setup

Requires Node 20+.

```bash
npm install
claude login     # once per machine, if you have not already
npm run dev
```

Open <http://localhost:8787>. The startup banner reports which credentials it
found:

```
  Cam Claude
  auth: subscription — Claude Code login (/Users/you/.claude/.credentials.json)
  db:   /path/to/cam-claude/data/cam-claude.db
  open: http://localhost:8787
```

If it says `auth: not detected`, the probe did not find credentials in the usual
places. That is a best-effort read rather than a live check — some setups
authenticate through the host and work fine anyway. If messages do fail, run
`claude login` or set `ANTHROPIC_API_KEY`.

Everything is stored in `data/cam-claude.db` (SQLite). Delete that file to start
over; back it up to keep your conversations.

### Configuration

All optional — see `.env.example`.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8787` | Port to serve on |
| `CAM_CLAUDE_DB` | `./data/cam-claude.db` | Database location |
| `CAM_CLAUDE_MODEL` | `opus` | Model alias or full id |
| `CAM_CLAUDE_RESEARCH_DIR` | `~/cam-claude-research` | Where Deep Research writes reports |
| `ANTHROPIC_API_KEY` | unset | Forces metered API-key auth |
| `CAM_CLAUDE_DEBUG` | unset | Logs the tool list and MCP status the CLI reports at session start |
| `CAM_CLAUDE_HOST` | `127.0.0.1` | Bind address. See the note below before changing it. |

### A note on the bind address

The server listens on loopback only. This process holds your Claude credentials
and, in Code mode, edits files and runs commands in a folder you choose — so it
should not be reachable from the network you happen to be on. `CAM_CLAUDE_HOST`
overrides it, but if you point it at `0.0.0.0` you are publishing an unauthenticated
remote-code-execution endpoint to your LAN. Put authentication in front of it first.

---

## The modes

A mode is not just a system prompt. It is a **capability boundary, a prompt, and
a UI shape**, declared together in one object (`server/modes/`). General Chat
cannot read a file because `tools: []` removes every built-in from Claude's
context — not because the prompt asks it not to.

| Mode | Tools it actually has | Notes |
|---|---|---|
| **General Chat** | none | Straight conversation. No filesystem, no web. |
| **Roleplay** | GM tools only | Collaborative fiction with real dice, world state, stats, inventory. |
| **Web Search** | `WebSearch`, `WebFetch` | Cites sources; separates what it found from what it knew. |
| **Code & Project** | full Claude Code set | Runs in a folder you pick. Writes and commands ask you first. |
| **Deep Research** | web + files + subagents | Fans out via `Task`, writes a cited report. |
| **Writing** | `Read` | Drafting, editing, style matching. Cannot write files. |
| **Brainstorm** | none | Volume and range first, judgement on request. |

Every mode but Code runs with `settingSources: []`, so your personal
`~/.claude/CLAUDE.md` and Claude Code settings never leak into a roleplay
session or a brainstorm.

### Prompt philosophy

Mode prompts say what the mode is for and how output should be shaped. They do
not add restrictions, disclaimers, or hedging on top of what the model already
does. Fiction modes carry craft direction — voice, pacing, POV discipline — and
nothing about subject matter.

This is enforced, not just intended: `npm run verify` fails the build if a
prompt grows a phrase from the hedging denylist in `scripts/verify-modes.ts`.

---

## Roleplay and the GM layer

Roleplay gets seven game-master tools, exposed through an in-process MCP server
(`server/tools/gm.ts`). The results are authoritative and render as cards rather
than prose, so Claude cannot quietly improve a roll it did not like:

- `roll_dice` — `2d6+3` notation, backed by `crypto.randomInt`
- `read_world_state` / `update_world_state` — scene, location, time, who is
  present, facts established in play
- `advance_scene` — time skips and location changes, rendered as a divider
- `adjust_stat` / `update_inventory` — health, ammo, coin, what people carry
- `recall_lore` — pulls setting detail that keyword matching did not load

World state persists in SQLite and shows in the right-hand panel. The **Character**
and **Narrator** send buttons steer one turn each, without rewriting the system
prompt.

### Importing characters

Open **Characters** (bottom left) and drop in:

- a V2/V3 character card **PNG** (the embedded `chara` chunk is read)
- a bare character card **JSON**
- a **Casual Character Chat** export (`{ version: 3, characters, personas }`)

The importers are ported from that app's `script.js` and rewritten for Node.

---

## Development

```bash
npm run dev        # server with reload on http://localhost:8787
npm run verify     # mode boundaries, prompt hygiene, tool schemas — no API calls
npm run typecheck  # tsc --noEmit
```

`npm run verify` is the cheap guard worth running before any commit. It checks
three things that are easy to break silently:

1. **Capability boundaries** — asserted against `modeToOptions()`, the same
   function the runner uses, not against the mode declarations.
2. **Prompt hygiene** — the denylist described above.
3. **Tool schemas** — that every GM tool survives JSON-Schema conversion. This
   exists because of a real bug: a `z.record()` field produced a schema the CLI
   rejected, which dropped *every* tool on the server, and the symptom was
   Claude narrating dice rolls it had never made. That reads like a prompting
   problem and is not one.

### Layout

```
server/
  index.ts            Express, SSE, static hosting
  agent/              auth probe, SDK options, SessionRunner, session manager
  modes/              one file per mode + the Mode type
  modes/roleplay/     per-turn prompt assembly
  tools/gm.ts         game-master MCP server
  import/             PNG card + Casual Character Chat importers
  store/              SQLite schema and repository
web/                  vanilla ES modules, no build step
scripts/verify-modes.ts
```

One `SessionRunner` holds a live `query()` per open conversation, driven in
streaming-input mode — the SDK's recommended mode and the only one that supports
image attachments, queued messages, and interruption.

Switching a conversation's mode starts a new SDK session, because the system
prompt is snapshotted on a session's first request. A short recap is carried
across so the new session is not blind, and the transcript shows a divider so
the switch is never silent.
