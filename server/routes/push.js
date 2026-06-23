const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');

router.post('/register', auth, (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required' });

  db.prepare('DELETE FROM push_tokens WHERE practitioner_id = ? AND token = ?').run(req.user.id, token);
  db.prepare('INSERT OR REPLACE INTO push_tokens (practitioner_id, token) VALUES (?, ?)').run(req.user.id, token);
  res.json({ ok: true });
});

router.post('/unregister', auth, (req, res) => {
  const { token } = req.body;
  if (token) {
    db.prepare('DELETE FROM push_tokens WHERE practitioner_id = ? AND token = ?').run(req.user.id, token);
  } else {
    db.prepare('DELETE FROM push_tokens WHERE practitioner_id = ?').run(req.user.id);
  }
  res.json({ ok: true });
});

module.exports = router;
