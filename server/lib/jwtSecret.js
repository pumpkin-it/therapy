const crypto = require('crypto');

// Without JWT_SECRET there is no safe fixed fallback — a known default would let anyone forge
// tokens. Use a random per-process secret instead: nothing can be forged, the only cost is that
// every restart signs everyone out, which the warning below should get noticed and fixed.
let secret = process.env.JWT_SECRET;
if (!secret) {
  secret = crypto.randomBytes(48).toString('hex');
  console.error('WARNING: JWT_SECRET is not set — using a random secret for this process. Everyone is signed out on every restart. Set JWT_SECRET in .env.');
}

module.exports = secret;
