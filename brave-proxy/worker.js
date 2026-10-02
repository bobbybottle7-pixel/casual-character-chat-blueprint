/*
 * Brave Search proxy — Cloudflare Worker.
 *
 * Brave's API rejects the CORS preflight a browser sends for the
 * X-Subscription-Token header, so the chat app cannot call it directly.
 * This worker takes the request from the app, adds the key and returns
 * Brave's JSON with CORS headers.
 *
 * The key comes from the BRAVE_API_KEY secret (`npx wrangler secret put
 * BRAVE_API_KEY`), or from the X-Brave-Key header the app sends when no
 * secret is set. Set ALLOWED_ORIGIN to lock the proxy to one site.
 */
const BRAVE_URL = 'https://api.search.brave.com/res/v1/web/search';
const PASSTHROUGH = ['q', 'count', 'safesearch', 'country', 'search_lang', 'freshness', 'offset'];

function corsHeaders(env) {
    return {
        'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'X-Brave-Key, Content-Type',
        'Access-Control-Max-Age': '86400',
    };
}

export default {
    async fetch(request, env) {
        const cors = corsHeaders(env);
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

        const url = new URL(request.url);
        if (request.method !== 'GET' || !url.pathname.endsWith('/search')) {
            return Response.json({ error: 'Use GET /search?q=...' }, { status: 404, headers: cors });
        }
        const key = env.BRAVE_API_KEY || request.headers.get('X-Brave-Key');
        if (!key) return Response.json({ error: 'No Brave API key configured.' }, { status: 401, headers: cors });
        if (!url.searchParams.get('q')) return Response.json({ error: 'Missing q.' }, { status: 400, headers: cors });

        const upstream = new URL(BRAVE_URL);
        for (const name of PASSTHROUGH) {
            const value = url.searchParams.get(name);
            if (value) upstream.searchParams.set(name, value);
        }
        const res = await fetch(upstream, {
            headers: { 'Accept': 'application/json', 'X-Subscription-Token': key },
        });
        return new Response(res.body, {
            status: res.status,
            headers: { ...cors, 'Content-Type': 'application/json' },
        });
    },
};
