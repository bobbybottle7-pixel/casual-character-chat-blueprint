#!/usr/bin/env node
/*
 * All-in-one server for Casual Character Chat. No dependencies, Node 18+.
 *
 *   BRAVE_API_KEY=... node server.mjs
 *
 * - serves casual-character-chat-app/ at http://localhost:8787
 * - /api/chat         free AI replies (Pollinations, no key), or any
 *                     OpenAI-compatible API via CHAT_API_URL + CHAT_API_KEY
 * - /api/brave/search Brave web search with the key kept on the server
 *
 * The page gets window.CCC_SERVER, which makes the app pick the free model
 * and turn web search on by default, so a visitor needs no setup at all.
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import braveProxy from './brave-proxy/worker.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'casual-character-chat-app');
const PORT = Number(process.env.PORT) || 8787;
const BRAVE_API_KEY = process.env.BRAVE_API_KEY || '';
const CHAT_API_URL = process.env.CHAT_API_URL || 'https://text.pollinations.ai/openai';
const CHAT_API_KEY = process.env.CHAT_API_KEY || '';
const CHAT_MODEL = process.env.CHAT_MODEL || 'openai';
const CHAT_LABEL = process.env.CHAT_LABEL || 'Free AI (no key needed)';
const MAX_BODY = 4 * 1024 * 1024;

const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2',
};

const serverConfig = JSON.stringify({ chat: true, chatLabel: CHAT_LABEL, brave: !!BRAVE_API_KEY });
const CONFIG_TAG = `<script>window.CCC_SERVER=${serverConfig};</script>`;

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (c) => {
            size += c.length;
            if (size > MAX_BODY) { reject(new Error('Request too large')); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

function sendJson(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

async function handleChat(req, res) {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' });
    let body;
    try { body = JSON.parse((await readBody(req)).toString('utf8')); }
    catch (err) { return sendJson(res, 400, { error: String(err.message || err) }); }
    if (!Array.isArray(body.messages)) return sendJson(res, 400, { error: 'messages missing' });

    const upstreamBody = {
        model: CHAT_MODEL,
        messages: body.messages,
        stream: body.stream !== false,
        ...(typeof body.temperature === 'number' ? { temperature: body.temperature } : {}),
        ...(typeof body.top_p === 'number' ? { top_p: body.top_p } : {}),
        ...(typeof body.max_tokens === 'number' ? { max_tokens: body.max_tokens } : {}),
    };
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    let upstream;
    try {
        upstream = await fetch(CHAT_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(CHAT_API_KEY ? { 'Authorization': `Bearer ${CHAT_API_KEY}` } : {}),
            },
            body: JSON.stringify(upstreamBody),
            signal: controller.signal,
        });
    } catch (err) {
        if (controller.signal.aborted) return;
        return sendJson(res, 502, { error: { message: `AI provider unreachable: ${err.message || err}` } });
    }
    res.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') || 'application/json',
        'Cache-Control': 'no-cache',
    });
    if (!upstream.body) return res.end();
    try {
        for await (const chunk of upstream.body) res.write(chunk);
    } catch (_) { /* client went away */ }
    res.end();
}

async function handleBrave(req, res, url) {
    const request = new Request(`http://localhost${url.pathname.replace(/^\/api\/brave/, '')}${url.search}`, {
        method: req.method,
        headers: req.headers,
    });
    const response = await braveProxy.fetch(request, { BRAVE_API_KEY });
    res.writeHead(response.status, { 'Content-Type': 'application/json' });
    res.end(Buffer.from(await response.arrayBuffer()));
}

async function handleStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT + path.sep)) return sendJson(res, 403, { error: 'Forbidden' });
    let data;
    try { data = await fs.readFile(file); }
    catch { return sendJson(res, 404, { error: 'Not found' }); }
    const ext = path.extname(file).toLowerCase();
    if (ext === '.html') {
        data = Buffer.from(data.toString('utf8').replace(/<script/i, `${CONFIG_TAG}\n<script`));
    }
    res.writeHead(200, {
        'Content-Type': TYPES[ext] || 'application/octet-stream',
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(data);
}

http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
        if (url.pathname === '/api/chat') return await handleChat(req, res);
        if (url.pathname.startsWith('/api/brave/')) return await handleBrave(req, res, url);
        if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' });
        return await handleStatic(req, res, url);
    } catch (err) {
        if (!res.headersSent) sendJson(res, 500, { error: String(err.message || err) });
        else res.end();
    }
}).listen(PORT, () => {
    console.log(`Casual Character Chat on http://localhost:${PORT}`);
    console.log(`  AI: ${CHAT_API_URL} (${CHAT_MODEL})   Web search: ${BRAVE_API_KEY ? 'on' : 'off — set BRAVE_API_KEY'}`);
});
