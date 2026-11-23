export interface ScoreEntry {
  id: string;
  name: string;
  score: number;
  won: boolean;
  durationMs: number | null;
  createdAt: string;
  rank?: number | null;
}

export interface GameConfig {
  game: string;
  name: string;
  scoreLabel: string;
  maxScore: number;
  winScore: number;
}

// Empty base = same origin (Vite proxy in dev, Express static hosting in prod).
const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(base + path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { errors?: string[]; error?: string };
      detail = (body.errors ?? (body.error ? [body.error] : [])).join(', ');
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export const fetchConfig = () => request<GameConfig>('/api/config');

export const fetchLeaderboard = (limit = 5) =>
  request<{ scores: ScoreEntry[] }>(`/api/scores?limit=${limit}`).then((r) => r.scores);

export const submitScore = (entry: { name: string; score: number; won: boolean; durationMs: number }) =>
  request<ScoreEntry>('/api/scores', { method: 'POST', body: JSON.stringify(entry) });

const NAME_KEY = 'playerName';
export function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}
export function rememberName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* storage unavailable */
  }
}
