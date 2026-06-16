const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');

router.get('/', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM services WHERE active = 1 ORDER BY name').all());
});

router.post('/', auth, (req, res) => {
  const { name, description, default_rate, unit, default_duration } = req.body;
  const result = db.prepare(
    'INSERT INTO services (name, description, default_rate, unit, default_duration) VALUES (?, ?, ?, ?, ?)'
  ).run(name, description||null, default_rate, unit||'hour', default_duration||60);
  res.status(201).json(db.prepare('SELECT * FROM services WHERE id = ?').get(result.lastInsertRowid));
});

router.patch('/:id', auth, (req, res) => {
  const { name, description, default_rate, unit, default_duration } = req.body;
  db.prepare(
    'UPDATE services SET name=?, description=?, default_rate=?, unit=?, default_duration=? WHERE id=?'
  ).run(name, description||null, default_rate, unit||'hour', default_duration||60, req.params.id);
  res.json(db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id));
});

router.delete('/:id', auth, (req, res) => {
  db.prepare('UPDATE services SET active = 0 WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

module.exports = router;
