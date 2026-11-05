// Who is using Therapy: one row per person per minute they were active, for the Audit Log's
// "Who's on" view. Changes are recorded separately in audit_logs; this also covers viewing.
// Background checks from an open tab don't count, so an idle tab doesn't look like someone working.
const db = require('../database');
const clientIp = require('../lib/clientIp');

const BACKGROUND = /^\/(email\/(counts|outbox)|tasks\/counts)\/?$/;
const KEEP_MONTHS = 12;

const upsert = db.prepare(`
  INSERT INTO user_activity (user_id, minute, ip, page, client_id, requests, writes) VALUES (?, ?, ?, ?, ?, 1, ?)
  ON CONFLICT (user_id, minute) DO UPDATE SET
    requests = requests + 1, writes = writes + excluded.writes, ip = excluded.ip,
    page = COALESCE(excluded.page, page), client_id = COALESCE(excluded.client_id, client_id)
`);

// The screen they're on, from the browser's Referer: API paths alone say little (one screen loads many).
function pageOf(req) {
  try { return new URL(req.get('referer')).pathname.slice(0, 120); } catch { return null; }
}

function middleware(req, res, next) {
  try {
    if (req.user && !(req.method === 'GET' && BACKGROUND.test(req.path))) {
      const page = pageOf(req);
      const clientId = Number(page?.match(/^\/clients\/(\d+)/)?.[1] || req.query.client_id) || null;
      const minute = new Date().toISOString().slice(0, 16).replace('T', ' ');
      upsert.run(req.user.id, minute, clientIp(req), page, clientId, req.method === 'GET' ? 0 : 1);
    }
  } catch (e) { console.error('Activity log error:', e.message); } // never gets in the way of the request
  next();
}

function prune() {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - KEEP_MONTHS);
  db.prepare('DELETE FROM user_activity WHERE minute < ?').run(cutoff.toISOString().slice(0, 16).replace('T', ' '));
}

const toMinute = iso => new Date(iso).toISOString().slice(0, 16).replace('T', ' ');

// One line per person for the period, most recently active first.
function summary(from, to) {
  return db.prepare(`
    SELECT a.user_id, p.first_name || ' ' || p.last_name AS user_name, p.role,
      MIN(a.minute) AS first_minute, MAX(a.minute) AS last_minute, COUNT(*) AS active_minutes,
      SUM(a.writes) AS writes, GROUP_CONCAT(DISTINCT a.ip) AS ips
    FROM user_activity a LEFT JOIN practitioners p ON p.id = a.user_id
    WHERE a.minute >= ? AND a.minute < ?
    GROUP BY a.user_id ORDER BY last_minute DESC
  `).all(toMinute(from), toMinute(to));
}

// One person's minutes in the period, newest first.
function detail(userId, from, to) {
  return db.prepare(`
    SELECT a.minute, a.ip, a.page, a.writes, a.requests, a.client_id, c.first_name || ' ' || c.last_name AS client_name
    FROM user_activity a LEFT JOIN clients c ON c.id = a.client_id
    WHERE a.user_id = ? AND a.minute >= ? AND a.minute < ?
    ORDER BY a.minute DESC LIMIT 1440
  `).all(userId, toMinute(from), toMinute(to));
}

module.exports = { middleware, prune, summary, detail };
