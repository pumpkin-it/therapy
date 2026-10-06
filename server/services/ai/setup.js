// Starts the background job queue and registers its kinds of job. Called once from index.js.
const jobs = require('./jobs');
const docs = require('../documentText');

// Ask used to keep document text in /tmp/therapy-ask-cache. Copy what's there into the store once,
// so those documents aren't read again.
function importOldCache() {
  const fs = require('fs'), path = require('path'), db = require('../../database');
  const dir = process.env.ASK_CACHE || '/tmp/therapy-ask-cache';
  if (db.prepare("SELECT value FROM settings WHERE key = 'document_cache_imported'").get()?.value === '1') return;
  let n = 0;
  if (fs.existsSync(dir)) {
    const put = db.prepare("INSERT OR IGNORE INTO document_texts (key, status, text, chars) VALUES (?, ?, ?, ?)");
    db.transaction(() => {
      for (const name of fs.readdirSync(dir)) {
        const m = name.match(/^((?:file|notefile|att)-\d+|zip-\d+-(?:\d+|list))\.txt$/);
        if (!m) continue;
        const text = fs.readFileSync(path.join(dir, name), 'utf8');
        const none = text === '\u0000' || !text;
        put.run(m[1], none ? 'none' : 'ok', none ? null : text, none ? 0 : text.length);
        n++;
      }
    })();
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('document_cache_imported', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  if (n) console.log(`Document text store: imported ${n} cached documents`);
}

function start() {
  try { importOldCache(); } catch (e) { console.error('Document cache import error:', e.message); }
  // Read documents nobody has read yet: a sweep every 5 minutes queues one job per document
  // (or per backup zip), worked through one at a time so the server stays responsive.
  jobs.register('read_document', payload => docs.extract(payload), { concurrency: 1, maxAttempts: 2 });
  jobs.register('document_sweep', () => {
    const todo = docs.unread();
    for (const d of todo) jobs.enqueue('read_document', d, { dedupeKey: `read:${d.type}:${d.id}` });
    return { queued: todo.length };
  });
  jobs.every('document_sweep', 5 * 60 * 1000);
  jobs.start();
}

module.exports = { start };
