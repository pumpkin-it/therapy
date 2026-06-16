const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');

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

router.get('/', auth, (req, res) => {
  const { date, from, to, client_id, practitioner_id } = req.query;

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

router.get('/:id', auth, (req, res) => {
  const appt = db.prepare(`${APPT_SELECT} WHERE a.id = ?`).get(req.params.id);
  if (!appt) return res.status(404).json({ error: 'Not found' });
  appt.items = db.prepare(`
    SELECT ai.*, s.name AS service_name, s.code AS service_code
    FROM appointment_items ai
    LEFT JOIN services s ON s.id = ai.service_id WHERE ai.appointment_id = ?
  `).all(req.params.id);
  res.json(appt);
});

router.post('/', auth, (req, res) => {
  const { practitioner_id, client_id, location_type, location_id, title, start_time, end_time, notes, items = [] } = req.body;
  // location_type: 'home' | 'clinic'
  const resolvedLocationId = location_type === 'clinic' ? (location_id || null) : null;
  const locationText = location_type === 'home' ? 'Client Home' : null;

  const result = db.prepare(`
    INSERT INTO appointments (practitioner_id, client_id, location, location_id, title, start_time, end_time, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(practitioner_id, client_id, locationText, resolvedLocationId, title||null, start_time, end_time, notes||null);

  const apptId = result.lastInsertRowid;
  const insertItem = db.prepare(`
    INSERT INTO appointment_items (appointment_id, service_id, description, quantity, unit_rate, travel_time_min, travel_km, prep_time_min)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const item of items) {
    insertItem.run(apptId, item.service_id||null, item.description, item.quantity||1, item.unit_rate, item.travel_time_min||null, item.travel_km||null, item.prep_time_min||null);
  }

  const appt = db.prepare(`${APPT_SELECT} WHERE a.id=?`).get(apptId);
  appt.items = db.prepare('SELECT * FROM appointment_items WHERE appointment_id=?').all(apptId);
  res.status(201).json(appt);
});

router.patch('/:id', auth, (req, res) => {
  const { practitioner_id, client_id, location_type, location_id, title, start_time, end_time, notes, status, items } = req.body;
  const resolvedLocationId = location_type === 'clinic' ? (location_id || null) : null;
  const locationText = location_type === 'home' ? 'Client Home' : null;

  db.prepare(`
    UPDATE appointments SET practitioner_id=?, client_id=?, location=?, location_id=?, title=?, start_time=?, end_time=?, notes=?, status=? WHERE id=?
  `).run(practitioner_id, client_id, locationText, resolvedLocationId, title||null, start_time, end_time, notes||null, status||'scheduled', req.params.id);

  if (items) {
    db.prepare('DELETE FROM appointment_items WHERE appointment_id=?').run(req.params.id);
    const insertItem = db.prepare(`
      INSERT INTO appointment_items (appointment_id, service_id, description, quantity, unit_rate, travel_time_min, travel_km, prep_time_min)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of items) {
      insertItem.run(req.params.id, item.service_id||null, item.description, item.quantity||1, item.unit_rate, item.travel_time_min||null, item.travel_km||null, item.prep_time_min||null);
    }
  }

  const appt = db.prepare(`${APPT_SELECT} WHERE a.id=?`).get(req.params.id);
  appt.items = db.prepare('SELECT * FROM appointment_items WHERE appointment_id=?').all(req.params.id);
  res.json(appt);
});

router.patch('/:id/status', auth, (req, res) => {
  db.prepare('UPDATE appointments SET status=? WHERE id=?').run(req.body.status, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
