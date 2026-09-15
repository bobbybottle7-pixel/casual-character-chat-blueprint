# Agent CLI — Design Spec

A standalone, zero-dependency terminal AI agent. Separate project, separate
folder, nothing shared with `casual-character-chat-app/`. It exists to solve
whatever task the user throws at it — code, research, math, writing, planning
— while narrating its reasoning, teaching as it goes, and always proposing
what to do next.

## 1. Goals

1. **Solve open-ended tasks**, not just answer questions — plan, use tools,
   check its own work, retry.
2. **Show its thinking.** Every run prints a numbered plan before acting and
   a short reasoning line before each step, not just a final answer.
3. **Teach, don't just answer.** A `--teach` mode (and a first-run tutorial)
   explains *why* a step is being taken in plain language, aimed at someone
   who has never used an agent tool before.
4. **Always suggest next moves.** After finishing, the agent proposes 2–4
   concrete follow-ups the user can run immediately.
5. **Work with or without an API key.** With `ANTHROPIC_API_KEY` set, it
   plans and reasons with a real model. Without one, it falls back to a
   deterministic local planner so the tool is still runnable, testable, and
   demoable offline — this is how the automated test suite exercises it.
6. **Stay auditable.** Every tool call the agent makes (shell, file write) is
   printed before it runs; destructive shell commands require `--yes` or an
   interactive confirmation.

## 2. Non-goals

- Not a chat UI, not a web app — terminal only.
- Not trying to reimplement Claude Code. Its skill set is intentionally
  small and inspectable (see §5); the value is the loop + teaching layer,
  not raw tool breadth.
- No telemetry, no accounts, no network calls except the one optional LLM
  API call per turn.

## 3. Architecture

```
bin/agent.js            CLI entry point: arg parsing, REPL vs one-shot mode
src/
  agent.js               Core loop: plan -> act -> observe -> reflect -> suggest
  llm.js                 LLM client (Anthropic Messages API over fetch) + offline
                          planner/answer/suggestion generation (online + offline
                          implementations behind one interface, see §3.3)
  memory.js              Conversation + task history, persisted to .agent/session.json
  ui.js                  All terminal rendering: plan, reasoning, teaching asides,
                          suggestions, banners — no deps
  skills/
    index.js             Skill registry + dispatch
    calculator.js         Arithmetic / unit-safe expression evaluation
    fileOps.js            Read / write / list files under the cwd
    shell.js               Run a shell command (confirmed, sandboxed to cwd)
    notes.js                Scratchpad: remember/recall facts across steps within a session
```

### 3.1 The loop

```
User task
   │
   ▼
PLAN   — LLM or offline planner produces an ordered list of steps,
          each tagged with the skill it needs (or "reason" for pure thinking)
   │
   ▼
For each step:
   REASON  — one-line "why this step" printed (teaching mode: 2-4 lines)
   ACT     — dispatch to the skill, or produce a reasoning-only answer
   OBSERVE — capture the skill's output, append to memory
   │
   ▼
REFLECT — did the plan solve the task? If a step failed or the goal isn't
          met, the agent re-plans the remaining steps (bounded retries)
   │
   ▼
ANSWER + SUGGEST — final answer printed, then 2-4 concrete next actions
```

Bounded retries (default 2 re-plans) prevent infinite loops; the agent says
plainly when it's stuck instead of spinning.

### 3.2 Modes

- **One-shot:** `agent "task"` — plan, run, answer, exit. Good for scripting.
- **REPL:** `agent` with no args — interactive session, memory persists
  across turns until exit, teaching asides shown once per topic (not
  repeated every turn) unless `--teach always` is passed.
- **First run:** if no `.agent/` directory exists yet, print a short
  walkthrough (what the agent can do, how skills work, how to enable
  teaching mode) before the first task.

### 3.3 LLM vs offline planner

`src/llm.js` exports one function, `plan(task, context)`, with two
implementations selected at startup:

- **Online** (`ANTHROPIC_API_KEY` set): calls the Anthropic Messages API
  with a system prompt that asks for a JSON plan (steps + skill + reasoning)
  and, per step, a short natural-language result.
- **Offline** (no key): a rule-based planner — pattern-matches the task
  against the registered skills (arithmetic expression → calculator, file
  path mentioned → fileOps, "run"/"execute" → shell, everything else →
  a single reasoning-only step) and produces canned-but-structurally-real
  reasoning strings. This keeps the control flow, UI, and skills fully
  exercised without a network call, which is what makes the tool testable
  in CI/sandboxes.

Both implementations satisfy the same interface, so swapping one for the
other (e.g. a future OpenAI or local-model backend) only touches
`src/llm.js`.

## 4. Teaching mode

`--teach` (or `AGENT_TEACH=1`) makes every step print an extra "why" block:

```
[2/3] fileOps.read  — reading package.json
  ↳ why: I need to see your existing dependencies before suggesting new
    ones, so I don't recommend something you already have.
```

First run always shows one paragraph explaining: what a "skill" is, why the
agent shows its plan before acting, and how to turn teaching mode on/off.
This paragraph is shown once (tracked in `.agent/session.json`) and can be
replayed with `agent --help-tutorial`.

## 5. Skills (v1 set)

| Skill        | Does                                            | Confirmation needed |
|--------------|--------------------------------------------------|----------------------|
| `calculator` | Evaluates a safe arithmetic expression            | no |
| `fileOps`    | read / write / list files, scoped to cwd          | write: yes |
| `shell`      | Runs one shell command via `child_process`        | always, unless `--yes` |
| `notes`      | Remember/recall short facts within a session       | no |

Skills are plain objects `{ name, description, match(task), run(args) }`
registered in `src/skills/index.js`. Adding a skill is: write the file,
register it — no other code changes needed (open/closed by design).

## 6. Suggestions engine

After every answer, `src/suggestions.js` looks at what just happened (which
skills ran, whether it touched files, whether the task looked like a
larger project) and proposes 2–4 follow-ups, e.g.:

```
Suggestions:
  1. Run `agent "write tests for utils.js"` to cover what we just changed
  2. Try --teach to see why each step was chosen
  3. Ask "explain what a skill is" if any of this was unclear
```

Suggestions are generated by simple heuristics offline, or by asking the
LLM for 2-4 short imperative follow-ups online — never left empty.

## 7. Safety

- `shell` skill echoes the exact command before running it and requires
  `--yes` on the CLI or an interactive `y/N` confirmation; it is never
  auto-approved from a plan alone.
- `fileOps` write is confined to paths under the current working directory
  (rejects `..` escapes and absolute paths outside cwd).
- No skill shells out to `rm -rf`, `git push --force`, or other destructive
  patterns without the same confirmation gate — the agent does not have a
  separate "trusted" bypass.

## 8. File/session layout

```
.agent/
  session.json     conversation history, tutorial-seen flag, teach setting
```

Created on first run in the user's current working directory, git-ignored
by default (see `.gitignore`).

## 9. Build phases

1. **Phase 1 (this change):** core loop, offline planner, 4 skills, teaching
   mode, suggestions, REPL + one-shot modes, first-run tutorial.
2. **Phase 2 (future):** online LLM planning wired to a real API key,
   richer skills (web fetch, multi-file edits), plan re-use/caching.
3. **Phase 3 (future):** pluggable skill packs loaded from a directory,
   so users can drop in their own skills without editing core files.

Phase 1 is fully implemented in this change and is real, run-it-yourself
software — not a stub. Phases 2–3 are recorded here as the intended next
steps, not built yet.
