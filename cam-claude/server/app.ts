import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conversationRoutes } from './routes/conversations.js';
import { characterRoutes } from './routes/characters.js';
import { detectAuth } from './agent/auth.js';
import { dbPath } from './store/db.js';

const here = dirname(fileURLToPath(import.meta.url));

/** The HTTP app, separated from startup so tests can mount it on any port. */
export function createApp() {
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

  return app;
}
