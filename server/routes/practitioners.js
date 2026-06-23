const router = require('express').Router();
const db = require('../database');
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');
const audit = require('../services/audit');

router.get('/', auth, (req, res) => {
  const { active, role } = req.query;
  const activeFilter = active === 'all' ? null : active === '0' ? 0 : 1;
  const conditions = [];
  const params = [];
  if (activeFilter !== null) { conditions.push('active = ?'); params.push(activeFilter); }
  if (role) { conditions.push('role = ?'); params.push(role); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM practitioners ${where} ORDER BY last_name, first_name`).all(...params);
  res.json(rows);
});

router.get('/:id', auth, (req, res) => {
  const row = db.prepare('SELECT * FROM practitioners WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.post('/', auth, (req, res) => {
  const { first_name, last_name, title, email, phone, color, provider_number, role, gender, discipline_id, password } = req.body;
  const hash = password ? bcrypt.hashSync(password, 10) : null;
  const result = db.prepare(
    'INSERT INTO practitioners (first_name, last_name, title, email, phone, color, provider_number, role, gender, discipline_id, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(first_name, last_name, title || null, email || null, phone || null, color || '#6366f1', provider_number || null, role || 'practitioner', gender || null, discipline_id || null, hash);
  audit.log('user', result.lastInsertRowid, 'created', `Created user ${first_name} ${last_name} (${role || 'practitioner'})`);
  res.status(201).json(db.prepare('SELECT * FROM practitioners WHERE id = ?').get(result.lastInsertRowid));
});

router.patch('/:id', auth, (req, res) => {
  const { first_name, last_name, title, email, phone, color, provider_number, role, gender, discipline_id, password } = req.body;
  const before = db.prepare('SELECT * FROM practitioners WHERE id=?').get(req.params.id);
  db.prepare(
    'UPDATE practitioners SET first_name=?, last_name=?, title=?, email=?, phone=?, color=?, provider_number=?, role=?, gender=?, discipline_id=? WHERE id=?'
  ).run(first_name, last_name, title || null, email || null, phone || null, color || '#6366f1', provider_number || null, role || 'practitioner', gender || null, discipline_id || null, req.params.id);
  if (password) {
    db.prepare('UPDATE practitioners SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password, 10), req.params.id);
  }
  const changes = audit.diff(before, req.body, ['first_name','last_name','title','email','phone','role','gender','provider_number']);
  if (changes) audit.log('user', Number(req.params.id), 'updated', changes);
  res.json(db.prepare('SELECT * FROM practitioners WHERE id = ?').get(req.params.id));
});

router.patch('/:id/active', auth, (req, res) => {
  db.prepare('UPDATE practitioners SET active=? WHERE id=?').run(req.body.active ? 1 : 0, req.params.id);
  audit.log('user', Number(req.params.id), req.body.active ? 'reactivated' : 'deactivated', `User ${req.body.active ? 'reactivated' : 'deactivated'}`);
  res.json({ ok: true });
});

router.delete('/:id', auth, (req, res) => {
  db.prepare('UPDATE practitioners SET active = 0 WHERE id = ?').run(req.params.id);
  audit.log('user', Number(req.params.id), 'deactivated', 'User deactivated');
  res.status(204).send();
});

module.exports = router;
