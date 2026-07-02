const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');
const audit = require('../services/audit');

const OPEN_END_DATE = '9999-09-09';
const RATE_FIELDS = ['code', 'rate', 'travel_code', 'travel_rate_per_hour', 'km_code', 'km_rate', 'notes_code', 'notes_rate', 'cancel_code', 'gst_type'];

function dayBefore(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

router.get('/', auth, (req, res) => {
  res.json(db.prepare(`
    SELECT s.*, srp.rate AS current_rate, srp.gst_type AS current_gst_type
    FROM services s
    LEFT JOIN service_rate_periods srp ON srp.service_id = s.id AND srp.end_date = ?
    WHERE s.active = 1 ORDER BY s.name
  `).all(OPEN_END_DATE));
});

router.get('/:id', auth, (req, res) => {
  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  if (!service) return res.status(404).json({ error: 'Not found' });
  res.json(service);
});

router.post('/', auth, (req, res) => {
  const { name, description, unit, default_duration, discipline_id } = req.body;
  const result = db.transaction(() => {
    const inserted = db.prepare(`
      INSERT INTO services (name, description, unit, default_duration, discipline_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, description || null, unit || 'hour', default_duration || 60, discipline_id || null);
    const serviceId = inserted.lastInsertRowid;
    db.prepare(`
      INSERT INTO service_rate_periods (service_id, name, start_date, end_date, code, rate, travel_code, travel_rate_per_hour, km_code, km_rate, notes_code, notes_rate, cancel_code, gst_type)
      VALUES (?, 'Initial Rates', '2000-01-01', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(serviceId, OPEN_END_DATE, req.body.code || null, req.body.default_rate || 0, req.body.travel_code || null,
      req.body.travel_rate_per_hour || null, req.body.km_code || null, req.body.km_rate || null,
      req.body.notes_code || null, req.body.notes_rate || null, req.body.cancel_code || null, req.body.gst_type || 'GST');
    return serviceId;
  })();
  audit.log('service', result, 'created', `Created service "${name}"`);
  res.status(201).json(db.prepare('SELECT * FROM services WHERE id = ?').get(result));
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

// Rate periods

router.get('/:id/rate-periods', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM service_rate_periods WHERE service_id = ? ORDER BY start_date DESC').all(req.params.id);
  res.json(rows);
});

router.post('/:id/rate-periods', auth, (req, res) => {
  const { name, start_date, copy_from_period_id } = req.body;
  if (!name || !start_date) return res.status(400).json({ error: 'name and start_date are required' });

  try {
    const periodId = db.transaction(() => {
      const openPeriod = db.prepare('SELECT * FROM service_rate_periods WHERE service_id = ? AND end_date = ?').get(req.params.id, OPEN_END_DATE);
      if (openPeriod) {
        if (start_date <= openPeriod.start_date) throw new Error("start_date must be after the current period's start date");
        db.prepare('UPDATE service_rate_periods SET end_date = ? WHERE id = ?').run(dayBefore(start_date), openPeriod.id);
      }

      let source = null;
      if (copy_from_period_id) {
        source = db.prepare('SELECT * FROM service_rate_periods WHERE id = ? AND service_id = ?').get(copy_from_period_id, req.params.id);
      }

      const inserted = db.prepare(`
        INSERT INTO service_rate_periods (service_id, name, start_date, end_date, code, rate, travel_code, travel_rate_per_hour, km_code, km_rate, notes_code, notes_rate, cancel_code, gst_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(req.params.id, name, start_date, OPEN_END_DATE,
        source?.code ?? null, source?.rate ?? 0, source?.travel_code ?? null, source?.travel_rate_per_hour ?? null,
        source?.km_code ?? null, source?.km_rate ?? null, source?.notes_code ?? null, source?.notes_rate ?? null,
        source?.cancel_code ?? null, source?.gst_type ?? 'GST');
      return inserted.lastInsertRowid;
    })();
    audit.log('service', Number(req.params.id), 'rate_period_created', `New rate period "${name}" from ${start_date}`);
    res.status(201).json(db.prepare('SELECT * FROM service_rate_periods WHERE id = ?').get(periodId));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id/rate-periods/:periodId', auth, (req, res) => {
  const period = db.prepare('SELECT * FROM service_rate_periods WHERE id = ? AND service_id = ?').get(req.params.periodId, req.params.id);
  if (!period) return res.status(404).json({ error: 'Not found' });
  const isOpen = period.end_date === OPEN_END_DATE;

  const { name, start_date } = req.body;
  if (start_date && start_date !== period.start_date) {
    if (!isOpen) return res.status(400).json({ error: "Only the current period's start date can be changed" });
    const prevPeriod = db.prepare('SELECT * FROM service_rate_periods WHERE service_id = ? AND id != ? ORDER BY start_date DESC LIMIT 1').get(req.params.id, period.id);
    if (prevPeriod && start_date <= prevPeriod.start_date) {
      return res.status(400).json({ error: "start_date must be after the previous period's start date" });
    }
    db.transaction(() => {
      if (prevPeriod) db.prepare('UPDATE service_rate_periods SET end_date = ? WHERE id = ?').run(dayBefore(start_date), prevPeriod.id);
      db.prepare('UPDATE service_rate_periods SET start_date = ? WHERE id = ?').run(start_date, period.id);
    })();
  }

  const fields = {};
  for (const f of RATE_FIELDS) if (f in req.body) fields[f] = req.body[f];
  if (name) fields.name = name;
  if (Object.keys(fields).length) {
    const setClause = Object.keys(fields).map(f => `${f} = ?`).join(', ');
    db.prepare(`UPDATE service_rate_periods SET ${setClause} WHERE id = ?`).run(...Object.values(fields), period.id);
  }
  audit.log('service', Number(req.params.id), 'rate_period_updated', `Rate period "${period.name}" updated`);
  res.json(db.prepare('SELECT * FROM service_rate_periods WHERE id = ?').get(period.id));
});

router.delete('/:id/rate-periods/:periodId', auth, (req, res) => {
  const period = db.prepare('SELECT * FROM service_rate_periods WHERE id = ? AND service_id = ?').get(req.params.periodId, req.params.id);
  if (!period) return res.status(404).json({ error: 'Not found' });
  if (period.end_date !== OPEN_END_DATE) return res.status(400).json({ error: 'Only the current (most recent) period can be deleted' });
  const count = db.prepare('SELECT COUNT(*) AS c FROM service_rate_periods WHERE service_id = ?').get(req.params.id).c;
  if (count <= 1) return res.status(400).json({ error: 'Cannot delete the only rate period' });

  db.transaction(() => {
    db.prepare('DELETE FROM service_rate_periods WHERE id = ?').run(period.id);
    const prevPeriod = db.prepare('SELECT * FROM service_rate_periods WHERE service_id = ? ORDER BY start_date DESC LIMIT 1').get(req.params.id);
    if (prevPeriod) db.prepare('UPDATE service_rate_periods SET end_date = ? WHERE id = ?').run(OPEN_END_DATE, prevPeriod.id);
  })();
  audit.log('service', Number(req.params.id), 'rate_period_deleted', `Rate period "${period.name}" deleted`);
  res.json({ ok: true });
});

// Date-based rate lookup — mirrors gstRates.js /for-date
router.get('/:id/rate-for-date', auth, (req, res) => {
  const { date } = req.query;
  const d = date || new Date().toISOString().slice(0, 10);
  let rate = db.prepare('SELECT * FROM service_rate_periods WHERE service_id = ? AND ? BETWEEN start_date AND end_date').get(req.params.id, d);
  if (!rate) rate = db.prepare('SELECT * FROM service_rate_periods WHERE service_id = ? ORDER BY start_date DESC LIMIT 1').get(req.params.id);
  res.json(rate || null);
});

module.exports = router;
