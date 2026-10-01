const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');
const perm = require('../middleware/requirePermission');
const { sendTestEmail } = require('../services/mailer');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadsDir = path.join(__dirname, '../../uploads');
const logoStorage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_req, _file, cb) => cb(null, 'logo'),
});
const logoUpload = multer({ storage: logoStorage, limits: { fileSize: 2 * 1024 * 1024 } });

// Everyone signed in reads settings (timezone, invoicing mode, practice details for report
// templates, the Maps key for address search). Bank details, mail/Graph setup, where emails are
// routed and the role permissions are only for users who can open the Settings page.
const SETTINGS_ONLY = /^(bank_|graph_|smtp_)|^(accounts_email|remittance_email|role_permissions|budget_alert_to|email_reasons_to_tags|invoice_counter)$/;

router.get('/', auth, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
  delete settings.smtp_pass;
  delete settings.graph_client_secret;
  if (!perm.hasPermission(req.user, 'settings')) {
    for (const key of Object.keys(settings)) if (SETTINGS_ONLY.test(key)) delete settings[key];
  }
  res.json(settings);
});

router.patch('/', auth, perm('settings'), (req, res) => {
  const update = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const tx = db.transaction((data) => {
    for (const [key, value] of Object.entries(data)) {
      update.run(key, String(value));
    }
  });
  tx(req.body);
  res.json({ ok: true });
});

router.get('/logo', (req, res) => {
  const logoPath = path.join(uploadsDir, 'logo');
  if (!fs.existsSync(logoPath)) return res.status(404).end();
  res.sendFile(logoPath);
});

router.post('/logo', auth, perm('settings'), logoUpload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const update = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  update.run('logo_filename', req.file.filename);
  res.json({ ok: true, filename: req.file.filename });
});

router.delete('/logo', auth, perm('settings'), (_req, res) => {
  const logoPath = path.join(uploadsDir, 'logo');
  if (fs.existsSync(logoPath)) fs.unlinkSync(logoPath);
  db.prepare("DELETE FROM settings WHERE key = 'logo_filename'").run();
  res.json({ ok: true });
});

router.post('/test-email', auth, perm('settings'), async (req, res) => {
  const rows = db.prepare("SELECT key,value FROM settings WHERE key LIKE 'graph_%'").all();
  const cfg = Object.fromEntries(rows.map(r => [r.key, r.value]));
  const to = cfg.graph_mailbox;
  if (!to) return res.status(400).json({ error: 'Graph mailbox not configured' });
  try {
    await sendTestEmail(to);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
