const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');
const { sendAppointmentNotification } = require('../services/mailer');
const audit = require('../services/audit');

const APPT_SELECT = `
  SELECT a.*,
    c.first_name || ' ' || c.last_name AS client_name,
    p.first_name || ' ' || p.last_name AS practitioner_name,
    p.color AS practitioner_color,
    l.name AS location_name, l.address AS location_address
  FROM appointments a
  JOIN clients c ON c.id = a.client_id
  JOIN practitioners p ON p.id = a.practitioner_id
  LEFT JOIN locations l ON l.id = a.location_id
`;

const insertItems = (apptId, items) => {
  const stmt = db.prepare(`
    INSERT INTO appointment_items (appointment_id, service_id, description, quantity, unit_rate, travel_time_min, travel_time_to, travel_time_from, travel_km, prep_time_min, item_notes, notes_min)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const item of items) {
    const travelTotal = (item.travel_time_to || 0) + (item.travel_time_from || 0);
    stmt.run(apptId, item.service_id||null, item.description, item.quantity||1, item.unit_rate,
      travelTotal || item.travel_time_min || null, item.travel_time_to||null, item.travel_time_from||null,
      item.travel_km||null, item.prep_time_min||null, item.item_notes||null, item.notes_min||null);
  }
};

const withItems = appt => {
  appt.items = db.prepare(`
    SELECT ai.*, s.name AS service_name, s.code AS service_code
    FROM appointment_items ai
    LEFT JOIN services s ON s.id = ai.service_id WHERE ai.appointment_id = ?
  `).all(appt.id);
  return appt;
};

router.get('/', auth, (req, res) => {
  const { date, from, to, client_id, practitioner_id, series_id } = req.query;

  let where = '1=1';
  const params = [];

  if (date) {
    where += ' AND DATE(a.start_time) = ?';
    params.push(date);
  } else if (from || to) {
    if (from) { where += ' AND a.start_time >= ?'; params.push(from); }
    if (to)   { where += ' AND a.start_time <= ?'; params.push(to); }
  }
  if (client_id)       { where += ' AND a.client_id = ?';       params.push(client_id); }
  if (practitioner_id) { where += ' AND a.practitioner_id = ?'; params.push(practitioner_id); }
  if (series_id)       { where += ' AND a.series_id = ?';       params.push(series_id); }

  const appointments = db.prepare(`${APPT_SELECT} WHERE ${where} ORDER BY a.start_time ASC`).all(...params);

  const ids = appointments.map(a => a.id);
  const items = ids.length
    ? db.prepare(`
        SELECT ai.*, s.name AS service_name, s.code AS service_code
        FROM appointment_items ai
        LEFT JOIN services s ON s.id = ai.service_id
        WHERE ai.appointment_id IN (${ids.map(() => '?').join(',')})
      `).all(...ids)
    : [];

  const itemsByAppt = {};
  for (const item of items) {
    (itemsByAppt[item.appointment_id] ||= []).push(item);
  }

  res.json(appointments.map(a => ({ ...a, items: itemsByAppt[a.id] || [] })));
});

// Check for scheduling conflicts
router.get('/check-conflicts', auth, (req, res) => {
  const { practitioner_id, client_id, start_time, end_time, exclude_id } = req.query;
  if (!start_time || !end_time) return res.json({ conflicts: [] });
  const conflicts = [];
  const excl = exclude_id ? [exclude_id] : [];
  const exclSQL = exclude_id ? ' AND a.id != ?' : '';
  if (practitioner_id) {
    const rows = db.prepare(`
      SELECT c.first_name || ' ' || c.last_name AS client_name
      FROM appointments a JOIN clients c ON c.id = a.client_id
      WHERE a.practitioner_id = ? AND a.status != 'cancelled' AND a.start_time < ? AND a.end_time > ? ${exclSQL}
    `).all(practitioner_id, end_time, start_time, ...excl);
    const pName = db.prepare("SELECT first_name || ' ' || last_name AS name FROM practitioners WHERE id=?").get(practitioner_id);
    for (const r of rows) conflicts.push({ type: 'practitioner', message: `${pName?.name} already has an appointment with ${r.client_name} at this time` });
  }
  if (client_id) {
    const rows = db.prepare(`
      SELECT p.first_name || ' ' || p.last_name AS practitioner_name
      FROM appointments a JOIN practitioners p ON p.id = a.practitioner_id
      WHERE a.client_id = ? AND a.status != 'cancelled' AND a.start_time < ? AND a.end_time > ? ${exclSQL}
    `).all(client_id, end_time, start_time, ...excl);
    const cName = db.prepare("SELECT first_name || ' ' || last_name AS name FROM clients WHERE id=?").get(client_id);
    for (const r of rows) conflicts.push({ type: 'client', message: `${cName?.name} already has an appointment with ${r.practitioner_name} at this time` });
  }
  res.json({ conflicts });
});

router.get('/:id', auth, (req, res) => {
  const appt = db.prepare(`${APPT_SELECT} WHERE a.id = ?`).get(req.params.id);
  if (!appt) return res.status(404).json({ error: 'Not found' });
  res.json(withItems(appt));
});

function resolveLocation(location_type, location_id, location_other) {
  if (location_type === 'clinic') return { locationText: null, resolvedLocationId: location_id || null, locationOther: null };
  if (location_type === 'other')  return { locationText: location_other || null, resolvedLocationId: null, locationOther: location_other || null };
  return { locationText: 'Client Home', resolvedLocationId: null, locationOther: null };
}

function addInterval(date, freq) {
  const d = new Date(date);
  if (freq === 'weekly')      d.setDate(d.getDate() + 7);
  else if (freq === 'fortnightly') d.setDate(d.getDate() + 14);
  else if (freq === 'every3weeks') d.setDate(d.getDate() + 21);
  else if (freq === 'monthly') d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 16);
}

router.post('/', auth, (req, res) => {
  const { practitioner_id, client_id, location_type, location_id, location_other, title, start_time, end_time, notes, status, items = [], recurrence, funding_period_id } = req.body;
  const { locationText, resolvedLocationId, locationOther } = resolveLocation(location_type, location_id, location_other);

  const insertAppt = db.prepare(`
    INSERT INTO appointments (practitioner_id, client_id, location, location_id, location_other, title, start_time, end_time, notes, status, funding_period_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const createOne = (st, et) => {
    const r = insertAppt.run(practitioner_id, client_id, locationText, resolvedLocationId, locationOther, title||null, st, et, notes||null, status||'scheduled', funding_period_id||null);
    insertItems(r.lastInsertRowid, items);
    return r.lastInsertRowid;
  };

  // Recurring appointments are now handled via /api/recurring-series
  // Keep this as a fallback for legacy calls
  if (recurrence?.freq) {
    // Redirect to recurring series creation
    const seriesRouter = require('./recurringSeries');
    return require('./recurringSeries').handle
      ? res.status(400).json({ error: 'Use /api/recurring-series to create recurring appointments' })
      : res.status(400).json({ error: 'Use /api/recurring-series to create recurring appointments' });
  }

  const apptId = createOne(start_time, end_time);
  audit.log('appointment', apptId, 'created', `APT-${String(apptId).padStart(5,'0')} created for ${start_time}`);
  res.status(201).json(withItems(db.prepare(`${APPT_SELECT} WHERE a.id=?`).get(apptId)));
});

router.patch('/:id', auth, (req, res) => {
  const { practitioner_id, client_id, location_type, location_id, location_other, title, start_time, end_time, notes, status, items, late_cancel_pct, late_cancel_billable, funding_period_id } = req.body;
  const { locationText, resolvedLocationId, locationOther } = resolveLocation(location_type, location_id, location_other);
  const before = db.prepare('SELECT * FROM appointments WHERE id=?').get(req.params.id);

  db.prepare(`
    UPDATE appointments SET practitioner_id=?, client_id=?, location=?, location_id=?, location_other=?, title=?, start_time=?, end_time=?, notes=?, status=?,
      late_cancel_pct=?, late_cancel_billable=?, funding_period_id=?
    WHERE id=?
  `).run(practitioner_id, client_id, locationText, resolvedLocationId, locationOther, title||null, start_time, end_time, notes||null, status||'scheduled',
    late_cancel_pct ?? null, late_cancel_billable ? 1 : 0, funding_period_id || null, req.params.id);

  if (items) {
    db.prepare('DELETE FROM appointment_items WHERE appointment_id=?').run(req.params.id);
    insertItems(req.params.id, items);
  }

  const changes = audit.diff(before, { practitioner_id, client_id, start_time, end_time, status, location: locationText }, ['practitioner_id','client_id','start_time','end_time','status','location']);
  if (changes) audit.log('appointment', Number(req.params.id), 'updated', changes, { ref: `APT-${String(req.params.id).padStart(5,'0')}` });

  const updated = withItems(db.prepare(`${APPT_SELECT} WHERE a.id=?`).get(req.params.id));
  res.json(updated);
});

router.patch('/:id/status', auth, (req, res) => {
  const { status, late_cancel_pct, late_cancel_billable } = req.body;
  const before = db.prepare('SELECT status FROM appointments WHERE id=?').get(req.params.id);
  db.prepare('UPDATE appointments SET status=?, late_cancel_pct=?, late_cancel_billable=? WHERE id=?')
    .run(status, late_cancel_pct ?? null, late_cancel_billable ? 1 : 0, req.params.id);
  audit.log('appointment', Number(req.params.id), 'status_changed', `Status: ${before?.status} → ${status}`, { ref: `APT-${String(req.params.id).padStart(5,'0')}` });
  res.json({ ok: true });
});

// Returns the applicable cancellation policy tier for a given appointment
router.get('/:id/cancel-policy', auth, (req, res) => {
  const appt = db.prepare('SELECT start_time FROM appointments WHERE id=?').get(req.params.id);
  if (!appt) return res.status(404).json({ error: 'Not found' });

  const raw = db.prepare("SELECT value FROM settings WHERE key='cancellation_policy'").get();
  let tiers = [];
  try { tiers = JSON.parse(raw?.value || '[]'); } catch {}

  const now = new Date();
  const apptDate = new Date(appt.start_time);
  const daysUntil = (apptDate - now) / (1000 * 60 * 60 * 24);

  // Find the most restrictive tier that applies (smallest days window that still covers daysUntil)
  const applicable = tiers
    .filter(t => daysUntil <= Number(t.days))
    .sort((a, b) => Number(a.days) - Number(b.days))[0] || null;

  res.json({ daysUntil: Math.round(daysUntil * 10) / 10, tier: applicable });
});

router.post('/:id/notify', auth, async (req, res) => {
  try {
    const { eventType = 'updated', target = 'both' } = req.body;
    const errors = await sendAppointmentNotification(req.params.id, eventType, { throwOnError: false, target });
    const failed = Object.entries(errors).filter(([, v]) => v).map(([k, v]) => `${k === 'practitionerError' ? 'Practitioner' : 'Client'}: ${v}`);
    if (failed.length) return res.status(207).json({ ok: false, errors: failed });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
