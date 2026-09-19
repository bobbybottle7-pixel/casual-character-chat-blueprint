# ALLAI — architecture decisions (Milestone 1)

Written for review. Each decision lists what was chosen, what else was considered, what it
costs, and what it buys.

---

## Decision 1: a browser app in one file, not a server

**Chosen:** ALLAI is a single self-contained HTML file. No server, no install, no account.
It runs in the phone's browser and talks straight to AI providers.

**Considered and rejected:**

| Option | Why not |
|---|---|
| Termux + a Python or Node server on the phone | Termux is no longer on the Play Store and has to be sideloaded. It means Cam — who has never used a terminal — would have to learn one, manage packages, and keep a background process alive just to send a message. It burns RAM and battery on a budget phone, and every edit becomes a terminal session. |
| React / Vite / npm toolchain | Needs a build step run on a computer. There is no computer. |
| Cloud hosting (Vercel, Fly, Render) | Needs accounts and a deploy pipeline, and the free tiers move. The brief says not to spend money. |
| A native Android app | Needs Android Studio and a computer. Not available. |

**What it costs:** no background jobs, no scheduled tasks, and no way to hide a shared API
key — anything the app knows, the phone knows. Some providers that refuse browser requests
(no CORS headers) can't be reached without a relay. Anthropic's own API is one of these.

**What it buys:** it actually runs on Cam's device today, with zero setup, zero dollars and
zero accounts. Data never leaves the phone. Updating is downloading one file.

**Precedent:** the `casual-character-chat` app already in this repository ships exactly this
way, for exactly this reason. The approach is proven on this hardware.

---

## Decision 2: modular source, flattened by a build

A phone browser will not load linked `.js` and `.css` files from a page opened off local
storage — it blocks them. So the shape that works on the phone is one file. But writing the
app *as* one file is how a project turns into an unmaintainable wall of code. The 12,273-line
`script.js` next door is the cautionary example.

So: the source is small modules, and `build/build-allai.js` flattens them into
`dist/allai.html`. The build runs here, not on Cam's phone.

It is a small module bundler rather than a plain concatenation, because separate modules are
allowed to reuse names — three provider files each define their own `ENDPOINT`, and gluing
them together would crash on the duplicate. Each module keeps its own scope.

**Cost:** `dist/allai.html` is generated and must never be hand-edited. `npm run check`
enforces that it is current.

---

## Decision 3: one gate for money, and no way around it

Every AI request in ALLAI — now and in future, including Council and Lab — goes through
`sendChat()` in `src/core/chat.js`, and the first thing it does is ask `authorize()` in
`src/core/budget.js`. There is no second path, so there is nothing to forget to protect.

Three rules that go beyond the obvious:

1. **An unknown price counts as paid.** A model whose price the provider doesn't publish is
   refused, not assumed free.
2. **A key is not consent.** `providerConfig` holding an API key never influences the budget
   decision.
3. **No silent upgrade.** `sendWithFallback()` defaults to `freeOnly: true`, so a failing
   free model can never hand the request to a paid one.

`test/budget.test.mjs` and `test/chat.test.mjs` actively try to defeat all three.

---

## Decision 4: provider facts are fetched, not hardcoded

OpenRouter and Venice both publish their full catalogs — real prices, real context lengths,
real capabilities — readable without a key. ALLAI fetches those.

The alternative, a hardcoded model list, was rejected on principle: a hardcoded price is a
number that quietly goes stale and becomes a lie about what something costs. Cam has $5; a
stale price is a real risk, not a cosmetic one.

So `openrouter.js` and `venice.js` ship with **empty** catalogs. If the fetch fails, they
show nothing rather than something invented. Where a provider publishes nothing —
Pollinations doesn't publish a context limit — ALLAI displays "context not published".

A bonus fell out of this: OpenRouter publishes `is_moderated` per model, so the Models
screen can report whether the serving company adds its own moderation layer. That's a real,
sourced answer to the conversational-freedom requirement instead of a marketing claim.

---

## Decision 5: Pollinations first, because it needs no key

Verified live on 2026-09-19:

- `POST https://text.pollinations.ai/openai` answers with **no Authorization header**;
  the response reports `"user_tier":"anonymous"`.
- It returns `access-control-allow-origin: *`, so a page opened off phone storage can call
  it directly.
- Streaming is standard SSE, confirmed in a real browser from a `file://` page.
- The anonymous tier lists exactly one model: `openai-fast` (GPT-OSS 20B), text only.

That is a real model, genuinely free, with nothing to sign up for — so Milestone 1 is usable
the moment the file is opened. Everything else (OpenRouter, Venice, custom endpoints) is
registered and ready but switched **off** until Cam supplies a key.

**Risk, stated plainly:** it's a free public service with one model and no uptime promise.
That's why the provider layer exists and why nothing is built around Pollinations
specifically.

---

## Built to extend, not built now

Deliberately *not* built in Milestone 1: characters, Council, Lab, images, voice, search,
tools, agents, RAG, local models. The hooks for them are in place:

- **Characters** — a system prompt is already sent on every request, and characters have
  their own storage; a character is data that fills that prompt.
- **Council and Lab** — both are several `sendChat()` calls and a way to show the results.
  The cost guard covers them automatically.
- **Vision, tools, local models** — already fields on every model (`vision`, `tools`,
  `hosting: 'local' | 'remote'`) and already shown in the UI.
- **Local models** — `custom.js` accepts any address, including one on the phone itself.
  Whether the Nubia A76 can actually run a model is an open question to be *measured*
  before it is recommended, not assumed.

---

## Known limits of Milestone 1

Stated because they're real, not discovered later:

- Conversation history is saved but there's no screen to browse or reopen past chats yet.
- Anthropic's API can't be used from a browser page (no CORS). Claude Pro is a *subscription*,
  not API access, and the two are unrelated — Claude Pro cannot power ALLAI.
- The token estimate before a paid request is a rough 4-characters-per-token guess and is
  labelled as such. Real counts come back from the provider afterwards and are what the
  ledger records.
- Pollinations reports no context limit, so ALLAI can't warn when a long conversation is
  about to overflow it.
- One free provider means there's nothing to fail over *to* yet. ALLAI says so rather than
  pretending otherwise.

---

## How Milestone 1 was verified

- 30 automated tests, offline, run with `npm test`.
- A real-browser smoke test at phone size (360×740) with `npm run smoke`, covering: the page
  loads clean, cost protection is on by default, nothing scrolls sideways, every button is at
  least 40px tall, API keys stay masked, memory survives a reload, and **a real message to a
  real free model really comes back**.

Two genuine bugs were found this way and fixed:

1. `const $$ = ...` was arriving in the build as `const $ = ...`, because JavaScript's
   `String.replace()` treats `$$` in a string replacement as an escape. The app died on load.
   Now fixed and covered by `test/build.test.mjs`.
2. A 34px button, too small to hit reliably with a thumb. All buttons are now ≥ 40px.
