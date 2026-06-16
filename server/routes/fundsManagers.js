const router = require('express').Router();
const db = require('../database');

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM funds_managers WHERE active = 1 ORDER BY name').all());
});

router.post('/', (req, res) => {
  const { name, email } = req.body;
  const result = db.prepare('INSERT INTO funds_managers (name, email) VALUES (?, ?)').run(name, email);
  res.status(201).json(db.prepare('SELECT * FROM funds_managers WHERE id = ?').get(result.lastInsertRowid));
});

router.patch('/:id', (req, res) => {
  const { name, email } = req.body;
  db.prepare('UPDATE funds_managers SET name=?, email=? WHERE id=?').run(name, email, req.params.id);
  res.json(db.prepare('SELECT * FROM funds_managers WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  db.prepare('UPDATE funds_managers SET active = 0 WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

module.exports = router;
