// Background jobs: AI and document work done outside anyone's request (reading documents now;
// email filing, fact extraction and nightly snapshots later), kept in ai_jobs so nothing is lost
// on a restart.
//
//   register(kind, handler, { concurrency, maxAttempts }) — handler(payload, job) does the work and
//     may return a small result object (saved with the job)
//   enqueue(kind, payload, { dedupeKey, runAfter, priority }) — a dedupeKey already waiting or
//     running is not queued again
//   every(kind, ms, payload) — queue a job on a timer (e.g. a sweep)
//
// A failed job is tried again after 1, 5 and then 30 minutes, up to its max attempts. A job stopped
// by an AI spending limit waits 6 hours without using up an attempt. Jobs running when the server
// stopped go back in the queue on start-up.
const db = require('../../database');

const handlers = {};
const running = {};
let timer = null;
let ticking = false;
const BACKOFF_MIN = [1, 5, 30];

function register(kind, handler, { concurrency = 1, maxAttempts = 3 } = {}) {
  handlers[kind] = { handler, concurrency, maxAttempts };
  running[kind] = running[kind] || 0;
}

const insertJob = db.prepare(`INSERT OR IGNORE INTO ai_jobs (kind, payload_json, dedupe_key, priority, max_attempts, run_after)
  VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`);
function enqueue(kind, payload = {}, { dedupeKey = null, runAfter = null, priority = 0 } = {}) {
  const maxAttempts = handlers[kind]?.maxAttempts || 3;
  const r = insertJob.run(kind, JSON.stringify(payload), dedupeKey, priority, maxAttempts, runAfter);
  return r.changes ? r.lastInsertRowid : null;
}

const pick = db.prepare("SELECT * FROM ai_jobs WHERE status = 'queued' AND kind = ? AND run_after <= datetime('now') ORDER BY priority DESC, id LIMIT ?");
const claim = db.prepare("UPDATE ai_jobs SET status = 'running', started_at = datetime('now'), attempts = attempts + 1 WHERE id = ? AND status = 'queued'");
const finish = db.prepare("UPDATE ai_jobs SET status = 'done', finished_at = datetime('now'), result_json = ?, last_error = NULL WHERE id = ?");
const retry = db.prepare("UPDATE ai_jobs SET status = 'queued', run_after = datetime('now', ?), last_error = ? WHERE id = ?");
const fail = db.prepare("UPDATE ai_jobs SET status = 'failed', finished_at = datetime('now'), last_error = ? WHERE id = ?");
const unclaim = db.prepare("UPDATE ai_jobs SET status = 'queued', attempts = attempts - 1, run_after = datetime('now', '+6 hours'), last_error = ? WHERE id = ?");

async function runJob(job) {
  const h = handlers[job.kind];
  running[job.kind]++;
  try {
    const result = await h.handler(JSON.parse(job.payload_json || '{}'), job);
    finish.run(result == null ? null : JSON.stringify(result).slice(0, 2000), job.id);
  } catch (e) {
    const msg = String(e.message || e).slice(0, 500);
    if (e.aiLimit) unclaim.run(msg, job.id);
    else if (job.attempts + 1 >= job.max_attempts) { fail.run(msg, job.id); console.error(`Job ${job.kind} #${job.id} failed:`, msg); }
    else retry.run(`+${BACKOFF_MIN[Math.min(job.attempts, BACKOFF_MIN.length - 1)]} minutes`, msg, job.id);
  } finally {
    running[job.kind]--;
  }
}

// Start whatever is due, up to each kind's concurrency. Jobs run in the background; the next tick
// starts more as slots free up.
function tick() {
  if (ticking) return;
  ticking = true;
  try {
    for (const [kind, h] of Object.entries(handlers)) {
      const free = h.concurrency - running[kind];
      if (free <= 0) continue;
      for (const job of pick.all(kind, free)) {
        if (claim.run(job.id).changes) runJob(job);
      }
    }
  } catch (e) {
    console.error('Job queue error:', e.message);
  } finally {
    ticking = false;
  }
}

function every(kind, ms, payload = {}) {
  const queue = () => { try { enqueue(kind, payload, { dedupeKey: `every:${kind}` }); } catch (e) { console.error(`Job ${kind} schedule error:`, e.message); } };
  setTimeout(queue, 20 * 1000);
  setInterval(queue, ms);
}

function start({ intervalMs = 3000 } = {}) {
  if (timer) return;
  // Jobs cut off by a restart go back in the queue (their attempt doesn't count).
  db.prepare("UPDATE ai_jobs SET status = 'queued', attempts = MAX(attempts - 1, 0) WHERE status = 'running'").run();
  timer = setInterval(tick, intervalMs);
  // Finished jobs are kept 30 days, failed ones 90, for looking back.
  const prune = () => { try { db.prepare("DELETE FROM ai_jobs WHERE (status = 'done' AND finished_at < datetime('now', '-30 days')) OR (status = 'failed' AND finished_at < datetime('now', '-90 days'))").run(); } catch {} };
  prune();
  setInterval(prune, 24 * 60 * 60 * 1000);
}

function stats() {
  const rows = db.prepare('SELECT kind, status, COUNT(*) AS n FROM ai_jobs GROUP BY kind, status').all();
  const out = {};
  for (const r of rows) (out[r.kind] = out[r.kind] || { queued: 0, running: 0, done: 0, failed: 0 })[r.status] = r.n;
  const recentFailures = db.prepare("SELECT id, kind, last_error, finished_at FROM ai_jobs WHERE status = 'failed' ORDER BY id DESC LIMIT 5").all();
  return { kinds: out, recent_failures: recentFailures };
}

module.exports = { register, enqueue, every, start, tick, stats };
