const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');

router.get('/', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM practitioners WHERE active = 1 ORDER BY last_name, first_name').all();
  res.json(rows);
});

router.get('/:id', auth, (req, res) => {
  const row = db.prepare('SELECT * FROM practitioners WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.post('/', auth, (req, res) => {
  const { first_name, last_name, title, email, phone, color } = req.body;
  const result = db.prepare(
    'INSERT INTO practitioners (first_name, last_name, title, email, phone, color) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(first_name, last_name, title || null, email || null, phone || null, color || '#6366f1');
  res.status(201).json(db.prepare('SELECT * FROM practitioners WHERE id = ?').get(result.lastInsertRowid));
});

router.patch('/:id', auth, (req, res) => {
  const { first_name, last_name, title, email, phone, color } = req.body;
  db.prepare(
    'UPDATE practitioners SET first_name=?, last_name=?, title=?, email=?, phone=?, color=? WHERE id=?'
  ).run(first_name, last_name, title || null, email || null, phone || null, color || '#6366f1', req.params.id);
  res.json(db.prepare('SELECT * FROM practitioners WHERE id = ?').get(req.params.id));
});

router.delete('/:id', auth, (req, res) => {
  db.prepare('UPDATE practitioners SET active = 0 WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

module.exports = router;
