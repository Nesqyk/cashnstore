// Tiny in-memory limiter: `max` requests per `windowMs` per IP. Good enough for one server;
// swap for a shared store if you ever run several copies of the app.
const { HttpError } = require('../lib/http');

function rateLimit({ windowMs, max, message = 'Too many requests. Please try again later.' }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
  }, windowMs);
  timer.unref();
  return (req, res, next) => {
    const now = Date.now();
    const h = hits.get(req.ip);
    if (!h || now - h.start > windowMs) { hits.set(req.ip, { start: now, n: 1 }); return next(); }
    h.n += 1;
    if (h.n > max) return next(new HttpError(429, message));
    next();
  };
}

module.exports = { rateLimit };
