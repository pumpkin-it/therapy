const router = require('express').Router();
const db = require('../database');
const path = require('path');

const UPLOAD_DIR = path.join(__dirname, '../../uploads');

function getByToken(token) {
  return db.prepare(`
    SELECT cf.*, cfr.status, cfr.preview_filename,
      c.first_name || ' ' || c.last_name AS client_name
    FROM client_file_reports cfr
    JOIN client_files cf ON cf.id = cfr.client_file_id
    JOIN clients c ON c.id = cf.client_id
    WHERE cfr.view_token = ?
  `).get(token);
}

// Public — no auth, scoped entirely by the unguessable view_token, same trust model as
// agreements.signing_token / the calendar feed's /api/cal/:token.ics.
router.get('/:token', (req, res) => {
  const report = getByToken(req.params.token);
  if (!report) return res.status(404).json({ error: 'Not found' });
  res.json({
    title: report.label || report.original_name, client_name: report.client_name,
    status: report.status, mime_type: report.mime_type,
  });
});

router.get('/:token/file', (req, res) => {
  const report = getByToken(req.params.token);
  if (!report) return res.status(404).json({ error: 'Not found' });
  const filename = report.status === 'released' ? report.filename : report.preview_filename;
  // preview_filename is always re-encoded in the same format as the original (see
  // reportRedact.js), so the original's stored mime_type is correct for both.
  res.set('Content-Type', report.mime_type || 'application/octet-stream');
  res.set('Content-Disposition', 'inline');
  res.sendFile(path.join(UPLOAD_DIR, filename));
});

module.exports = router;
