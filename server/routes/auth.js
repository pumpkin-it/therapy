const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database');

const JWT_SECRET = process.env.JWT_SECRET || 'pm_dev_secret';

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM practitioners WHERE email = ? AND active = 1').get(email?.toLowerCase());
  if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role || 'practitioner' }, JWT_SECRET, { expiresIn: '8h' });

  const permsRow = db.prepare("SELECT value FROM settings WHERE key='role_permissions'").get();
  let permissions = {};
  try { permissions = JSON.parse(permsRow?.value || '{}')[user.role || 'practitioner'] || {}; } catch {}

  res.json({
    token,
    user: { id: user.id, first_name: user.first_name, last_name: user.last_name, email: user.email, role: user.role || 'practitioner', permissions },
  });
});

router.get('/me', require('../middleware/auth'), (req, res) => {
  const user = db.prepare('SELECT id, first_name, last_name, email, role FROM practitioners WHERE id = ?').get(req.user.id);
  if (!user) return res.status(401).json({ error: 'User not found' });

  const permsRow = db.prepare("SELECT value FROM settings WHERE key='role_permissions'").get();
  let permissions = {};
  try { permissions = JSON.parse(permsRow?.value || '{}')[user.role || 'practitioner'] || {}; } catch {}

  res.json({ ...user, permissions });
});

module.exports = router;
