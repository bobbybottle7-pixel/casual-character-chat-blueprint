#!/usr/bin/env node
/*
 * Brave Search proxy — local version of worker.js for desktop use.
 * No dependencies. Needs Node 18+.
 *
 *   node brave-proxy/server.js                    key comes from the app
 *   BRAVE_API_KEY=... node brave-proxy/server.js  key kept on this machine
 *
 * Then put http://localhost:8787 into the app's "Search Proxy URL".
 */
import http from 'node:http';
import worker from './worker.js';

const PORT = Number(process.env.PORT) || 8787;
const env = { BRAVE_API_KEY: process.env.BRAVE_API_KEY, ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN };

http.createServer(async (req, res) => {
    try {
        const request = new Request(`http://localhost:${PORT}${req.url}`, { method: req.method, headers: req.headers });
        const response = await worker.fetch(request, env);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
        res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: String(err && err.message || err) }));
    }
}).listen(PORT, () => console.log(`Brave proxy listening on http://localhost:${PORT}`));
