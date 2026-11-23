import test from 'node:test';
import assert from 'node:assert/strict';
import { validateScore } from '../server/validate.js';

const config = { maxScore: 100, winScore: 100 };

test('normalises a valid submission', () => {
  const r = validateScore({ name: ' Zed\u0000 ', score: 42, won: false, durationMs: 10.4 }, config);
  assert.deepEqual(r, { ok: true, value: { name: 'Zed', score: 42, won: false, durationMs: 10 } });
});

test('defaults the name and duration', () => {
  const r = validateScore({ score: 0 }, config);
  assert.deepEqual(r, { ok: true, value: { name: 'Player', score: 0, won: false, durationMs: null } });
});

test('accepts a win at the win score', () => {
  assert.equal(validateScore({ score: 100, won: true }, config).ok, true);
});

test('collects every error at once', () => {
  const r = validateScore({ name: 'n'.repeat(30), score: -3, durationMs: 'x' }, config);
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 3);
});

test('rejects non-object bodies', () => {
  for (const body of [null, 'str', 7, [1]]) assert.equal(validateScore(body, config).ok, false);
});
