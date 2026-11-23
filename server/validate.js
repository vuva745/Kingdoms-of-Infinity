const MAX_NAME_LENGTH = 20;

/**
 * Validate a score submission against the game config.
 * Returns `{ ok: true, value }` with a normalised record, or `{ ok: false, errors }`.
 */
export function validateScore(body, config) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: ['body must be a JSON object'] };
  }
  const errors = [];

  let name = typeof body.name === 'string' ? body.name.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
  if (!name) name = 'Player';
  if (name.length > MAX_NAME_LENGTH) errors.push(`name must be ${MAX_NAME_LENGTH} characters or fewer`);

  const score = typeof body.score === 'number' ? body.score : NaN;
  if (!Number.isInteger(score) || score < 0) errors.push('score must be a non-negative integer');
  else if (score > config.maxScore) errors.push(`score cannot exceed ${config.maxScore}`);

  const won = body.won === true;
  if (won && config.winScore != null && Number.isInteger(score) && score < config.winScore) {
    errors.push(`a win requires a score of at least ${config.winScore}`);
  }

  let durationMs = null;
  if (body.durationMs !== undefined && body.durationMs !== null) {
    const d = typeof body.durationMs === 'number' ? body.durationMs : NaN;
    if (!Number.isFinite(d) || d < 0) errors.push('durationMs must be a non-negative number');
    else durationMs = Math.round(d);
  }

  return errors.length ? { ok: false, errors } : { ok: true, value: { name, score, won, durationMs } };
}
