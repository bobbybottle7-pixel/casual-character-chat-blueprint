import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conversationRoutes } from './routes/conversations.js';
import { characterRoutes } from './routes/characters.js';
import { closeAll } from './agent/manager.js';
import { describeAuth, detectAuth } from './agent/auth.js';
import { dbPath } from './store/db.js';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8787);
/**
 * Loopback only, deliberately.
 *
 * This process holds your Claude credentials and, in Code mode, will edit files
 * and run commands in a folder you pick. Binding all interfaces would put that
 * on every network you join. Set CAM_CLAUDE_HOST to override if you genuinely
 * want to reach it from another machine — and put something in front of it if
 * you do.
 */
const host = process.env.CAM_CLAUDE_HOST?.trim() || '127.0.0.1';

const app = express();
// Character cards carry base64 avatars, so the default 100kb limit is too small.
app.use(express.json({ limit: '25mb' }));

app.use('/api', conversationRoutes);
app.use('/api', characterRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, auth: detectAuth(), db: dbPath });
});

app.use(express.static(join(here, '..', 'web')));

// Any unmatched non-API path renders the app shell.
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(join(here, '..', 'web', 'index.html'));
});

const auth = detectAuth();
const server = app.listen(port, host, () => {
  console.log('');
  console.log('  Cam Claude');
  console.log(`  ${describeAuth(auth)}`);
  console.log(`  db:   ${dbPath}`);
  console.log(`  open: http://localhost:${port}${host === '127.0.0.1' ? '' : `  (bound to ${host})`}`);
  console.log('');
  if (auth.kind === 'unknown') {
    console.log('  No credentials found in the usual places. If your setup supplies them');
    console.log('  another way this is fine — otherwise the first message will tell you.');
    console.log(`  ${auth.fix}`);
    console.log('');
  }
});

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n  Port ${port} is already in use — Cam Claude may already be running.`);
    console.error(`  Open http://localhost:${port}, or start this one elsewhere with PORT=8788 npm run dev\n`);
    process.exit(1);
  }
  if (error.code === 'EACCES') {
    console.error(`\n  Not allowed to bind ${host}:${port}. Ports below 1024 need elevated privileges.\n`);
    process.exit(1);
  }
  throw error;
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    closeAll();
    server.close(() => process.exit(0));
  });
}
