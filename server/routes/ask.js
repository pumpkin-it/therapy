// Ask: questions about clients answered from the records (services/ask.js). Mounted at /api/ask
// behind the `ask` permission; each person sees only their own conversations.
const router = require('express').Router();
const db = require('../database');
const perm = require('../middleware/requirePermission');
const { ask, config, AskError } = require('../services/ask');

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
  const c = db.prepare(`SELECT c.id, c.title, c.client_id, c.turns_json, c.updated_at, cl.first_name || ' ' || cl.last_name AS client_name
    FROM ask_conversations c LEFT JOIN clients cl ON cl.id = c.client_id WHERE c.id = ? AND c.user_id = ?`).get(req.params.id, req.user.id);
  if (!c) return res.status(404).json({ error: 'Conversation not found' });
  const { turns_json, ...rest } = c;
  res.json({ ...rest, turns: JSON.parse(turns_json) });
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
