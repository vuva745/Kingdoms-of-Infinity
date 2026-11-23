import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const MAX_ENTRIES = 1000;

/** Sort: highest score first, then fastest run, then earliest submission. */
function compare(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  const da = a.durationMs ?? Number.MAX_SAFE_INTEGER;
  const db = b.durationMs ?? Number.MAX_SAFE_INTEGER;
  if (da !== db) return da - db;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

/**
 * Leaderboard store backed by a JSON file. Pass `null` for an in-memory store.
 * Writes are atomic (write to a temp file, then rename).
 */
export function createStore(file) {
  let entries = [];
  if (file && existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      if (Array.isArray(parsed)) entries = parsed.sort(compare);
    } catch {
      entries = [];
    }
  }

  function persist() {
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(entries, null, 2));
    renameSync(tmp, file);
  }

  return {
    add(entry) {
      const record = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...entry };
      entries.push(record);
      entries.sort(compare);
      if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
      persist();
      const index = entries.indexOf(record);
      return { ...record, rank: index === -1 ? null : index + 1 };
    },
    top(limit = 10) {
      return entries.slice(0, limit);
    },
    stats() {
      const wins = entries.filter((e) => e.won).length;
      return { runs: entries.length, wins, best: entries[0]?.score ?? 0 };
    },
    size() {
      return entries.length;
    },
  };
}
