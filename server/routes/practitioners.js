const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');

router.get('/', auth, (req, res) => {
  const { active, role } = req.query;
  const activeFilter = active === 'all' ? null : active === '0' ? 0 : 1;
  const conditions = [];
  const params = [];
  if (activeFilter !== null) { conditions.push('active = ?'); params.push(activeFilter); }
  if (role) { conditions.push('role = ?'); params.push(role); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM practitioners ${where} ORDER BY last_name, first_name`).all(...params);
  res.json(rows);
});

router.get('/:id', auth, (req, res) => {
  const row = db.prepare('SELECT * FROM practitioners WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.post('/', auth, (req, res) => {
  const { first_name, last_name, title, email, phone, color, provider_number, role } = req.body;
  const result = db.prepare(
    'INSERT INTO practitioners (first_name, last_name, title, email, phone, color, provider_number, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(first_name, last_name, title || null, email || null, phone || null, color || '#6366f1', provider_number || null, role || 'practitioner');
  res.status(201).json(db.prepare('SELECT * FROM practitioners WHERE id = ?').get(result.lastInsertRowid));
});

router.patch('/:id', auth, (req, res) => {
  const { first_name, last_name, title, email, phone, color, provider_number, role } = req.body;
  db.prepare(
    'UPDATE practitioners SET first_name=?, last_name=?, title=?, email=?, phone=?, color=?, provider_number=?, role=? WHERE id=?'
  ).run(first_name, last_name, title || null, email || null, phone || null, color || '#6366f1', provider_number || null, role || 'practitioner', req.params.id);
  res.json(db.prepare('SELECT * FROM practitioners WHERE id = ?').get(req.params.id));
});

router.patch('/:id/active', auth, (req, res) => {
  db.prepare('UPDATE practitioners SET active=? WHERE id=?').run(req.body.active ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', auth, (req, res) => {
  db.prepare('UPDATE practitioners SET active = 0 WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

module.exports = router;
