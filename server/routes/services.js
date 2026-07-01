const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');
const audit = require('../services/audit');

router.get('/', auth, (req, res) => {
  res.json(db.prepare(`
    SELECT s.*, ri.code AS cancel_rate_item_code, ri.name AS cancel_rate_item_name, ri.rate AS cancel_rate_item_rate
    FROM services s
    LEFT JOIN rate_items ri ON ri.id = s.cancel_rate_item_id
    WHERE s.active = 1 ORDER BY s.name
  `).all());
});

router.post('/', auth, (req, res) => {
  const { name, description, code, default_rate, unit, default_duration, travel_rate_per_hour, km_rate, notes_rate, gst_rate, gst_type, discipline_id, travel_code, km_code, notes_code, cancel_rate_item_id } = req.body;
  const result = db.prepare(`
    INSERT INTO services (name, description, code, default_rate, unit, default_duration, travel_rate_per_hour, km_rate, notes_rate, gst_rate, gst_type, discipline_id, travel_code, km_code, notes_code, cancel_rate_item_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, description||null, code||null, default_rate, unit||'hour', default_duration||60, travel_rate_per_hour||null, km_rate||null, notes_rate||null, gst_rate != null ? Number(gst_rate) : null, gst_type||'GST', discipline_id || null, travel_code||null, km_code||null, notes_code||null, cancel_rate_item_id || null);
  audit.log('service', result.lastInsertRowid, 'created', `Created service "${name}"`);
  res.status(201).json(db.prepare('SELECT * FROM services WHERE id = ?').get(result.lastInsertRowid));
});

router.patch('/:id', auth, (req, res) => {
  const { name, description, code, default_rate, unit, default_duration, travel_rate_per_hour, km_rate, notes_rate, gst_rate, gst_type, discipline_id, travel_code, km_code, notes_code, cancel_rate_item_id } = req.body;
  const before = db.prepare('SELECT * FROM services WHERE id=?').get(req.params.id);
  db.prepare(`
    UPDATE services SET name=?, description=?, code=?, default_rate=?, unit=?, default_duration=?, travel_rate_per_hour=?, km_rate=?, notes_rate=?, gst_rate=?, gst_type=?, discipline_id=?, travel_code=?, km_code=?, notes_code=?, cancel_rate_item_id=? WHERE id=?
  `).run(name, description||null, code||null, default_rate, unit||'hour', default_duration||60, travel_rate_per_hour||null, km_rate||null, notes_rate||null, gst_rate != null ? Number(gst_rate) : null, gst_type||'GST', discipline_id || null, travel_code||null, km_code||null, notes_code||null, cancel_rate_item_id || null, req.params.id);
  const changes = audit.diff(before, req.body, ['name','code','default_rate','unit','default_duration']);
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
