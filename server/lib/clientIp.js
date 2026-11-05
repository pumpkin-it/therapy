// The visitor's address. nginx passes it as X-Real-IP (not X-Forwarded-For, so req.ip is 127.0.0.1
// behind it). Only believed from nginx on this machine: anyone else could send the header themselves.
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
module.exports = req => (LOOPBACK.has(req.socket?.remoteAddress) && req.get('x-real-ip')) || req.ip || null;
