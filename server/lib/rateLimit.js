// Small in-memory limiter for the sign-in routes (one server process, so no shared store needed).
// hit(key) counts one attempt and returns the seconds to wait if the key is over its limit;
// blocked(key) is the same check without counting (for limits that only count failures).
function rateLimiter({ max, windowMs }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, windowMs).unref();
  return {
    hit(key) {
      const now = Date.now();
      let e = hits.get(key);
      if (!e || e.resetAt <= now) { e = { count: 0, resetAt: now + windowMs }; hits.set(key, e); }
      e.count++;
      return e.count > max ? Math.ceil((e.resetAt - now) / 1000) : 0;
    },
    blocked(key) {
      const e = hits.get(key);
      return e && e.resetAt > Date.now() && e.count >= max ? Math.ceil((e.resetAt - Date.now()) / 1000) : 0;
    },
    reset(key) { hits.delete(key); },
  };
}

module.exports = { rateLimiter };
