# ALLAI

A personal AI platform that runs on your phone.

**Milestone 1 is finished and working.** You can chat with a real AI model right now,
for free, without an account, without an API key, and without spending anything.

---

## How to use it (30 seconds, no terminal)

1. In GitHub, open the file `allai/dist/allai.html`.
2. Press the **download** button (the ⤓ icon near the top right of the file view).
3. On your phone, open your **Files** app, find the downloaded `allai.html`, and tap it.
   Choose to open it with your browser.
4. That's it. Type a message and press **Send**.

There is nothing to install and nothing to sign up for. The whole app is that one file.

**Tip:** once it's open in the browser, use the browser's menu → *Add to Home screen*.
It then behaves like a normal app icon.

---

## What works right now

| Thing | State |
|---|---|
| Chat with a real AI model | ✅ Working, tested |
| Free model, no API key | ✅ Working — GPT-OSS 20B via Pollinations |
| Streaming replies + a Stop button | ✅ Working |
| Model picker showing cost, context, capabilities | ✅ Working |
| Permanent memory you control | ✅ Working — add, edit, switch off, delete |
| Cost protection | ✅ Working, tested — cannot spend without your say-so |
| Usage ledger (what was sent, what it cost) | ✅ Working |
| Settings, API keys, delete-everything | ✅ Working |
| Characters | ⬜ Milestone 3 |
| Council | ⬜ Milestone 4 |
| Model Lab | ⬜ Milestone 5 |

The screens for Characters, Council and Lab exist in the app and say plainly that they
aren't built yet. They don't show fake results.

---

## About money

You have about $5, and ALLAI is built so it cannot touch it by accident.

Out of the box:

- **Protect my balance** is **ON** — ALLAI refuses any request that could cost money.
- Paid requests are **OFF**.
- Your spending limit is **$0.00**.

For ALLAI to spend even one cent, *four* separate things have to happen: you turn off
"Protect my balance", you turn on paid requests, you set a spending limit above zero, and
you say yes to that specific request when it shows you the estimate. Three of those are
switches you have to find and flip yourself.

Some extra rules built into it:

- **A model with an unknown price counts as paid.** Unknown is never treated as free.
- **Having an API key is never treated as permission to spend.** A key means "I can reach
  this service", not "help yourself".
- **A free request is never quietly upgraded to a paid model.** If a free model fails,
  ALLAI will tell you rather than move your request somewhere that charges.

These rules aren't just claims — there are 30 automated tests, and the ones covering money
deliberately try to sneak a paid request through. See `test/budget.test.mjs`.

---

## About "uncensored"

ALLAI will never tell you a model is "completely uncensored", because for any hosted model
that isn't true and you'd find out the hard way.

What it does instead: the **Models** screen shows you, for every model, who provides it,
what that provider documents about its restrictions, whether the provider adds its own
moderation layer on top (OpenRouter publishes this per model, and ALLAI shows it), how big
its context is, and whether it handles images or tools.

ALLAI itself adds **no moderation layer of its own**. Whatever a model will or won't do is
between you and whoever runs it. Picking a provider that allows broader conversations is
made easy; pretending one exists when it doesn't is not.

---

## Your privacy

Everything is stored in your phone's browser and nothing else. There is no ALLAI server,
no account, and no analytics. Your messages go straight from your phone to whichever
provider you picked.

API keys are stored on your phone only. ALLAI only ever shows you the first and last few
characters of a key, never the whole thing.

**Settings → Delete everything** wipes the lot.

---

## For whoever works on the code next

The source is modular; the phone gets one flattened file.

```
allai/
  index.html              the page, used during development
  src/ui/                 screens and styling
  src/core/
    budget.js             the cost guard — every request passes through it
    chat.js               the single path all AI requests take
    storage.js            IndexedDB: settings, conversations, memory, characters, ledger
    providers/
      registry.js         what a "provider" and a "model" are
      openai-compat.js    transport for anything OpenAI-shaped
      pollinations.js     the free, keyless one
      openrouter.js       needs a key, off by default
      venice.js           needs a key, off by default
      custom.js           any endpoint you paste in, including a local one
  build/build-allai.js    flattens the above into dist/allai.html
  dist/allai.html         GENERATED — do not edit by hand
  test/                   30 offline tests plus a real-browser smoke test
```

```bash
npm test         # 30 tests, offline, about a second
npm run build    # regenerate dist/allai.html
npm run check    # fails if dist/allai.html is out of date
npm run serve    # serve the un-built source at localhost:8080
npm run smoke    # drive the built file in a real browser (needs Playwright + network)
```

No dependencies, by design. Node is only needed to run the build and the tests — never to
run ALLAI itself.

**`dist/allai.html` is generated.** Edit the files in `src/` and run `npm run build`.

Adding a provider means writing one file in `src/core/providers/` and importing it in
`src/ui/app.js`. Nothing else changes. See `docs/architecture.md` for why things are
built this way.
