const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');

router.get('/', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM services WHERE active = 1 ORDER BY name').all());
});

router.post('/', auth, (req, res) => {
  const { name, description, code, default_rate, unit, default_duration, travel_rate_per_hour, km_rate, notes_rate, gst_rate, discipline_id } = req.body;
  const result = db.prepare(`
    INSERT INTO services (name, description, code, default_rate, unit, default_duration, travel_rate_per_hour, km_rate, notes_rate, gst_rate, discipline_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, description||null, code||null, default_rate, unit||'hour', default_duration||60, travel_rate_per_hour||null, km_rate||null, notes_rate||null, gst_rate != null ? Number(gst_rate) : null, discipline_id || null);
  res.status(201).json(db.prepare('SELECT * FROM services WHERE id = ?').get(result.lastInsertRowid));
});

router.patch('/:id', auth, (req, res) => {
  const { name, description, code, default_rate, unit, default_duration, travel_rate_per_hour, km_rate, notes_rate, gst_rate, discipline_id } = req.body;
  db.prepare(`
    UPDATE services SET name=?, description=?, code=?, default_rate=?, unit=?, default_duration=?, travel_rate_per_hour=?, km_rate=?, notes_rate=?, gst_rate=?, discipline_id=? WHERE id=?
  `).run(name, description||null, code||null, default_rate, unit||'hour', default_duration||60, travel_rate_per_hour||null, km_rate||null, notes_rate||null, gst_rate != null ? Number(gst_rate) : null, discipline_id || null, req.params.id);
  res.json(db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id));
});

router.delete('/:id', auth, (req, res) => {
  db.prepare('UPDATE services SET active = 0 WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

module.exports = router;
