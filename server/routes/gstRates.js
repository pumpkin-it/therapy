const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');
const audit = require('../services/audit');

router.get('/', auth, (_req, res) => {
  res.json(db.prepare('SELECT * FROM gst_rates ORDER BY effective_from DESC').all());
});

// Get the applicable GST rate for a given date
router.get('/for-date', auth, (req, res) => {
  const { date } = req.query;
  const d = date || new Date().toISOString().slice(0, 10);
  const rate = db.prepare('SELECT * FROM gst_rates WHERE effective_from <= ? ORDER BY effective_from DESC LIMIT 1').get(d);
  res.json(rate || { rate: 0.1, effective_from: '2000-07-01' });
});

router.post('/', auth, (req, res) => {
  const { rate, effective_from } = req.body;
  if (rate == null || !effective_from) return res.status(400).json({ error: 'Rate and effective date are required' });
  const decimal = Number(rate) / 100;
  const r = db.prepare('INSERT INTO gst_rates (rate, effective_from) VALUES (?, ?)').run(decimal, effective_from);
  audit.log('settings', r.lastInsertRowid, 'gst_rate_added', `GST rate set to ${rate}% effective from ${effective_from}`);
  res.status(201).json(db.prepare('SELECT * FROM gst_rates WHERE id=?').get(r.lastInsertRowid));
});

router.delete('/:id', auth, (req, res) => {
  const existing = db.prepare('SELECT * FROM gst_rates WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const count = db.prepare('SELECT COUNT(*) as c FROM gst_rates').get().c;
  if (count <= 1) return res.status(400).json({ error: 'Cannot delete the only GST rate' });
  db.prepare('DELETE FROM gst_rates WHERE id=?').run(req.params.id);
  audit.log('settings', Number(req.params.id), 'gst_rate_deleted', `GST rate ${Math.round(existing.rate * 100)}% from ${existing.effective_from} deleted`);
  res.json({ ok: true });
});

module.exports = router;
