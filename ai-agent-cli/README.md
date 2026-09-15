# Agent CLI

A small, zero-dependency terminal AI agent: give it a task, it plans out
loud, runs the steps through a set of built-in skills, teaches you why as it
goes (optional), and always leaves you with concrete next steps.

This is its own standalone project living inside this repo — it has nothing
to do with `casual-character-chat-app/` and doesn't touch any of its code.

See [`DESIGN.md`](./DESIGN.md) for the full architecture and reasoning
behind how it's built.

## Quick start

No install step needed — plain Node.js (v18+), no dependencies.

```bash
cd ai-agent-cli
node bin/agent.js "what is 12 * (4 + 3)"
```

Or start an interactive session:

```bash
node bin/agent.js
> list files in .
> remember my_favorite_number = 42
> recall my_favorite_number
> exit
```

Want to see *why* each step happens, in plain language (good for learning
how the agent thinks)?

```bash
node bin/agent.js --teach "read package.json"
```

### Using a real model

By default Agent CLI runs fully offline with a deterministic built-in
planner — no API key required, works immediately. To have it plan and
reason with a live Claude model instead:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
node bin/agent.js "explain what this repo's build script does"
```

### Make it a `agent` command

```bash
cd ai-agent-cli
npm link      # or: chmod +x bin/agent.js && add this dir's bin/ to PATH
agent "your task"
```

## What it can do out of the box

- **calculator** — safe arithmetic, no `eval`
- **search** — web search, no API key required
- **webFetch** — fetch a public web page or JSON API and read its text
- **fileOps** — read / list / write files, scoped to the current directory
- **shell** — run one shell command (always asks for confirmation first)
- **notes** — remember/recall short facts for the rest of the session

```bash
node bin/agent.js "search for rust borrow checker"
node bin/agent.js "fetch https://api.github.com/repos/anthropics/claude-code"
node bin/agent.js --yes "search for rust borrow checker then read the first result"
```

### Search providers

Search works with no API key, using DuckDuckGo. That endpoint rate-limits
and times out fairly often (the skill retries), so for sustained use set
one of these and it's picked up automatically — no config, first one wins:

| Env var                | Provider   |
|------------------------|------------|
| `BRAVE_SEARCH_API_KEY` | Brave      |
| `TAVILY_API_KEY`       | Tavily     |
| `SERPAPI_API_KEY`      | SerpAPI    |

`webFetch` only speaks http/https and refuses loopback, private-range and
cloud-metadata addresses — re-checked on every redirect hop, so a public
URL can't bounce you into `169.254.169.254`. See DESIGN.md §7.

Anything that doesn't match a skill is answered directly through reasoning.

## Chaining steps

Say `then` and the agent wires one step's result into the next:

```bash
node bin/agent.js --yes "fetch https://example.com then save it to page.txt"
node bin/agent.js --yes "what is 6 * 7 then remember it as answer"
```

Under the hood the second step's input holds `{{prev}}`, which is replaced
with what the first step actually produced. You can write `{{prev}}` or
`{{1}}`/`{{2}}` yourself, and a live model is told the same syntax so its
plans chain too.

## Running the tests

```bash
node test/run.js
```

The test suite runs entirely offline (no API key needed) and exercises the
planner, all four skills, the confirmation gate, and the suggestion engine.
