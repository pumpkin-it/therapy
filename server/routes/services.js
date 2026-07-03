const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');
const audit = require('../services/audit');

const OPEN_END_DATE = '9999-09-09';

router.get('/', auth, (req, res) => {
  res.json(db.prepare(`
    SELECT s.*, (
      SELECT GROUP_CONCAT(DISTINCT ft.name) FROM service_rates sr
      JOIN rate_periods rp ON rp.id = sr.period_id
      JOIN funding_types ft ON ft.id = rp.funding_type_id
      WHERE sr.service_id = s.id AND rp.end_date = ?
    ) AS funding_type_names
    FROM services s WHERE s.active = 1 ORDER BY s.name
  `).all(OPEN_END_DATE));
});

router.get('/:id', auth, (req, res) => {
  const service = db.prepare(`
    SELECT s.*, (
      SELECT GROUP_CONCAT(DISTINCT ft.name) FROM service_rates sr
      JOIN rate_periods rp ON rp.id = sr.period_id
      JOIN funding_types ft ON ft.id = rp.funding_type_id
      WHERE sr.service_id = s.id AND rp.end_date = ?
    ) AS funding_type_names
    FROM services s WHERE s.id = ?
  `).get(OPEN_END_DATE, req.params.id);
  if (!service) return res.status(404).json({ error: 'Not found' });
  res.json(service);
});

router.post('/', auth, (req, res) => {
  const { name, description, unit, default_duration, discipline_id } = req.body;
  const result = db.prepare(`
    INSERT INTO services (name, description, unit, default_duration, discipline_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, description || null, unit || 'hour', default_duration || 60, discipline_id || null);
  audit.log('service', result.lastInsertRowid, 'created', `Created service "${name}"`);
  res.status(201).json(db.prepare('SELECT * FROM services WHERE id = ?').get(result.lastInsertRowid));
});

router.patch('/:id', auth, (req, res) => {
  const { name, description, unit, default_duration, discipline_id } = req.body;
  const before = db.prepare('SELECT * FROM services WHERE id=?').get(req.params.id);
  db.prepare(`
    UPDATE services SET name=?, description=?, unit=?, default_duration=?, discipline_id=? WHERE id=?
  `).run(name, description || null, unit || 'hour', default_duration || 60, discipline_id || null, req.params.id);
  const changes = audit.diff(before, req.body, ['name', 'unit', 'default_duration']);
  if (changes) audit.log('service', Number(req.params.id), 'updated', changes);
  res.json(db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id));
});

router.delete('/:id', auth, (req, res) => {
  const svc = db.prepare('SELECT name FROM services WHERE id=?').get(req.params.id);
  db.prepare('UPDATE services SET active = 0 WHERE id = ?').run(req.params.id);
  audit.log('service', Number(req.params.id), 'deactivated', `Service "${svc?.name}" deactivated`);
  res.status(204).send();
});

module.exports = router;
