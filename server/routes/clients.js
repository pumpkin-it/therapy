const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');

const CLIENT_SELECT = `
  SELECT c.*, fm.name AS funds_manager_name, fm.email AS funds_manager_email
  FROM clients c
  LEFT JOIN funds_managers fm ON fm.id = c.funds_manager_id
`;

router.get('/', auth, (req, res) => {
  const { search } = req.query;
  let rows;
  if (search) {
    const q = `%${search}%`;
    rows = db.prepare(`
      ${CLIENT_SELECT}
      WHERE c.active = 1
      AND (c.first_name LIKE ? OR c.last_name LIKE ? OR c.email LIKE ? OR c.ndis_number LIKE ?)
      ORDER BY c.last_name, c.first_name
    `).all(q, q, q, q);
  } else {
    rows = db.prepare(`${CLIENT_SELECT} WHERE c.active = 1 ORDER BY c.last_name, c.first_name`).all();
  }
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
  const { first_name, last_name, email, phone, date_of_birth, address, ndis_number, funding_type, funds_manager_id, plan_start_date, plan_end_date, notes } = req.body;
  const result = db.prepare(`
    INSERT INTO clients (first_name, last_name, email, phone, date_of_birth, address, ndis_number, funding_type, funds_manager_id, plan_start_date, plan_end_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(first_name, last_name, email||null, phone||null, date_of_birth||null, address||null, ndis_number||null, funding_type||null, funds_manager_id||null, plan_start_date||null, plan_end_date||null, notes||null);
  res.status(201).json(db.prepare(`${CLIENT_SELECT} WHERE c.id = ?`).get(result.lastInsertRowid));
});

router.patch('/:id', auth, (req, res) => {
  const { first_name, last_name, email, phone, date_of_birth, address, ndis_number, funding_type, funds_manager_id, plan_start_date, plan_end_date, notes } = req.body;
  db.prepare(`
    UPDATE clients SET first_name=?, last_name=?, email=?, phone=?, date_of_birth=?, address=?, ndis_number=?, funding_type=?, funds_manager_id=?, plan_start_date=?, plan_end_date=?, notes=? WHERE id=?
  `).run(first_name, last_name, email||null, phone||null, date_of_birth||null, address||null, ndis_number||null, funding_type||null, funds_manager_id||null, plan_start_date||null, plan_end_date||null, notes||null, req.params.id);
  res.json(db.prepare(`${CLIENT_SELECT} WHERE c.id = ?`).get(req.params.id));
});

router.delete('/:id', auth, (req, res) => {
  db.prepare('UPDATE clients SET active = 0 WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

module.exports = router;
