import { fetchLeaderboard, rememberName, savedName, submitScore, type ScoreEntry } from './api';

export interface ResultOptions {
  won: boolean;
  score: number;
  goal: number;
  scoreLabel: string;
  durationMs: number;
  winTitle?: string;
  loseTitle?: string;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function renderBoard(list: HTMLOListElement, entries: ScoreEntry[], highlightId?: string): void {
  list.innerHTML = entries.length
    ? entries
        .map(
          (e) =>
            `<li${e.id === highlightId ? ' class="me"' : ''}><span>${escapeHtml(e.name)}</span><span>${e.score}${
              e.won ? ' 🏆' : ''
            } <small>${formatDuration(e.durationMs)}</small></span></li>`,
        )
        .join('')
    : '<li class="muted">No scores yet. Be the first!</li>';
}

/** Render the end-of-run panel: result, score submission form and top-5 leaderboard. */
export function showResults(panel: HTMLElement, opts: ResultOptions): void {
  const { won, score, goal, scoreLabel, durationMs } = opts;
  panel.hidden = false;
  panel.innerHTML = `
    <h2>${won ? opts.winTitle ?? '🏆 YOU WIN' : opts.loseTitle ?? '💥 GAME OVER'}</h2>
    <p>${escapeHtml(scoreLabel)}: <b>${score}</b> / ${goal} · Time ${formatDuration(durationMs)}</p>
    <form id="save-score" autocomplete="off">
      <input id="player-name" maxlength="20" placeholder="Your name" value="${escapeHtml(savedName())}" />
      <button type="submit" id="submit-score">SAVE SCORE</button>
    </form>
    <p id="board-status" class="muted">Loading leaderboard…</p>
    <ol id="board"></ol>
    <button id="restart">RESTART</button>`;

  const form = panel.querySelector<HTMLFormElement>('#save-score')!;
  const nameInput = panel.querySelector<HTMLInputElement>('#player-name')!;
  const submitBtn = panel.querySelector<HTMLButtonElement>('#submit-score')!;
  const status = panel.querySelector<HTMLElement>('#board-status')!;
  const board = panel.querySelector<HTMLOListElement>('#board')!;
  panel.querySelector<HTMLButtonElement>('#restart')!.onclick = () => location.reload();

  const refresh = async (highlightId?: string) => {
    try {
      renderBoard(board, await fetchLeaderboard(5), highlightId);
      status.textContent = 'Top 5';
    } catch {
      status.textContent = 'Leaderboard offline';
    }
  };
  void refresh();

  form.onsubmit = async (event) => {
    event.preventDefault();
    const name = nameInput.value.trim() || 'Player';
    rememberName(name);
    submitBtn.disabled = true;
    status.textContent = 'Saving…';
    try {
      const saved = await submitScore({ name, score, won, durationMs });
      status.textContent = saved.rank ? `Saved! You are ranked #${saved.rank}` : 'Saved!';
      form.hidden = true;
      await refresh(saved.id);
      status.textContent = saved.rank ? `Saved! You are ranked #${saved.rank}` : 'Saved!';
    } catch (err) {
      submitBtn.disabled = false;
      status.textContent = `Could not save: ${(err as Error).message}`;
    }
  };
}
