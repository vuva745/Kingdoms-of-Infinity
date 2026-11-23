import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { config } from '../server/config.js';
import { createStore } from '../server/store.js';

async function startServer(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), `${config.game}-test-`));
  const file = join(dir, 'scores.json');
  const app = createApp({ store: createStore(file), config, distDir: join(dir, 'missing-dist'), rateLimit: { max: Infinity }, ...options });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    dir,
    file,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const post = (base, body) =>
  fetch(`${base}/api/scores`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('GET /api/health reports ok and game id', async () => {
  const s = await startServer();
  try {
    const res = await fetch(`${s.base}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.game, config.game);
    assert.equal(body.entries, 0);
  } finally {
    await s.close();
  }
});

test('GET /api/config returns the game config', async () => {
  const s = await startServer();
  try {
    const body = await (await fetch(`${s.base}/api/config`)).json();
    assert.equal(body.name, config.name);
    assert.equal(body.maxScore, config.maxScore);
    assert.equal(body.winScore, config.winScore);
  } finally {
    await s.close();
  }
});

test('POST /api/scores stores a valid score and returns rank', async () => {
  const s = await startServer();
  try {
    const res = await post(s.base, { name: '  Ace  ', score: 1, won: false, durationMs: 1234.6 });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.name, 'Ace');
    assert.equal(body.score, 1);
    assert.equal(body.won, false);
    assert.equal(body.durationMs, 1235);
    assert.equal(body.rank, 1);
    assert.ok(body.id);
    assert.ok(body.createdAt);
    const health = await (await fetch(`${s.base}/api/health`)).json();
    assert.equal(health.entries, 1);
  } finally {
    await s.close();
  }
});

test('POST /api/scores rejects invalid submissions', async () => {
  const s = await startServer();
  try {
    const cases = [
      [{}, /score/],
      [{ score: -1 }, /non-negative/],
      [{ score: 1.5 }, /integer/],
      [{ score: '5' }, /integer/],
      [{ score: config.maxScore + 1 }, /exceed/],
      [{ score: 0, won: true }, /win requires/],
      [{ score: 1, name: 'x'.repeat(21) }, /20 characters/],
      [{ score: 1, durationMs: -5 }, /durationMs/],
      [[1, 2], /JSON object/],
    ];
    for (const [body, pattern] of cases) {
      const res = await post(s.base, body);
      assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
      const { errors } = await res.json();
      assert.ok(errors.some((e) => pattern.test(e)), `expected ${pattern} in ${errors}`);
    }
    const malformed = await post(s.base, '{not json');
    assert.equal(malformed.status, 400);
    assert.match((await malformed.json()).error, /Invalid JSON/);
    assert.equal((await (await fetch(`${s.base}/api/health`)).json()).entries, 0);
  } finally {
    await s.close();
  }
});

test('GET /api/scores ranks by score desc, then fastest time, and honours limit', async () => {
  const s = await startServer();
  try {
    const top = Math.min(config.maxScore, 5);
    await post(s.base, { name: 'Slow', score: top, won: false, durationMs: 9000 });
    await post(s.base, { name: 'Low', score: 0, won: false, durationMs: 100 });
    await post(s.base, { name: 'Fast', score: top, won: false, durationMs: 3000 });
    await post(s.base, { name: 'Mid', score: Math.max(0, top - 1), won: false, durationMs: 1 });
    const { scores } = await (await fetch(`${s.base}/api/scores`)).json();
    assert.deepEqual(scores.map((e) => e.name), ['Fast', 'Slow', 'Mid', 'Low']);
    const limited = await (await fetch(`${s.base}/api/scores?limit=2`)).json();
    assert.equal(limited.scores.length, 2);
    const clamped = await (await fetch(`${s.base}/api/scores?limit=abc`)).json();
    assert.equal(clamped.scores.length, 4);
    const high = await (await fetch(`${s.base}/api/scores?limit=9999`)).json();
    assert.equal(high.scores.length, 4);
  } finally {
    await s.close();
  }
});

test('GET /api/stats aggregates runs, wins and best score', async () => {
  const s = await startServer();
  try {
    await post(s.base, { score: config.winScore, won: true, durationMs: 5000 });
    await post(s.base, { score: 0, won: false });
    const stats = await (await fetch(`${s.base}/api/stats`)).json();
    assert.deepEqual(stats, { runs: 2, wins: 1, best: config.winScore });
  } finally {
    await s.close();
  }
});

test('scores persist to disk and reload in a fresh store', async () => {
  const s = await startServer();
  try {
    await post(s.base, { name: 'Keeper', score: 1, won: false });
    const onDisk = JSON.parse(readFileSync(s.file, 'utf8'));
    assert.equal(onDisk.length, 1);
    const reloaded = createStore(s.file);
    assert.equal(reloaded.size(), 1);
    assert.equal(reloaded.top(1)[0].name, 'Keeper');
  } finally {
    await s.close();
  }
});

test('store tolerates a corrupt data file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'corrupt-'));
  const file = join(dir, 'scores.json');
  writeFileSync(file, '{oops');
  try {
    const store = createStore(file);
    assert.equal(store.size(), 0);
    store.add({ name: 'A', score: 1, won: false, durationMs: null });
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unknown /api routes return JSON 404', async () => {
  const s = await startServer();
  try {
    const res = await fetch(`${s.base}/api/nope`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'Not found' });
  } finally {
    await s.close();
  }
});

test('rate limiter returns 429 after the configured maximum', async () => {
  const s = await startServer({ rateLimit: { max: 2, windowMs: 60_000 } });
  try {
    assert.equal((await post(s.base, { score: 0 })).status, 201);
    assert.equal((await post(s.base, { score: 0 })).status, 201);
    const blocked = await post(s.base, { score: 0 });
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get('retry-after'));
  } finally {
    await s.close();
  }
});

test('serves the built game from dist with SPA fallback', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dist-'));
  const distDir = join(dir, 'dist');
  mkdirSync(distDir);
  writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>Game</title>');
  const s = await startServer({ distDir });
  try {
    const root = await fetch(`${s.base}/`);
    assert.equal(root.status, 200);
    assert.match(await root.text(), /<title>Game<\/title>/);
    const deep = await fetch(`${s.base}/some/client/route`);
    assert.equal(deep.status, 200);
    assert.match(await deep.text(), /<title>Game<\/title>/);
    assert.equal((await fetch(`${s.base}/api/missing`)).status, 404);
  } finally {
    await s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
