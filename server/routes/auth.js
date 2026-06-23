const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
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

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  const user = db.prepare('SELECT id, first_name, email FROM practitioners WHERE email = ? AND active = 1 AND password_hash IS NOT NULL').get(email?.toLowerCase());
  if (!user) return res.json({ ok: true });

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO password_resets (practitioner_id, token, expires_at) VALUES (?, ?, ?)').run(user.id, token, expiresAt);

  const settingsRows = db.prepare("SELECT key, value FROM settings WHERE key IN ('practice_name', 'graph_mailbox')").all();
  const settings = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));
  const practiceName = settings.practice_name || 'Therapy';

  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const resetUrl = `${protocol}://${host}/reset-password?token=${token}`;

  try {
    const { graphSend } = require('../services/mailer');
    await graphSend({
      from: settings.graph_mailbox,
      to: user.email,
      subject: `${practiceName} — Password Reset`,
      html: `
        <p>Hi ${user.first_name},</p>
        <p>A password reset was requested for your account. Click the link below to set a new password:</p>
        <p><a href="${resetUrl}" style="display:inline-block;padding:10px 20px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">Reset Password</a></p>
        <p>This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>
        <p>— ${practiceName}</p>
      `,
    });
  } catch (e) {
    console.error('Password reset email failed:', e.message);
    return res.status(500).json({ error: 'Failed to send reset email. Contact your administrator.' });
  }

  res.json({ ok: true });
});

router.post('/reset-password', (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token and password are required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const reset = db.prepare('SELECT * FROM password_resets WHERE token = ? AND used = 0 AND expires_at > ?').get(token, new Date().toISOString());
  if (!reset) return res.status(400).json({ error: 'Invalid or expired reset link' });

  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE practitioners SET password_hash = ? WHERE id = ?').run(hash, reset.practitioner_id);
  db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(reset.id);

  res.json({ ok: true });
});

module.exports = router;
