# Brave Search proxy (Cloudflare option)

The chat app's 🌐 web search uses the [Brave Search API](https://brave.com/search/api/).
Brave blocks direct calls from a browser (its CORS preflight returns 405), so
the app sends searches through this tiny proxy, which adds your key and the
CORS headers.

## Option A — the all-in-one server (easiest)

```bash
BRAVE_API_KEY=your-key node server.mjs
```

Run from the repo root (Node 18+, no install), then open
http://localhost:8787. It serves the app, a free AI model that needs no key,
and web search with the key kept on the server. Nothing to set up in the app;
🌐 is on by default.

## Option B — Cloudflare Worker (works on phones too, free tier)

```bash
cd brave-proxy
npx wrangler login
npx wrangler secret put BRAVE_API_KEY   # paste your key
npx wrangler deploy
```

Put the `https://brave-search-proxy.<you>.workers.dev` URL it prints into
**Search Proxy URL** and leave the key field in the app empty. With the key
stored as a secret, anyone with the URL can spend your quota, so set
`ALLOWED_ORIGIN` (in `wrangler.toml` under `[vars]`) to the site you host
the app on if it is public.

## Using it

Tap **🌐** next to the message box; it glows blue when on and flashes red if
a search fails (hover it for the reason). With it on, each message you send
or regenerate is searched first and the results go to the AI with your
message. **Safe Search** defaults to **Off**.

Web search only finds pages. Replies still come from the AI model you pick
in settings (e.g. OpenRouter), so you need a model key too.
