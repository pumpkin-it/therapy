const router = require('express').Router();
const db = require('../database');
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');
const perm = require('../middleware/requirePermission');
const { permAny } = perm;
const audit = require('../services/audit');

// 'calendar' is included so any practitioner (who always has calendar:true) can populate the
// practitioner dropdown on Calendar/AppointmentModal — but unlike the 'users'/'invoices' callers
// (Users admin page, Invoices screen), a practitioner has no business seeing every colleague's
// password_hash, so this now selects only the columns those UIs actually render instead of `*`.
router.get('/', auth, permAny('users', 'invoices', 'calendar'), (req, res) => {
  const { active, role } = req.query;
  const activeFilter = active === 'all' ? null : active === '0' ? 0 : 1;
  const conditions = [];
  const params = [];
  if (activeFilter !== null) { conditions.push('active = ?'); params.push(activeFilter); }
  if (role) { conditions.push('role = ?'); params.push(role); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  // Only the newly-added 'calendar' carve-out (i.e. plain practitioners) gets the restricted
  // column list — owner/admin/finance callers keep the existing `SELECT *` behavior unchanged.
  const columns = req.user.role === 'practitioner'
    ? 'id, first_name, last_name, title, email, phone, color, role, active, provider_number, created_at'
    : '*';
  const rows = db.prepare(`SELECT ${columns} FROM practitioners ${where} ORDER BY first_name, last_name`).all(...params);
  res.json(rows);
});

router.get('/check-duplicates', auth, perm('users'), (req, res) => {
  const { first_name, last_name, exclude_id } = req.query;
  if (!first_name && !last_name) return res.json([]);
  const conditions = ['LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?)'];
  const params = [first_name || '', last_name || ''];
  if (exclude_id) { conditions.push('id != ?'); params.push(exclude_id); }
  const matches = db.prepare(`SELECT id, first_name, last_name, email, role FROM practitioners WHERE ${conditions.join(' AND ')}`).all(...params);
  res.json(matches);
});

router.get('/:id', auth, perm('users'), (req, res) => {
  const row = db.prepare('SELECT * FROM practitioners WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.post('/', auth, perm('users'), async (req, res, next) => {
  try {
    const { first_name, last_name, title, email, phone, color, provider_number, role, gender, discipline_id, password, target_amount, target_period } = req.body;
    if (email) {
      const existing = db.prepare('SELECT id FROM practitioners WHERE LOWER(email) = LOWER(?) LIMIT 1').get(email);
      if (existing) return res.status(409).json({ field: 'email', message: `A user with email "${email}" already exists` });
    }
    if (!password && !email) {
      return res.status(400).json({ error: 'Provide either a password or an email address (to send a set-password link).' });
    }
    const hash = password ? bcrypt.hashSync(password, 10) : null;
    const result = db.prepare(
      'INSERT INTO practitioners (first_name, last_name, title, email, phone, color, provider_number, role, gender, discipline_id, password_hash, target_amount, target_period) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(first_name, last_name, title || null, email || null, phone || null, color || '#6366f1', provider_number || null, role || 'practitioner', gender || null, discipline_id || null, hash, target_amount ? Number(target_amount) : null, target_period || null);
    audit.log('user', result.lastInsertRowid, 'created', `Created user ${first_name} ${last_name} (${role || 'practitioner'})`);
    const created = db.prepare('SELECT * FROM practitioners WHERE id = ?').get(result.lastInsertRowid);

    let setPasswordEmail = null;
    if (!password && email) {
      try {
        const { sendSetPasswordEmail } = require('../services/mailer');
        await sendSetPasswordEmail(created, { isNew: true });
        setPasswordEmail = { sent: true };
      } catch (e) {
        setPasswordEmail = { sent: false, error: e.message };
      }
    }
    res.status(201).json({ ...created, setPasswordEmail });
  } catch (e) { next(e); }
});

router.patch('/:id', auth, perm('users'), (req, res) => {
  const { first_name, last_name, title, email, phone, color, provider_number, role, gender, discipline_id, password, target_amount, target_period } = req.body;
  if (email) {
    const existing = db.prepare('SELECT id FROM practitioners WHERE LOWER(email) = LOWER(?) AND id != ? LIMIT 1').get(email, req.params.id);
    if (existing) return res.status(409).json({ field: 'email', message: `A user with email "${email}" already exists` });
  }
  const before = db.prepare('SELECT * FROM practitioners WHERE id=?').get(req.params.id);
  db.prepare(
    'UPDATE practitioners SET first_name=?, last_name=?, title=?, email=?, phone=?, color=?, provider_number=?, role=?, gender=?, discipline_id=?, target_amount=?, target_period=? WHERE id=?'
  ).run(first_name, last_name, title || null, email || null, phone || null, color || '#6366f1', provider_number || null, role || 'practitioner', gender || null, discipline_id || null, target_amount ? Number(target_amount) : null, target_period || null, req.params.id);
  if (password) {
    db.prepare('UPDATE practitioners SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password, 10), req.params.id);
  }
  const changes = audit.diff(before, req.body, ['first_name','last_name','title','email','phone','role','gender','provider_number','target_amount','target_period']);
  if (changes) audit.log('user', Number(req.params.id), 'updated', changes);
  res.json(db.prepare('SELECT * FROM practitioners WHERE id = ?').get(req.params.id));
});

router.patch('/:id/active', auth, perm('users'), (req, res) => {
  db.prepare('UPDATE practitioners SET active=? WHERE id=?').run(req.body.active ? 1 : 0, req.params.id);
  audit.log('user', Number(req.params.id), req.body.active ? 'reactivated' : 'deactivated', `User ${req.body.active ? 'reactivated' : 'deactivated'}`);
  res.json({ ok: true });
});

router.post('/:id/send-set-password', auth, perm('users'), async (req, res, next) => {
  try {
    const p = db.prepare('SELECT * FROM practitioners WHERE id = ?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    if (!p.email) return res.status(400).json({ error: 'This user has no email address on file.' });
    const { sendSetPasswordEmail } = require('../services/mailer');
    // No password set yet (e.g. a resend of the original welcome link) reads as a welcome email
    // with the longer expiry; an admin resetting an already-active account is a tighter-window reset.
    await sendSetPasswordEmail(p, { isNew: !p.password_hash });
    audit.log('user', p.id, 'password_reset_sent', `Set-password link sent to ${p.email}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to send email' });
  }
});

router.post('/:id/reset-cal-token', auth, perm('users'), (req, res) => {
  const crypto = require('crypto');
  const token = crypto.randomBytes(20).toString('hex');
  db.prepare('UPDATE practitioners SET cal_token = ? WHERE id = ?').run(token, req.params.id);
  res.json({ cal_token: token });
});

router.delete('/:id', auth, perm('users'), (req, res) => {
  db.prepare('UPDATE practitioners SET active = 0 WHERE id = ?').run(req.params.id);
  audit.log('user', Number(req.params.id), 'deactivated', 'User deactivated');
  res.status(204).send();
});

module.exports = router;
