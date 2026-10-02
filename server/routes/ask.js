// Ask: questions about clients answered from the records (services/ask.js). Mounted at /api/ask
// behind the `ask` permission; each person sees only their own conversations.
const router = require('express').Router();
const db = require('../database');
const perm = require('../middleware/requirePermission');
const { ask, config, AskError, filedClients, fileToClients, unfileFromClient, clientsOfSources, clientsLookedUp } = require('../services/ask');

// A restart in the middle of an answer leaves it "answering" forever; mark those as interrupted.
for (const c of db.prepare("SELECT id, turns_json FROM ask_conversations WHERE status = 'answering'").all()) {
  const turns = JSON.parse(c.turns_json || '[]').map(t => (t.pending ? { question: t.question, asked_at: t.asked_at, answer: 'This question was interrupted (Therapy restarted). Please ask it again.', failed: true, sources: [], at: new Date().toISOString() } : t));
  db.prepare("UPDATE ask_conversations SET turns_json = ?, status = 'done' WHERE id = ?").run(JSON.stringify(turns), c.id);
}

// One-time: file conversations from before filing existed to their clients.
if (db.prepare("SELECT value FROM settings WHERE key = 'ask_filing_backfilled'").get()?.value !== '4') {
  db.transaction(() => {
    // Re-run with v4's rule: inactive (past) clients are filed too, unless an active client of the
    // same name is in the conversation.
    for (const c of db.prepare('SELECT id, user_id, client_id, turns_json, messages_json FROM ask_conversations').all()) {
      if (c.client_id) fileToClients(c.id, [c.client_id], 'started', c.user_id);
      const sources = JSON.parse(c.turns_json || '[]').flatMap(t => t.sources || []);
      fileToClients(c.id, clientsOfSources(sources), 'cited', c.user_id);
      fileToClients(c.id, clientsLookedUp(JSON.parse(c.messages_json || '[]')), 'looked_up', c.user_id);
    }
    db.prepare("INSERT INTO settings (key, value) VALUES ('ask_filing_backfilled', '4') ON CONFLICT(key) DO UPDATE SET value = '4'").run();
  })();
}

// A conversation can be read by whoever asked it, and — once it's filed to a client — by
// everyone with Ask access (it's part of that client's record). Only the asker can continue it.
function readable(id, user) {
  const c = db.prepare(`SELECT c.*, p.first_name || ' ' || p.last_name AS asked_by FROM ask_conversations c
    LEFT JOIN practitioners p ON p.id = c.user_id WHERE c.id = ?`).get(id);
  if (!c) return null;
  if (c.user_id === user.id) return c;
  return db.prepare('SELECT 1 FROM ask_conversation_clients WHERE conversation_id = ? AND removed_at IS NULL').get(id) ? c : null;
}

router.get('/status', (req, res) => {
  const c = config();
  res.json({ model_label: c.model_label, limit_usd: c.limit_usd, spent_usd: c.spent_usd, can_email: perm.hasPermission(req.user, 'email') });
});

// Past conversations: ?scope=mine (default) or ?scope=filed (everyone's, filed to a client),
// ?q= words in the questions or answers, ?client_id= filed to that client.
router.get('/conversations', (req, res) => {
  const where = [];
  const params = [];
  const filed = 'EXISTS (SELECT 1 FROM ask_conversation_clients f WHERE f.conversation_id = c.id AND f.removed_at IS NULL';
  if (req.query.scope === 'filed') where.push(`(c.user_id = ? OR ${filed}))`); else where.push('c.user_id = ?');
  params.push(req.user.id);
  if (Number(req.query.client_id)) { where.push(`${filed} AND f.client_id = ?)`); params.push(Number(req.query.client_id)); }
  const q = String(req.query.q || '').trim().toLowerCase();
  const words = q.split(/\s+/).filter(w => w.length > 1).slice(0, 6);
  for (const w of words) { where.push('(lower(c.title) LIKE ? OR lower(c.turns_json) LIKE ?)'); params.push(`%${w}%`, `%${w}%`); }
  const rows = db.prepare(`SELECT c.id, c.title, c.user_id, c.status, c.updated_at, c.turns_json, p.first_name || ' ' || p.last_name AS asked_by,
      (SELECT group_concat(cl.first_name || ' ' || cl.last_name, ', ') FROM ask_conversation_clients f JOIN clients cl ON cl.id = f.client_id
        WHERE f.conversation_id = c.id AND f.removed_at IS NULL) AS client_names
    FROM ask_conversations c LEFT JOIN practitioners p ON p.id = c.user_id
    WHERE ${where.join(' AND ')} ORDER BY c.updated_at DESC LIMIT 100`).all(...params);
  // With a search, show where it matched: a short piece of the first question or answer containing it.
  const snippetOf = turns => {
    if (!words.length) return null;
    for (const t of turns) for (const text of [t.question, t.answer]) {
      const low = String(text || '').toLowerCase();
      const i = low.indexOf(words[0]);
      if (i >= 0) return `${i > 40 ? '…' : ''}${String(text).slice(Math.max(0, i - 40), i + 100).replace(/\[(\w+) [\d:]+\]/g, '').replace(/\s+/g, ' ').trim()}…`;
    }
    return null;
  };
  res.json(rows.map(({ turns_json, user_id, ...r }) => ({ ...r, mine: user_id === req.user.id, match: snippetOf(JSON.parse(turns_json || '[]')) })));
});

// "Already answered?" — before running a new question, find earlier questions (yours, or filed to
// a client) that ask much the same thing. Plain word matching, no AI, so it costs nothing.
const STOP = new Set('a an the and or of to for in on at by with from is are was were be been did does do has have had what which who whom when where why how her his him she he they them their it its this that these those there any some about please can could would should will me my we our you your up out into over'.split(' '));
const wordsOf = text => [...new Set(String(text || '').toLowerCase().replace(/\[(\w+) [\d:]+\]/g, ' ').split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2 && !STOP.has(w)))];
// Questions about the current state of something go stale; their earlier answers are flagged.
const STATUS_WORDS = /\b(delivered|delivery|approved|approval|booked|booking|status|latest|current|currently|now|yet|still|recent|recently|next|upcoming|outstanding|pending|paid|due)\b/i;

router.get('/similar', (req, res) => {
  const qWords = wordsOf(req.query.q);
  if (qWords.length < 2) return res.json([]);
  const scopeClient = Number(req.query.client_id) || null;
  const rows = db.prepare(`SELECT c.id, c.user_id, c.updated_at, c.turns_json, p.first_name || ' ' || p.last_name AS asked_by,
      (SELECT group_concat(f.client_id) FROM ask_conversation_clients f WHERE f.conversation_id = c.id AND f.removed_at IS NULL) AS client_ids,
      (SELECT group_concat(cl.first_name || ' ' || cl.last_name, ', ') FROM ask_conversation_clients f JOIN clients cl ON cl.id = f.client_id
        WHERE f.conversation_id = c.id AND f.removed_at IS NULL) AS client_names
    FROM ask_conversations c LEFT JOIN practitioners p ON p.id = c.user_id
    WHERE c.user_id = ? OR EXISTS (SELECT 1 FROM ask_conversation_clients f WHERE f.conversation_id = c.id AND f.removed_at IS NULL)
    ORDER BY c.updated_at DESC LIMIT 500`).all(req.user.id);
  const matches = [];
  for (const r of rows) {
    const clientIds = String(r.client_ids || '').split(',').filter(Boolean).map(Number);
    const nameWords = wordsOf(r.client_names);
    // Same client: either the question was asked from that client's page, or it names them.
    const sameClient = (scopeClient && clientIds.includes(scopeClient)) || nameWords.some(w => qWords.includes(w));
    JSON.parse(r.turns_json || '[]').forEach((t, i) => {
      if (t.pending || t.failed) return;
      const tWords = wordsOf(t.question);
      const shared = qWords.filter(w => tWords.includes(w));
      // How much of the new question the earlier one covers (a short new question can match a
      // longer earlier one), nudged down when the earlier question was about a lot more.
      const coverage = shared.length / qWords.length;
      const score = coverage - 0.05 * Math.max(0, tWords.length - qWords.length) + (sameClient ? 0.25 : 0);
      if (shared.length >= 2 && (sameClient ? coverage >= 0.6 : coverage >= 0.85)) {
        matches.push({ conversation_id: r.id, turn: i, score, question: t.question, at: t.at || r.updated_at, asked_by: r.asked_by, mine: r.user_id === req.user.id,
          clients: r.client_names, preview: String(t.answer || '').replace(/\[(\w+) [\d:]+\]/g, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().slice(0, 240),
          may_be_out_of_date: STATUS_WORDS.test(req.query.q) || STATUS_WORDS.test(t.question) });
      }
    });
  }
  // Best match per conversation, and only the newest of identical questions; best three overall.
  const best = new Map();
  const seenQuestion = new Set();
  for (const m of matches.sort((a, b) => b.score - a.score || String(b.at).localeCompare(String(a.at)))) {
    const same = m.question.trim().toLowerCase();
    if (best.has(m.conversation_id) || seenQuestion.has(same)) continue;
    best.set(m.conversation_id, m);
    seenQuestion.add(same);
  }
  res.json([...best.values()].slice(0, 3).map(({ score, ...m }) => m));
});

// Clients that have Ask conversations this person can see, for the client filter.
router.get('/clients', (req, res) => {
  res.json(db.prepare(`SELECT DISTINCT cl.id, cl.first_name || ' ' || cl.last_name AS name, cl.active FROM ask_conversation_clients f
    JOIN clients cl ON cl.id = f.client_id JOIN ask_conversations c ON c.id = f.conversation_id
    WHERE f.removed_at IS NULL ORDER BY cl.first_name, cl.last_name`).all());
});

router.get('/conversations/:id', (req, res) => {
  const c = readable(Number(req.params.id), req.user);
  if (!c) return res.status(404).json({ error: 'Conversation not found' });
  const client = c.client_id && db.prepare("SELECT first_name || ' ' || last_name AS name FROM clients WHERE id = ?").get(c.client_id);
  res.json({
    id: c.id, title: c.title, client_id: c.client_id, client_name: client?.name || null, updated_at: c.updated_at,
    asked_by: c.asked_by, mine: c.user_id === req.user.id, status: c.status, clients: filedClients(c.id), turns: JSON.parse(c.turns_json),
  });
});

// Change which clients a conversation is filed to: { add: [clientId], remove: [clientId] }.
router.post('/conversations/:id/clients', (req, res) => {
  const c = readable(Number(req.params.id), req.user);
  if (!c) return res.status(404).json({ error: 'Conversation not found' });
  const ids = list => (Array.isArray(list) ? list.map(Number).filter(Boolean) : []);
  db.transaction(() => {
    fileToClients(c.id, ids(req.body.add), 'manual', req.user.id);
    for (const cid of ids(req.body.remove)) unfileFromClient(c.id, cid, req.user.id);
  })();
  res.json({ clients: filedClients(c.id) });
});

// Ask conversations filed to one client, newest first (the client's Communications tab).
router.get('/client/:clientId', (req, res) => {
  const rows = db.prepare(`SELECT c.id, c.title, c.updated_at, c.turns_json, p.first_name || ' ' || p.last_name AS asked_by, c.user_id = ? AS mine
    FROM ask_conversation_clients l JOIN ask_conversations c ON c.id = l.conversation_id LEFT JOIN practitioners p ON p.id = c.user_id
    WHERE l.client_id = ? AND l.removed_at IS NULL ORDER BY c.updated_at DESC`).all(req.user.id, Number(req.params.clientId));
  res.json(rows.map(({ turns_json, ...r }) => ({ ...r, questions: JSON.parse(turns_json || '[]').length, mine: !!r.mine })));
});

// A document inside an old-system backup zip, opened from an answer's source link.
router.get('/zip-entry/:fileId/:index', async (req, res) => {
  try {
    const doc = await require('../services/askTools').zipEntryFile(Number(req.params.fileId), Number(req.params.index));
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    const ext = (doc.name.split('.').pop() || '').toLowerCase();
    res.setHeader('Content-Type', { pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', html: 'text/html', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' }[ext] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(doc.name)}`);
    res.send(doc.buffer);
  } catch (e) {
    console.error('Ask zip entry error:', e.message);
    res.status(500).json({ error: 'Could not open this document' });
  }
});

// Answers stream back as server-sent events: status lines while records are searched, the
// answer text as it's written, then one "done" (or "error") event.
router.post('/', async (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const send = data => res.write(`data: ${JSON.stringify(data)}\n\n`);
  try {
    const result = await ask({
      user: req.user,
      question: req.body.question,
      conversationId: req.body.conversation_id || null,
      clientId: req.body.client_id || null,
      canEmail: perm.hasPermission(req.user, 'email'),
    }, send);
    send({ type: 'done', ...result });
  } catch (e) {
    const message = e instanceof AskError ? e.message : 'Ask is not available right now. Please try again later.';
    if (!(e instanceof AskError)) console.error('Ask error:', e.status || '', e.message);
    send({ type: 'error', error: message });
  }
  res.end();
});

module.exports = router;
