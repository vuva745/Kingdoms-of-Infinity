/**
 * Minimal fixed-window, per-IP rate limiter (in-memory).
 * Returns an Express middleware. Pass `max: Infinity` to disable.
 */
export function createRateLimiter({ windowMs = 60_000, max = 30 } = {}) {
  const hits = new Map();

  function sweep(now) {
    for (const [key, bucket] of hits) if (bucket.resetAt <= now) hits.delete(key);
  }

  return function rateLimit(req, res, next) {
    if (!Number.isFinite(max)) return next();
    const now = Date.now();
    if (hits.size > 10_000) sweep(now);
    const key = req.ip ?? 'unknown';
    let bucket = hits.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      hits.set(key, bucket);
    }
    bucket.count += 1;
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests, slow down' });
    }
    next();
  };
}
