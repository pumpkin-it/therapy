const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../database');
const JWT_SECRET = require('../lib/jwtSecret');
const { rateLimiter } = require('../lib/rateLimit');
const { MIN_PASSWORD } = require('../lib/passwordPolicy');
// Reset tokens are stored as a SHA-256 hash, so a copy of the database can't be used to reset passwords.
const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('hex');

// Keyed on IP + email, so one person mistyping never locks out anyone else (and behind nginx,
// where every request may share one IP, a flood on one address can't lock out the rest).
const loginLimit = rateLimiter({ max: 10, windowMs: 15 * 60 * 1000 });   // failed attempts
const forgotLimit = rateLimiter({ max: 5, windowMs: 60 * 60 * 1000 });
const resetLimit = rateLimiter({ max: 30, windowMs: 15 * 60 * 1000 });
const tooMany = (res, wait) => res.status(429).json({ error: `Too many attempts — try again in ${Math.ceil(wait / 60)} minute${wait > 60 ? 's' : ''}.` });

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const key = `${req.ip}|${String(email || '').toLowerCase()}`;
  const locked = loginLimit.blocked(key);
  if (locked) return tooMany(res, locked);
  const user = db.prepare('SELECT * FROM practitioners WHERE email = ? AND active = 1').get(email?.toLowerCase());
  if (!user || !user.password_hash || !password || !bcrypt.compareSync(String(password), user.password_hash)) {
    const wait = loginLimit.hit(key);
    if (wait) return tooMany(res, wait);
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  loginLimit.reset(key);
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

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  const wait = forgotLimit.hit(`${req.ip}|${String(email || '').toLowerCase()}`);
  if (wait) return tooMany(res, wait);
  const user = db.prepare('SELECT id, first_name, email FROM practitioners WHERE email = ? AND active = 1 AND password_hash IS NOT NULL').get(email?.toLowerCase());
  if (!user) return res.json({ ok: true });

  try {
    const { sendSetPasswordEmail } = require('../services/mailer');
    await sendSetPasswordEmail(user, { isNew: false });
  } catch (e) {
    console.error('Password reset email failed:', e.message);
    return res.status(500).json({ error: 'Failed to send reset email. Contact your administrator.' });
  }

  res.json({ ok: true });
});

router.post('/reset-password', (req, res) => {
  const { token, password } = req.body;
  const wait = resetLimit.hit(req.ip);
  if (wait) return tooMany(res, wait);
  if (!token || !password) return res.status(400).json({ error: 'Token and password are required' });
  if (String(password).length < MIN_PASSWORD) return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` });

  const reset = db.prepare('SELECT * FROM password_resets WHERE token = ? AND used = 0 AND expires_at > ?').get(hashToken(token), new Date().toISOString());
  if (!reset) return res.status(400).json({ error: 'Invalid or expired reset link' });

  const hash = bcrypt.hashSync(String(password), 10);
  db.prepare('UPDATE practitioners SET password_hash = ? WHERE id = ?').run(hash, reset.practitioner_id);
  // Any other outstanding link for this user is spent too.
  db.prepare('UPDATE password_resets SET used = 1 WHERE practitioner_id = ?').run(reset.practitioner_id);

  res.json({ ok: true });
});

module.exports = router;
