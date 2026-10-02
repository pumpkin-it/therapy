// Ask: questions about clients answered from the records (services/ask.js). Mounted at /api/ask
// behind the `ask` permission; each person sees only their own conversations.
const router = require('express').Router();
const db = require('../database');
const perm = require('../middleware/requirePermission');
const { ask, config, AskError, filedClients, fileToClients, unfileFromClient, clientsOfSources, clientsLookedUp } = require('../services/ask');

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

router.get('/conversations', (req, res) => {
  const rows = db.prepare(`SELECT c.id, c.title, c.client_id, c.updated_at, cl.first_name || ' ' || cl.last_name AS client_name
    FROM ask_conversations c LEFT JOIN clients cl ON cl.id = c.client_id WHERE c.user_id = ? ORDER BY c.updated_at DESC LIMIT 50`).all(req.user.id);
  res.json(rows);
});

router.get('/conversations/:id', (req, res) => {
  const c = readable(Number(req.params.id), req.user);
  if (!c) return res.status(404).json({ error: 'Conversation not found' });
  const client = c.client_id && db.prepare("SELECT first_name || ' ' || last_name AS name FROM clients WHERE id = ?").get(c.client_id);
  res.json({
    id: c.id, title: c.title, client_id: c.client_id, client_name: client?.name || null, updated_at: c.updated_at,
    asked_by: c.asked_by, mine: c.user_id === req.user.id, clients: filedClients(c.id), turns: JSON.parse(c.turns_json),
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
