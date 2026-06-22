const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');
const audit = require('../services/audit');

router.get('/', auth, (_req, res) => {
  res.json(db.prepare('SELECT * FROM funding_types WHERE active=1 ORDER BY name').all());
});

router.post('/', auth, (req, res) => {
  const { name, color, has_ndis_management } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const r = db.prepare('INSERT INTO funding_types (name, color, has_ndis_management) VALUES (?, ?, ?)').run(name, color || 'gray', has_ndis_management ? 1 : 0);
  audit.log('settings', r.lastInsertRowid, 'funding_type_created', `Funding type "${name}" created`);
  res.status(201).json(db.prepare('SELECT * FROM funding_types WHERE id=?').get(r.lastInsertRowid));
});

router.patch('/:id', auth, (req, res) => {
  const { name, color, has_ndis_management } = req.body;
  db.prepare('UPDATE funding_types SET name=?, color=?, has_ndis_management=? WHERE id=?').run(name, color || 'gray', has_ndis_management ? 1 : 0, req.params.id);
  audit.log('settings', Number(req.params.id), 'funding_type_updated', `Funding type updated to "${name}"`);
  res.json(db.prepare('SELECT * FROM funding_types WHERE id=?').get(req.params.id));
});

router.delete('/:id', auth, (req, res) => {
  const ft = db.prepare('SELECT name FROM funding_types WHERE id=?').get(req.params.id);
  db.prepare('UPDATE funding_types SET active=0 WHERE id=?').run(req.params.id);
  audit.log('settings', Number(req.params.id), 'funding_type_deleted', `Funding type "${ft?.name}" deactivated`);
  res.status(204).send();
});

module.exports = router;
