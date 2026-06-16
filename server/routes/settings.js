const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');

router.get('/', auth, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
  // Never expose smtp password
  delete settings.smtp_pass;
  res.json(settings);
});

router.patch('/', auth, (req, res) => {
  const update = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const tx = db.transaction((data) => {
    for (const [key, value] of Object.entries(data)) {
      update.run(key, String(value));
    }
  });
  tx(req.body);
  res.json({ ok: true });
});

module.exports = router;
