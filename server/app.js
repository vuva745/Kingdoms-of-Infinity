import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRateLimiter } from './rateLimit.js';
import { validateScore } from './validate.js';

export const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/**
 * Build the Express app. Everything that touches the outside world (store,
 * dist folder, rate limit) is injected so tests can run fully isolated.
 */
export function createApp({ store, config, distDir = join(projectRoot, 'dist'), rateLimit = {}, corsOrigin = process.env.CORS_ORIGIN }) {
  const app = express();
  const startedAt = Date.now();

  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY === '1');
  app.use(express.json({ limit: '10kb' }));

  if (corsOrigin) {
    app.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', corsOrigin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      next();
    });
  }

  const api = express.Router();

  api.get('/health', (_req, res) => {
    res.json({ ok: true, game: config.game, uptimeMs: Date.now() - startedAt, entries: store.size() });
  });

  api.get('/config', (_req, res) => res.json(config));

  api.get('/scores', (req, res) => {
    const limit = clampInt(req.query.limit, 1, 100, 10);
    res.json({ scores: store.top(limit) });
  });

  api.post('/scores', createRateLimiter(rateLimit), (req, res) => {
    const result = validateScore(req.body, config);
    if (!result.ok) return res.status(400).json({ errors: result.errors });
    res.status(201).json(store.add(result.value));
  });

  api.get('/stats', (_req, res) => res.json(store.stats()));

  api.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use('/api', api);

  // Serve the built game (vite build -> dist/) with an SPA fallback.
  if (existsSync(distDir)) {
    app.use(express.static(distDir, { index: 'index.html' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      res.sendFile(join(distDir, 'index.html'));
    });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
