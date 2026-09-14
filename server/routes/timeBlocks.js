const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');
const perm = require('../middleware/requirePermission');
const audit = require('../services/audit');

const BLOCK_SELECT = `
  SELECT tb.*, p.first_name || ' ' || p.last_name AS practitioner_name, p.color AS practitioner_color
  FROM practitioner_time_blocks tb
  JOIN practitioners p ON p.id = tb.practitioner_id
`;

router.get('/', auth, perm('calendar'), (req, res) => {
  const { date, from, to, practitioner_id } = req.query;
  let where = '1=1';
  const params = [];

  if (date) {
    where += ' AND DATE(tb.start_time) = ?';
    params.push(date);
  } else if (from || to) {
    if (from) { where += ' AND tb.start_time >= ?'; params.push(from); }
    if (to)   { where += ' AND tb.start_time <= ?'; params.push(to); }
  }
  if (practitioner_id) { where += ' AND tb.practitioner_id = ?'; params.push(practitioner_id); }

  res.json(db.prepare(`${BLOCK_SELECT} WHERE ${where} ORDER BY tb.start_time ASC`).all(...params));
});

router.post('/', auth, perm('calendar'), (req, res) => {
  const { practitioner_id, start_time, end_time, reason } = req.body;
  if (!practitioner_id || !start_time || !end_time) {
    return res.status(400).json({ error: 'practitioner_id, start_time and end_time are required' });
  }
  if (end_time <= start_time) return res.status(400).json({ error: 'End time must be after start time' });

  const result = db.prepare(`
    INSERT INTO practitioner_time_blocks (practitioner_id, start_time, end_time, reason, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(practitioner_id, start_time, end_time, reason || null, req.user.id);

  audit.log('time_block', result.lastInsertRowid, 'created', `Blocked time: ${reason || '(no reason given)'}`);
  res.status(201).json(db.prepare(`${BLOCK_SELECT} WHERE tb.id = ?`).get(result.lastInsertRowid));
});

router.patch('/:id', auth, perm('calendar'), (req, res) => {
  const block = db.prepare('SELECT * FROM practitioner_time_blocks WHERE id = ?').get(req.params.id);
  if (!block) return res.status(404).json({ error: 'Not found' });
  const start_time = req.body.start_time ?? block.start_time;
  const end_time = req.body.end_time ?? block.end_time;
  const reason = req.body.reason !== undefined ? (req.body.reason || null) : block.reason;
  if (end_time <= start_time) return res.status(400).json({ error: 'End time must be after start time' });

  db.prepare('UPDATE practitioner_time_blocks SET start_time = ?, end_time = ?, reason = ? WHERE id = ?')
    .run(start_time, end_time, reason, block.id);
  audit.log('time_block', block.id, 'updated', `Updated blocked time: ${reason || '(no reason given)'}`);
  res.json(db.prepare(`${BLOCK_SELECT} WHERE tb.id = ?`).get(block.id));
});

router.delete('/:id', auth, perm('calendar'), (req, res) => {
  const block = db.prepare('SELECT * FROM practitioner_time_blocks WHERE id = ?').get(req.params.id);
  if (!block) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM practitioner_time_blocks WHERE id = ?').run(block.id);
  audit.log('time_block', block.id, 'deleted', `Removed blocked time: ${block.reason || '(no reason given)'}`);
  res.status(204).send();
});

module.exports = router;
