const router = require('express').Router();
const db = require('../database');
const path = require('path');

const UPLOAD_DIR = path.join(__dirname, '../../uploads');

function getClientByToken(token) {
  return db.prepare('SELECT id, first_name, last_name FROM clients WHERE portal_token = ?').get(token);
}

// Public — no auth, scoped entirely by the unguessable portal_token, same trust model as
// agreements.signing_token / reportView.js's per-item view_token. Durable per-client link:
// lists every client_files row that has been explicitly shared as a report for this client —
// nothing else in that client's Files ever appears here, regardless of folder.
router.get('/:token', (req, res) => {
  const client = getClientByToken(req.params.token);
  if (!client) return res.status(404).json({ error: 'Not found' });
  const items = db.prepare(`
    SELECT cf.id, cf.label, cf.original_name, cfr.status, cfr.released_at
    FROM client_files cf
    JOIN client_file_reports cfr ON cfr.client_file_id = cf.id
    WHERE cf.client_id = ?
    ORDER BY cfr.created_at DESC
  `).all(client.id);
  res.json({
    client_name: `${client.first_name} ${client.last_name}`,
    items: items.map(i => ({ id: i.id, title: i.label || i.original_name, status: i.status, released_at: i.released_at })),
  });
});

router.get('/:token/item/:fileId/file', (req, res) => {
  const client = getClientByToken(req.params.token);
  if (!client) return res.status(404).json({ error: 'Not found' });
  const report = db.prepare(`
    SELECT cf.*, cfr.status, cfr.preview_filename
    FROM client_files cf
    JOIN client_file_reports cfr ON cfr.client_file_id = cf.id
    WHERE cf.id = ? AND cf.client_id = ?
  `).get(req.params.fileId, client.id);
  if (!report) return res.status(404).json({ error: 'Not found' });
  const filename = report.status === 'released' ? report.filename : report.preview_filename;
  res.set('Content-Type', report.mime_type || 'application/octet-stream');
  res.set('Content-Disposition', 'inline');
  res.sendFile(path.join(UPLOAD_DIR, filename));
});

module.exports = router;
