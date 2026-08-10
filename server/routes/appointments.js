const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');
const perm = require('../middleware/requirePermission');
const { permAny } = perm;
const { sendAppointmentNotification } = require('../services/mailer');
const audit = require('../services/audit');
const { notifyAppointmentChange } = require('../services/push');

const APPT_SELECT = `
  SELECT a.*,
    c.first_name || ' ' || c.last_name AS client_name,
    c.address AS client_address,
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
  const apptDate = appt.start_time ? appt.start_time.slice(0, 10) : new Date().toISOString().slice(0, 10);
  appt.items = db.prepare(`
    SELECT ai.*, s.name AS service_name, sr.code AS service_code
    FROM appointment_items ai
    LEFT JOIN services s ON s.id = ai.service_id
    LEFT JOIN funding_periods fp_direct ON fp_direct.id = ?
    LEFT JOIN funding_periods fp_date ON ? IS NULL AND fp_date.client_id = ?
      AND (fp_date.start_date IS NULL OR fp_date.start_date = '' OR fp_date.start_date <= ?)
      AND (fp_date.end_date IS NULL OR fp_date.end_date = '' OR fp_date.end_date >= ?)
    LEFT JOIN funding_types ft ON ft.name = COALESCE(fp_direct.funding_type, fp_date.funding_type)
    LEFT JOIN rate_periods rp ON rp.funding_type_id = ft.id AND ? BETWEEN rp.start_date AND rp.end_date
    LEFT JOIN service_rates sr ON sr.period_id = rp.id AND sr.service_id = ai.service_id
    WHERE ai.appointment_id = ?
  `).all(appt.funding_period_id, appt.funding_period_id, appt.client_id, apptDate, apptDate, apptDate, appt.id);
  return appt;
};

router.get('/', auth, perm('calendar'), (req, res) => {
  const { date, from, to, client_id, practitioner_id, series_id, status } = req.query;

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
  if (status)           { where += ' AND a.status = ?';          params.push(status); }

  const appointments = db.prepare(`${APPT_SELECT} WHERE ${where} ORDER BY a.start_time ASC`).all(...params);

  const ids = appointments.map(a => a.id);
  const items = ids.length
    ? db.prepare(`
        SELECT ai.*, s.name AS service_name, sr.code AS service_code
        FROM appointment_items ai
        LEFT JOIN services s ON s.id = ai.service_id
        LEFT JOIN appointments ap ON ap.id = ai.appointment_id
        LEFT JOIN funding_periods fp_direct ON fp_direct.id = ap.funding_period_id
        LEFT JOIN funding_periods fp_date ON ap.funding_period_id IS NULL AND fp_date.client_id = ap.client_id
          AND (fp_date.start_date IS NULL OR fp_date.start_date = '' OR fp_date.start_date <= DATE(ap.start_time))
          AND (fp_date.end_date IS NULL OR fp_date.end_date = '' OR fp_date.end_date >= DATE(ap.start_time))
        LEFT JOIN funding_types ft ON ft.name = COALESCE(fp_direct.funding_type, fp_date.funding_type)
        LEFT JOIN rate_periods rp ON rp.funding_type_id = ft.id AND DATE(ap.start_time) BETWEEN rp.start_date AND rp.end_date
        LEFT JOIN service_rates sr ON sr.period_id = rp.id AND sr.service_id = ai.service_id
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
router.get('/check-conflicts', auth, perm('calendar'), (req, res) => {
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

router.get('/:id', auth, permAny('calendar', 'invoices'), (req, res) => {
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

router.post('/', auth, perm('calendar'), (req, res) => {
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
  notifyAppointmentChange(apptId, 'created').catch(() => {});
  res.status(201).json(withItems(db.prepare(`${APPT_SELECT} WHERE a.id=?`).get(apptId)));
});

router.patch('/:id', auth, perm('calendar'), (req, res) => {
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
    const existing = db.prepare('SELECT service_id, description, quantity, unit_rate, travel_time_to, travel_time_from, travel_km, prep_time_min, item_notes, notes_min FROM appointment_items WHERE appointment_id = ? ORDER BY id').all(req.params.id);
    const normalize = i => JSON.stringify([
      i.service_id||null, i.description||'', Number(i.quantity)||1, Number(i.unit_rate)||0,
      Number(i.travel_time_to)||0, Number(i.travel_time_from)||0, Number(i.travel_km)||0,
      Number(i.prep_time_min)||0, i.item_notes||'', Number(i.notes_min)||0,
    ]);
    const changed = existing.length !== items.length || existing.some((e, idx) => normalize(e) !== normalize(items[idx]));
    if (changed) {
      db.prepare('UPDATE invoice_items SET appointment_item_id = NULL WHERE appointment_item_id IN (SELECT id FROM appointment_items WHERE appointment_id = ?)').run(req.params.id);
      db.prepare('DELETE FROM appointment_items WHERE appointment_id=?').run(req.params.id);
      insertItems(req.params.id, items);
    }
  }

  const changes = audit.diff(before, { practitioner_id, client_id, start_time, end_time, status, location: locationText }, ['practitioner_id','client_id','start_time','end_time','status','location']);
  if (changes) audit.log('appointment', Number(req.params.id), 'updated', changes, {
    ref: `APT-${String(req.params.id).padStart(5,'0')}`,
    snapshot: { before_start_time: before.start_time, before_end_time: before.end_time },
  });
  notifyAppointmentChange(Number(req.params.id), 'updated').catch(() => {});

  const updated = withItems(db.prepare(`${APPT_SELECT} WHERE a.id=?`).get(req.params.id));
  res.json(updated);
});

router.patch('/:id/status', auth, perm('calendar'), (req, res) => {
  const { status, late_cancel_pct, late_cancel_billable } = req.body;
  const before = db.prepare('SELECT status FROM appointments WHERE id=?').get(req.params.id);
  db.prepare('UPDATE appointments SET status=?, late_cancel_pct=?, late_cancel_billable=? WHERE id=?')
    .run(status, late_cancel_pct ?? null, late_cancel_billable ? 1 : 0, req.params.id);
  audit.log('appointment', Number(req.params.id), 'status_changed', `Status: ${before?.status} → ${status}`, { ref: `APT-${String(req.params.id).padStart(5,'0')}` });
  if (status === 'cancelled') notifyAppointmentChange(Number(req.params.id), 'cancelled').catch(() => {});
  res.json({ ok: true });
});

// Counts weekdays (Mon–Fri) strictly between "now" and "until", both truncated to whole
// calendar days — i.e. how many business days' notice was given. Today itself never counts,
// so a same-day or past-due cancellation is always 0.
function businessDaysUntil(now, until) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(until.getFullYear(), until.getMonth(), until.getDate());
  if (end <= start) return 0;
  let count = 0;
  const d = new Date(start);
  d.setDate(d.getDate() + 1);
  while (d <= end) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

// Returns the applicable cancellation policy tier for a given appointment
router.get('/:id/cancel-policy', auth, perm('calendar'), (req, res) => {
  const appt = db.prepare('SELECT start_time FROM appointments WHERE id=?').get(req.params.id);
  if (!appt) return res.status(404).json({ error: 'Not found' });

  const raw = db.prepare("SELECT value FROM settings WHERE key='cancellation_policy'").get();
  let tiers = [];
  try { tiers = JSON.parse(raw?.value || '[]'); } catch {}

  const now = new Date();
  const apptDate = new Date(appt.start_time);
  const daysUntil = businessDaysUntil(now, apptDate);

  // Find the most restrictive tier that applies (smallest business-day window that still covers daysUntil)
  const applicable = tiers
    .filter(t => daysUntil <= Number(t.days))
    .sort((a, b) => Number(a.days) - Number(b.days))[0] || null;

  res.json({ daysUntil, tier: applicable });
});

router.post('/:id/notify', auth, perm('calendar'), async (req, res) => {
  try {
    const { eventType = 'updated', target = 'both', scope } = req.body;
    const errors = await sendAppointmentNotification(req.params.id, eventType, { throwOnError: false, target, scope });
    const failed = Object.entries(errors).filter(([, v]) => v).map(([k, v]) => `${k === 'practitionerError' ? 'Practitioner' : 'Client'}: ${v}`);
    if (failed.length) return res.status(207).json({ ok: false, errors: failed });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
