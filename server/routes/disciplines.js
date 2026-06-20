const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');

router.get('/', auth, (_req, res) => {
  res.json(db.prepare('SELECT * FROM disciplines WHERE active=1 ORDER BY name').all());
});

router.post('/', auth, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const r = db.prepare('INSERT INTO disciplines (name) VALUES (?)').run(name);
  res.status(201).json(db.prepare('SELECT * FROM disciplines WHERE id=?').get(r.lastInsertRowid));
});

router.patch('/:id', auth, (req, res) => {
  db.prepare('UPDATE disciplines SET name=? WHERE id=?').run(req.body.name, req.params.id);
  res.json(db.prepare('SELECT * FROM disciplines WHERE id=?').get(req.params.id));
});

router.delete('/:id', auth, (req, res) => {
  db.prepare('UPDATE disciplines SET active=0 WHERE id=?').run(req.params.id);
  res.status(204).send();
});

module.exports = router;
