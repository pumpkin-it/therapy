const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');

const CLIENT_SELECT = `
  SELECT c.*,
    fp_active.funding_type AS active_funding_type,
    fp_active.start_date AS active_period_start,
    fp_active.end_date AS active_period_end,
    fm_active.name AS active_funds_manager_name,
    fm_legacy.name AS funds_manager_name, fm_legacy.email AS funds_manager_email
  FROM clients c
  LEFT JOIN funding_periods fp_active ON fp_active.id = (
    SELECT id FROM funding_periods
    WHERE client_id = c.id
      AND DATE(start_date) <= DATE('now') AND DATE(end_date) >= DATE('now')
    ORDER BY start_date DESC LIMIT 1
  )
  LEFT JOIN funds_managers fm_active ON fm_active.id = fp_active.funds_manager_id
  LEFT JOIN funds_managers fm_legacy ON fm_legacy.id = c.funds_manager_id
`;

router.get('/', auth, (req, res) => {
  const { search, active } = req.query;
  // active=0 → inactive only, active=1 → active only (default), active=all → both
  const activeFilter = active === 'all' ? null : active === '0' ? 0 : 1;
  const whereParts = [];
  const params = [];
  if (activeFilter !== null) { whereParts.push('c.active = ?'); params.push(activeFilter); }
  if (search) {
    const q = `%${search}%`;
    whereParts.push('(c.first_name LIKE ? OR c.last_name LIKE ? OR c.email LIKE ? OR c.ndis_number LIKE ?)');
    params.push(q, q, q, q);
  }
  const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
  const rows = db.prepare(`${CLIENT_SELECT} ${where} ORDER BY c.last_name, c.first_name`).all(...params);
  res.json(rows);
});

router.get('/:id', auth, (req, res) => {
  const client = db.prepare(`${CLIENT_SELECT} WHERE c.id = ?`).get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Not found' });
  const appointments = db.prepare(`
    SELECT a.*, p.first_name || ' ' || p.last_name AS practitioner_name
    FROM appointments a
    JOIN practitioners p ON p.id = a.practitioner_id
    WHERE a.client_id = ? ORDER BY a.start_time DESC LIMIT 20
  `).all(req.params.id);
  const invoices = db.prepare('SELECT * FROM invoices WHERE client_id = ? ORDER BY created_at DESC LIMIT 10').all(req.params.id);
  res.json({ ...client, appointments, invoices });
});

router.post('/', auth, (req, res) => {
  const {
    first_name, last_name, email, phone, date_of_birth, address, ndis_number, notes, alert,
    emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, emergency_contact_email,
    diagnosis, allergies, regular_medication,
  } = req.body;
  const result = db.prepare(`
    INSERT INTO clients (first_name, last_name, email, phone, date_of_birth, address, ndis_number, notes, alert,
      emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, emergency_contact_email,
      diagnosis, allergies, regular_medication)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    first_name, last_name, email||null, phone||null, date_of_birth||null, address||null, ndis_number||null, notes||null, alert||null,
    emergency_contact_name||null, emergency_contact_phone||null, emergency_contact_relationship||null, emergency_contact_email||null,
    diagnosis||null, allergies||null, regular_medication||null,
  );
  res.status(201).json(db.prepare(`${CLIENT_SELECT} WHERE c.id = ?`).get(result.lastInsertRowid));
});

router.patch('/:id', auth, (req, res) => {
  const {
    first_name, last_name, email, phone, date_of_birth, address, ndis_number, notes, alert,
    emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, emergency_contact_email,
    diagnosis, allergies, regular_medication,
  } = req.body;
  db.prepare(`
    UPDATE clients SET
      first_name=?, last_name=?, email=?, phone=?, date_of_birth=?, address=?, ndis_number=?, notes=?, alert=?,
      emergency_contact_name=?, emergency_contact_phone=?, emergency_contact_relationship=?, emergency_contact_email=?,
      diagnosis=?, allergies=?, regular_medication=?
    WHERE id=?
  `).run(
    first_name, last_name, email||null, phone||null, date_of_birth||null, address||null, ndis_number||null, notes||null, alert||null,
    emergency_contact_name||null, emergency_contact_phone||null, emergency_contact_relationship||null, emergency_contact_email||null,
    diagnosis||null, allergies||null, regular_medication||null,
    req.params.id,
  );
  res.json(db.prepare(`${CLIENT_SELECT} WHERE c.id = ?`).get(req.params.id));
});

router.patch('/:id/active', auth, (req, res) => {
  db.prepare('UPDATE clients SET active=? WHERE id=?').run(req.body.active ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', auth, (req, res) => {
  db.prepare('UPDATE clients SET active = 0 WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

module.exports = router;
