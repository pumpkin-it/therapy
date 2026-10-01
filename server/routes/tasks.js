// The to-do list (services/tasks.js). Needs the Email permission (index.js).
const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');
const tasks = require('../services/tasks');

const PAGE = 100;
const STATUSES = ['todo', 'waiting', 'done'];
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const clientName = c => `${c.first_name} ${c.last_name}`.trim() + (c.active === 0 ? ' - INACTIVE' : '');

function clientsFor(ids) {
  const out = new Map(ids.map(id => [id, []]));
  if (!ids.length) return out;
  for (const r of db.prepare(`SELECT tc.task_id, c.id, c.first_name, c.last_name, c.active FROM task_clients tc JOIN clients c ON c.id = tc.client_id
    WHERE tc.task_id IN (${ids.map(() => '?').join(',')}) ORDER BY c.first_name, c.last_name`).all(...ids)) {
    out.get(r.task_id).push({ id: r.id, name: clientName(r) });
  }
  return out;
}

const TASK_COLS = `t.*, p.first_name || ' ' || p.last_name AS assigned_name,
  (SELECT COUNT(*) FROM email_messages m WHERE m.task_id = t.id) AS email_count,
  (SELECT detail FROM task_events e WHERE e.task_id = t.id ORDER BY e.id DESC LIMIT 1) AS last_event`;

// ?status=todo|waiting|done  &assigned=me|unassigned|<user id>  &client_id=  &q=  &page=
router.get('/', auth, (req, res) => {
  const status = STATUSES.includes(req.query.status) ? req.query.status : 'todo';
  const where = ['t.status = ?'];
  const params = [status];
  if (req.query.assigned === 'me') { where.push('t.assigned_to = ?'); params.push(req.user.id); }
  else if (req.query.assigned === 'unassigned') where.push('t.assigned_to IS NULL');
  else if (Number(req.query.assigned)) { where.push('t.assigned_to = ?'); params.push(Number(req.query.assigned)); }
  if (Number(req.query.client_id)) { where.push('t.id IN (SELECT task_id FROM task_clients WHERE client_id = ?)'); params.push(Number(req.query.client_id)); }
  if (req.query.q) { where.push('(t.title LIKE ? OR t.next_step LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const page = Math.max(1, Number(req.query.page) || 1);
  const w = `WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) n FROM tasks t ${w}`).get(...params).n;
  // To do: oldest first (longest waiting for us). Waiting: soonest follow-up first. Done: newest.
  const order = status === 'todo' ? 't.updated_at ASC' : status === 'waiting' ? 't.follow_up_at ASC, t.updated_at ASC' : 't.done_at DESC';
  const rows = db.prepare(`SELECT ${TASK_COLS} FROM tasks t LEFT JOIN practitioners p ON p.id = t.assigned_to ${w} ORDER BY ${order}, t.id LIMIT ? OFFSET ?`)
    .all(...params, PAGE, (page - 1) * PAGE);
  const c = clientsFor(rows.map(r => r.id));
  res.json({ rows: rows.map(r => ({ ...r, clients: c.get(r.id) })), total, page });
});

router.get('/counts', auth, (req, res) => {
  const n = (sql, ...p) => db.prepare(sql).get(...p).n;
  res.json({
    todo: n("SELECT COUNT(*) n FROM tasks WHERE status = 'todo'"),
    todo_mine: n("SELECT COUNT(*) n FROM tasks WHERE status = 'todo' AND assigned_to = ?", req.user.id),
    todo_unassigned: n("SELECT COUNT(*) n FROM tasks WHERE status = 'todo' AND assigned_to IS NULL"),
    waiting: n("SELECT COUNT(*) n FROM tasks WHERE status = 'waiting'"),
  });
});

router.get('/assignees', auth, (req, res) => {
  res.json(db.prepare("SELECT id, first_name || ' ' || last_name AS name FROM practitioners WHERE active = 1 ORDER BY first_name, last_name").all());
});

function loadTask(id) {
  const t = db.prepare(`SELECT ${TASK_COLS} FROM tasks t LEFT JOIN practitioners p ON p.id = t.assigned_to WHERE t.id = ?`).get(id);
  if (!t) return null;
  const emails = db.prepare(`SELECT id, direction, from_name, from_address, subject, snippet, received_at, status FROM email_messages
    WHERE task_id = ? ORDER BY received_at`).all(id);
  const events = db.prepare(`SELECT e.*, p.first_name || ' ' || p.last_name AS actor_name FROM task_events e
    LEFT JOIN practitioners p ON p.id = e.actor_id WHERE e.task_id = ? ORDER BY e.id DESC`).all(id);
  return { ...t, clients: clientsFor([t.id]).get(t.id), emails, events };
}

router.get('/:id', auth, (req, res) => {
  const t = loadTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  res.json(t);
});

function validClients(ids) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Boolean))];
  if (!list.length) return list;
  const found = db.prepare(`SELECT id FROM clients WHERE merged_into IS NULL AND id IN (${list.map(() => '?').join(',')})`).all(...list).map(r => r.id);
  return found.length === list.length ? list : null;
}
function validAssignee(id) {
  if (!id) return null;
  return db.prepare('SELECT id FROM practitioners WHERE id = ? AND active = 1').get(id)?.id ?? undefined;
}

// New task: by hand (title required), or for an email (message_id; title defaults to its subject).
router.post('/', auth, (req, res) => {
  const b = req.body;
  const msg = b.message_id ? db.prepare('SELECT * FROM email_messages WHERE id = ?').get(b.message_id) : null;
  if (b.message_id && !msg) return res.status(404).json({ error: 'Email not found' });
  if (msg?.task_id) return res.status(409).json({ error: 'That email already has a task', task_id: msg.task_id });
  const title = String(b.title || (msg ? tasks.cleanTitle(msg.subject) : '')).trim();
  if (!title) return res.status(400).json({ error: 'Give the task a title' });
  const status = STATUSES.includes(b.status) ? b.status : 'todo';
  if (b.follow_up_at && !YMD.test(b.follow_up_at)) return res.status(400).json({ error: 'Follow-up date is not valid' });
  const clientIds = validClients(b.client_ids);
  if (!clientIds) return res.status(400).json({ error: 'Unknown client' });
  const assignee = validAssignee(b.assigned_to);
  if (assignee === undefined) return res.status(400).json({ error: 'Unknown person' });
  const id = db.transaction(() => {
    const thread = msg ? (msg.conversation_id
      ? db.prepare('SELECT id FROM email_messages WHERE mailbox = ? AND conversation_id = ? AND task_id IS NULL').all(msg.mailbox, msg.conversation_id).map(r => r.id)
      : [msg.id]) : [];
    const emailClients = thread.length ? db.prepare(`SELECT DISTINCT client_id FROM email_message_clients WHERE removed_at IS NULL AND message_id IN (${thread.map(() => '?').join(',')})`).all(...thread).map(r => r.client_id) : [];
    return tasks.create({
      title, nextStep: String(b.next_step || '').trim() || null, status, assignedTo: assignee, followUpAt: b.follow_up_at || (status === 'waiting' ? tasks.addWorkingDays() : null),
      clientIds: [...new Set([...clientIds, ...emailClients])], source: msg ? 'email' : 'manual', createdBy: req.user.id, messageIds: thread,
      detail: msg ? 'Created from an email' : 'Created',
    });
  })();
  res.status(201).json(loadTask(id));
});

router.patch('/:id', auth, (req, res) => {
  const b = req.body;
  const patch = {};
  if (b.title !== undefined) { if (!String(b.title).trim()) return res.status(400).json({ error: 'Give the task a title' }); patch.title = String(b.title); }
  if (b.next_step !== undefined) patch.next_step = String(b.next_step || '').trim().slice(0, 500);
  if (b.status !== undefined) { if (!STATUSES.includes(b.status)) return res.status(400).json({ error: 'Unknown status' }); patch.status = b.status; }
  if (b.follow_up_at !== undefined) { if (b.follow_up_at && !YMD.test(b.follow_up_at)) return res.status(400).json({ error: 'Follow-up date is not valid' }); patch.follow_up_at = b.follow_up_at || null; }
  if (b.assigned_to !== undefined) { const a = validAssignee(b.assigned_to); if (a === undefined) return res.status(400).json({ error: 'Unknown person' }); patch.assigned_to = a; }
  const ok = db.transaction(() => tasks.update(Number(req.params.id), patch, req.user.id))();
  if (!ok) return res.status(404).json({ error: 'Task not found' });
  res.json(loadTask(req.params.id));
});

router.post('/:id/notes', auth, (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 2000);
  if (!text) return res.status(400).json({ error: 'Write a note' });
  if (!db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Task not found' });
  tasks.event(Number(req.params.id), 'note', text, { actorId: req.user.id });
  res.status(201).json(loadTask(req.params.id));
});

router.post('/:id/clients', auth, (req, res) => {
  const ids = validClients([req.body.client_id]);
  if (!ids || !ids.length) return res.status(400).json({ error: 'Unknown client' });
  if (!db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Task not found' });
  tasks.addClients(Number(req.params.id), ids, req.user.id);
  res.json(loadTask(req.params.id));
});

router.delete('/:id/clients/:clientId', auth, (req, res) => {
  const changed = db.prepare('DELETE FROM task_clients WHERE task_id = ? AND client_id = ?').run(req.params.id, req.params.clientId).changes;
  if (changed) {
    const c = db.prepare('SELECT first_name, last_name, active FROM clients WHERE id = ?').get(req.params.clientId);
    tasks.event(Number(req.params.id), 'clients', `Client removed: ${c ? clientName(c) : req.params.clientId}`, { actorId: req.user.id });
  }
  res.json(loadTask(req.params.id));
});

module.exports = router;
