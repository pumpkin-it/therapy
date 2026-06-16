const router = require('express').Router();
const db = require('../database');

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM locations WHERE active = 1 ORDER BY name').all());
});

router.post('/', (req, res) => {
  const { name, address } = req.body;
  const result = db.prepare('INSERT INTO locations (name, address) VALUES (?, ?)').run(name, address);
  res.status(201).json(db.prepare('SELECT * FROM locations WHERE id = ?').get(result.lastInsertRowid));
});

router.patch('/:id', (req, res) => {
  const { name, address } = req.body;
  db.prepare('UPDATE locations SET name=?, address=? WHERE id=?').run(name, address, req.params.id);
  res.json(db.prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  db.prepare('UPDATE locations SET active = 0 WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

module.exports = router;
