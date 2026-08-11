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

// Appointments resolve their funding type the same way invoices do: directly via
// appointments.funding_period_id, or by date-matching the client's funding periods.
const APPT_FUNDING_TYPE_JOIN = `
  LEFT JOIN funding_periods fp_direct ON fp_direct.id = a.funding_period_id
  LEFT JOIN funding_periods fp_date ON a.funding_period_id IS NULL AND fp_date.client_id = a.client_id
    AND (fp_date.start_date IS NULL OR fp_date.start_date = '' OR fp_date.start_date <= DATE(a.start_time))
    AND (fp_date.end_date IS NULL OR fp_date.end_date = '' OR fp_date.end_date >= DATE(a.start_time))
  LEFT JOIN funding_types ft ON ft.name = COALESCE(fp_direct.funding_type, fp_date.funding_type)
`;

// Recurring series pre-create appointments months ahead of when a new rate period or rate
// change is actually entered. This re-syncs the frozen unit_rate on any not-yet-invoiced
// appointment_items whose appointment resolves to this funding type and falls within the
// given date range — one set-based UPDATE, cheap even at SaaS scale.
function resyncServiceRate(fundingTypeId, serviceId, rate, startDate, endDate) {
  const result = db.prepare(`
    UPDATE appointment_items
    SET unit_rate = ?
    WHERE service_id = ?
      AND appointment_id IN (
        SELECT a.id FROM appointments a
        ${APPT_FUNDING_TYPE_JOIN}
        WHERE a.is_invoiced = 0 AND ft.id = ? AND DATE(a.start_time) BETWEEN ? AND ?
      )
  `).run(rate, serviceId, fundingTypeId, startDate, endDate);
  return result.changes;
}

// Bulk variant used when a whole period is copied forward — resyncs every service in that
// period at once via a correlated subquery instead of looping per service.
function resyncPeriodRates(fundingTypeId, period) {
  const result = db.prepare(`
    UPDATE appointment_items
    SET unit_rate = (SELECT sr.rate FROM service_rates sr WHERE sr.period_id = ? AND sr.service_id = appointment_items.service_id)
    WHERE service_id IN (SELECT service_id FROM service_rates WHERE period_id = ?)
      AND appointment_id IN (
        SELECT a.id FROM appointments a
        ${APPT_FUNDING_TYPE_JOIN}
        WHERE a.is_invoiced = 0 AND ft.id = ? AND DATE(a.start_time) BETWEEN ? AND ?
      )
  `).run(period.id, period.id, fundingTypeId, period.start_date, period.end_date);
  return result.changes;
}

router.get('/', auth, (_req, res) => {
  res.json(db.prepare('SELECT * FROM funding_types WHERE active=1 ORDER BY name').all());
});

router.post('/', auth, (req, res) => {
  const { name, color, has_ndis_management, identifier_label, show_period_dates } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const r = db.prepare('INSERT INTO funding_types (name, color, has_ndis_management, identifier_label, show_period_dates) VALUES (?, ?, ?, ?, ?)')
    .run(name, color || 'gray', has_ndis_management ? 1 : 0, identifier_label || 'Client ID', show_period_dates === false ? 0 : 1);
  audit.log('settings', r.lastInsertRowid, 'funding_type_created', `Funding type "${name}" created`);
  res.status(201).json(db.prepare('SELECT * FROM funding_types WHERE id=?').get(r.lastInsertRowid));
});

router.patch('/:id', auth, (req, res) => {
  const { name, color, has_ndis_management, identifier_label, show_period_dates } = req.body;
  db.prepare('UPDATE funding_types SET name=?, color=?, has_ndis_management=?, identifier_label=?, show_period_dates=? WHERE id=?')
    .run(name, color || 'gray', has_ndis_management ? 1 : 0, identifier_label || 'Client ID', show_period_dates === false ? 0 : 1, req.params.id);
  audit.log('settings', Number(req.params.id), 'funding_type_updated', `Funding type updated to "${name}"`);
  res.json(db.prepare('SELECT * FROM funding_types WHERE id=?').get(req.params.id));
});

router.delete('/:id', auth, (req, res) => {
  const ft = db.prepare('SELECT name FROM funding_types WHERE id=?').get(req.params.id);
  db.prepare('UPDATE funding_types SET active=0 WHERE id=?').run(req.params.id);
  audit.log('settings', Number(req.params.id), 'funding_type_deleted', `Funding type "${ft?.name}" deactivated`);
  res.status(204).send();
});

// Rate periods (scoped to this funding type)

router.get('/:id/rate-periods', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM rate_periods WHERE funding_type_id = ? ORDER BY start_date DESC').all(req.params.id);
  res.json(rows);
});

// Creating a period is a single action: close the current open period and bulk-copy every one
// of its service rate rows into the new period. Individual rates are then adjusted afterward.
router.post('/:id/rate-periods', auth, (req, res) => {
  const { name, start_date } = req.body;
  if (!name || !start_date) return res.status(400).json({ error: 'name and start_date are required' });

  try {
    const { periodId, updatedCount } = db.transaction(() => {
      const openPeriod = db.prepare('SELECT * FROM rate_periods WHERE funding_type_id = ? AND end_date = ?').get(req.params.id, OPEN_END_DATE);
      if (openPeriod) {
        if (start_date <= openPeriod.start_date) throw new Error("start_date must be after the current period's start date");
        db.prepare('UPDATE rate_periods SET end_date = ? WHERE id = ?').run(dayBefore(start_date), openPeriod.id);
      }

      const inserted = db.prepare('INSERT INTO rate_periods (funding_type_id, name, start_date, end_date) VALUES (?, ?, ?, ?)')
        .run(req.params.id, name, start_date, OPEN_END_DATE);
      const periodId = inserted.lastInsertRowid;

      if (openPeriod) {
        db.prepare(`
          INSERT INTO service_rates (period_id, service_id, code, rate, travel_code, travel_rate_per_hour, km_code, km_rate, notes_code, notes_rate, cancel_code, gst_type)
          SELECT ?, service_id, code, rate, travel_code, travel_rate_per_hour, km_code, km_rate, notes_code, notes_rate, cancel_code, gst_type
          FROM service_rates WHERE period_id = ?
        `).run(periodId, openPeriod.id);
      }

      const newPeriod = db.prepare('SELECT * FROM rate_periods WHERE id = ?').get(periodId);
      const updatedCount = resyncPeriodRates(req.params.id, newPeriod);
      return { periodId, updatedCount };
    })();
    audit.log('settings', Number(req.params.id), 'rate_period_created', `New rate period "${name}" from ${start_date}${updatedCount ? ` — resynced ${updatedCount} future appointment(s)` : ''}`);
    res.status(201).json({ ...db.prepare('SELECT * FROM rate_periods WHERE id = ?').get(periodId), appointments_updated: updatedCount });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id/rate-periods/:periodId', auth, (req, res) => {
  const period = db.prepare('SELECT * FROM rate_periods WHERE id = ? AND funding_type_id = ?').get(req.params.periodId, req.params.id);
  if (!period) return res.status(404).json({ error: 'Not found' });
  const isOpen = period.end_date === OPEN_END_DATE;

  const { name, start_date } = req.body;
  if (start_date && start_date !== period.start_date) {
    if (!isOpen) return res.status(400).json({ error: "Only the current period's start date can be changed" });
    const prevPeriod = db.prepare('SELECT * FROM rate_periods WHERE funding_type_id = ? AND id != ? ORDER BY start_date DESC LIMIT 1').get(req.params.id, period.id);
    if (prevPeriod && start_date <= prevPeriod.start_date) {
      return res.status(400).json({ error: "start_date must be after the previous period's start date" });
    }
    db.transaction(() => {
      if (prevPeriod) db.prepare('UPDATE rate_periods SET end_date = ? WHERE id = ?').run(dayBefore(start_date), prevPeriod.id);
      db.prepare('UPDATE rate_periods SET start_date = ? WHERE id = ?').run(start_date, period.id);
    })();
  }
  if (name) db.prepare('UPDATE rate_periods SET name = ? WHERE id = ?').run(name, period.id);

  audit.log('settings', Number(req.params.id), 'rate_period_updated', `Rate period "${period.name}" updated`);
  res.json(db.prepare('SELECT * FROM rate_periods WHERE id = ?').get(period.id));
});

router.delete('/:id/rate-periods/:periodId', auth, (req, res) => {
  const period = db.prepare('SELECT * FROM rate_periods WHERE id = ? AND funding_type_id = ?').get(req.params.periodId, req.params.id);
  if (!period) return res.status(404).json({ error: 'Not found' });
  if (period.end_date !== OPEN_END_DATE) return res.status(400).json({ error: 'Only the current (most recent) period can be deleted' });
  const count = db.prepare('SELECT COUNT(*) AS c FROM rate_periods WHERE funding_type_id = ?').get(req.params.id).c;
  if (count <= 1) return res.status(400).json({ error: 'Cannot delete the only rate period' });

  db.transaction(() => {
    db.prepare('DELETE FROM rate_periods WHERE id = ?').run(period.id);
    const prevPeriod = db.prepare('SELECT * FROM rate_periods WHERE funding_type_id = ? ORDER BY start_date DESC LIMIT 1').get(req.params.id);
    if (prevPeriod) db.prepare('UPDATE rate_periods SET end_date = ? WHERE id = ?').run(OPEN_END_DATE, prevPeriod.id);
  })();
  audit.log('settings', Number(req.params.id), 'rate_period_deleted', `Rate period "${period.name}" deleted`);
  res.json({ ok: true });
});

// Service rates within a period

router.get('/:id/rate-periods/:periodId/rates', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT sr.*, s.name AS service_name, s.unit, s.discipline_id
    FROM service_rates sr JOIN services s ON s.id = sr.service_id
    WHERE sr.period_id = ? ORDER BY s.name
  `).all(req.params.periodId);
  res.json(rows);
});

router.post('/:id/rate-periods/:periodId/rates', auth, (req, res) => {
  const period = db.prepare('SELECT * FROM rate_periods WHERE id = ? AND funding_type_id = ?').get(req.params.periodId, req.params.id);
  if (!period) return res.status(404).json({ error: 'Not found' });
  const { service_id, code, rate, travel_code, travel_rate_per_hour, km_code, km_rate, notes_code, notes_rate, cancel_code, gst_type } = req.body;
  if (!service_id) return res.status(400).json({ error: 'service_id is required' });

  const result = db.prepare(`
    INSERT INTO service_rates (period_id, service_id, code, rate, travel_code, travel_rate_per_hour, km_code, km_rate, notes_code, notes_rate, cancel_code, gst_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(period.id, service_id, code || null, rate || 0, travel_code || null, travel_rate_per_hour || null,
    km_code || null, km_rate || null, notes_code || null, notes_rate || null, cancel_code || null, gst_type || 'GST');
  audit.log('settings', Number(req.params.id), 'service_rate_added', `Service added to rate period "${period.name}"`);
  res.status(201).json(db.prepare('SELECT * FROM service_rates WHERE id = ?').get(result.lastInsertRowid));
});

router.patch('/:id/rate-periods/:periodId/rates/:rateId', auth, (req, res) => {
  const period = db.prepare('SELECT * FROM rate_periods WHERE id = ? AND funding_type_id = ?').get(req.params.periodId, req.params.id);
  if (!period) return res.status(404).json({ error: 'Not found' });
  const existing = db.prepare('SELECT * FROM service_rates WHERE id = ? AND period_id = ?').get(req.params.rateId, period.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const fields = {};
  for (const f of RATE_FIELDS) if (f in req.body) fields[f] = req.body[f];
  let updatedCount = 0;
  if (Object.keys(fields).length) {
    const setClause = Object.keys(fields).map(f => `${f} = ?`).join(', ');
    db.transaction(() => {
      db.prepare(`UPDATE service_rates SET ${setClause} WHERE id = ?`).run(...Object.values(fields), existing.id);
      if ('rate' in fields) {
        updatedCount = resyncServiceRate(Number(req.params.id), existing.service_id, fields.rate, period.start_date, period.end_date);
      }
    })();
  }
  audit.log('settings', Number(req.params.id), 'service_rate_updated', `Rate updated in period "${period.name}"${updatedCount ? ` — resynced ${updatedCount} appointment(s)` : ''}`);
  res.json({ ...db.prepare('SELECT * FROM service_rates WHERE id = ?').get(existing.id), appointments_updated: updatedCount });
});

router.delete('/:id/rate-periods/:periodId/rates/:rateId', auth, (req, res) => {
  const period = db.prepare('SELECT * FROM rate_periods WHERE id = ? AND funding_type_id = ?').get(req.params.periodId, req.params.id);
  if (!period) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM service_rates WHERE id = ? AND period_id = ?').run(req.params.rateId, period.id);
  audit.log('settings', Number(req.params.id), 'service_rate_removed', `Service removed from rate period "${period.name}"`);
  res.json({ ok: true });
});

// Date-based lookup for booking — every service priced under this funding type on a given date
router.get('/:id/service-rates', auth, (req, res) => {
  const { date } = req.query;
  const d = date || new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT sr.*, s.name AS service_name, s.unit, s.default_duration, s.discipline_id
    FROM service_rates sr
    JOIN rate_periods rp ON rp.id = sr.period_id
    JOIN services s ON s.id = sr.service_id
    WHERE rp.funding_type_id = ? AND ? BETWEEN rp.start_date AND rp.end_date AND s.active = 1
    ORDER BY s.name
  `).all(req.params.id, d);
  res.json(rows);
});

module.exports = router;
