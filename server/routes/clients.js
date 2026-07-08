const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');
const audit = require('../services/audit');
const { getClientSpend } = require('../services/budgets');

const CLIENT_SELECT = `
  SELECT c.*,
    fp_active.funding_type AS active_funding_type,
    fp_active.start_date AS active_period_start,
    fp_active.end_date AS active_period_end,
    CASE WHEN fp_active.ndis_management = 'self' AND fm_active.name IS NULL THEN 'Self Managed' ELSE fm_active.name END AS active_funds_manager_name,
    fm_legacy.name AS funds_manager_name, fm_legacy.email AS funds_manager_email
  FROM clients c
  LEFT JOIN funding_periods fp_active ON fp_active.id = (
    SELECT id FROM funding_periods
    WHERE client_id = c.id
      AND (start_date IS NULL OR start_date = '' OR DATE(start_date) <= DATE('now')) AND (end_date IS NULL OR end_date = '' OR DATE(end_date) >= DATE('now'))
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
  const rows = db.prepare(`${CLIENT_SELECT} ${where} ORDER BY c.first_name, c.last_name`).all(...params);
  res.json(rows);
});

router.get('/check-duplicates', auth, (req, res) => {
  const { first_name, last_name, email, exclude_id } = req.query;
  const matches = [];
  const seen = new Set();
  if (first_name && last_name) {
    const conditions = ['LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?)'];
    const params = [first_name, last_name];
    if (exclude_id) { conditions.push('id != ?'); params.push(exclude_id); }
    for (const r of db.prepare(`SELECT id, first_name, last_name, email, ndis_number FROM clients WHERE ${conditions.join(' AND ')}`).all(...params)) {
      matches.push({ ...r, match_type: 'name' }); seen.add(r.id);
    }
  }
  if (email) {
    const conditions = ["LOWER(email) = LOWER(?)"];
    const params = [email];
    if (exclude_id) { conditions.push('id != ?'); params.push(exclude_id); }
    for (const r of db.prepare(`SELECT id, first_name, last_name, email, ndis_number FROM clients WHERE ${conditions.join(' AND ')}`).all(...params)) {
      if (!seen.has(r.id)) matches.push({ ...r, match_type: 'email' });
    }
  }
  res.json(matches);
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

// Billables summary — invoiced + projected spend over an arbitrary date range, independent of
// any agreement/budget. Defaults to the last 12 months when from/to are omitted.
router.get('/:id/spend', auth, (req, res) => {
  let { from, to } = req.query;
  if (!to) to = new Date().toISOString().slice(0, 10);
  if (!from) {
    const d = new Date(to);
    d.setFullYear(d.getFullYear() - 1);
    from = d.toISOString().slice(0, 10);
  }
  res.json({ from, to, ...getClientSpend(req.params.id, from, to) });
});

router.post('/', auth, (req, res) => {
  const {
    first_name, last_name, email, phone, date_of_birth, address, ndis_number, notes, alert,
    emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, emergency_contact_email,
    diagnosis, allergies, regular_medication, gender,
  } = req.body;
  if (ndis_number) {
    const existing = db.prepare('SELECT id FROM clients WHERE LOWER(ndis_number) = LOWER(?) LIMIT 1').get(ndis_number);
    if (existing) return res.status(409).json({ field: 'ndis_number', message: `A client with NDIS number "${ndis_number}" already exists` });
  }
  const result = db.prepare(`
    INSERT INTO clients (first_name, last_name, email, phone, date_of_birth, address, ndis_number, notes, alert,
      emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, emergency_contact_email,
      diagnosis, allergies, regular_medication, gender)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    first_name, last_name, email||null, phone||null, date_of_birth||null, address||null, ndis_number||null, notes||null, alert||null,
    emergency_contact_name||null, emergency_contact_phone||null, emergency_contact_relationship||null, emergency_contact_email||null,
    diagnosis||null, allergies||null, regular_medication||null, gender||null,
  );
  const newClient = db.prepare(`${CLIENT_SELECT} WHERE c.id = ?`).get(result.lastInsertRowid);
  audit.log('client', newClient.id, 'created', `Created client ${first_name} ${last_name}`);
  res.status(201).json(newClient);
});

router.patch('/:id', auth, (req, res) => {
  const {
    first_name, last_name, email, phone, date_of_birth, address, ndis_number, notes, alert,
    emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, emergency_contact_email,
    diagnosis, allergies, regular_medication, gender,
  } = req.body;
  if (ndis_number) {
    const existing = db.prepare('SELECT id FROM clients WHERE LOWER(ndis_number) = LOWER(?) AND id != ? LIMIT 1').get(ndis_number, req.params.id);
    if (existing) return res.status(409).json({ field: 'ndis_number', message: `A client with NDIS number "${ndis_number}" already exists` });
  }
  const before = db.prepare('SELECT * FROM clients WHERE id=?').get(req.params.id);
  db.prepare(`
    UPDATE clients SET
      first_name=?, last_name=?, email=?, phone=?, date_of_birth=?, address=?, ndis_number=?, notes=?, alert=?,
      emergency_contact_name=?, emergency_contact_phone=?, emergency_contact_relationship=?, emergency_contact_email=?,
      diagnosis=?, allergies=?, regular_medication=?, gender=?
    WHERE id=?
  `).run(
    first_name, last_name, email||null, phone||null, date_of_birth||null, address||null, ndis_number||null, notes||null, alert||null,
    emergency_contact_name||null, emergency_contact_phone||null, emergency_contact_relationship||null, emergency_contact_email||null,
    diagnosis||null, allergies||null, regular_medication||null, gender||null,
    req.params.id,
  );
  const changes = audit.diff(before, req.body, ['first_name','last_name','email','phone','date_of_birth','address','gender','ndis_number','notes','alert']);
  if (changes) audit.log('client', Number(req.params.id), 'updated', changes);
  res.json(db.prepare(`${CLIENT_SELECT} WHERE c.id = ?`).get(req.params.id));
});

router.patch('/:id/active', auth, (req, res) => {
  db.prepare('UPDATE clients SET active=? WHERE id=?').run(req.body.active ? 1 : 0, req.params.id);
  audit.log('client', Number(req.params.id), req.body.active ? 'reactivated' : 'deactivated', `Client ${req.body.active ? 'reactivated' : 'deactivated'}`);
  res.json({ ok: true });
});

router.delete('/:id', auth, (req, res) => {
  db.prepare('UPDATE clients SET active = 0 WHERE id = ?').run(req.params.id);
  audit.log('client', Number(req.params.id), 'deactivated', 'Client deactivated');
  res.status(204).send();
});

module.exports = router;
