const router = require('express').Router();
const crypto = require('crypto');
const db = require('../database');
const auth = require('../middleware/auth');
const audit = require('../services/audit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { generateReportPreview } = require('../services/reportRedact');

const UPLOAD_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

const FILE_WITH_REPORT_SELECT = `
  SELECT cf.*, cfr.status AS report_status, cfr.view_token AS report_view_token,
    cfr.visible_pages AS report_visible_pages, cfr.released_at AS report_released_at
  FROM client_files cf
  LEFT JOIN client_file_reports cfr ON cfr.client_file_id = cf.id
`;

router.get('/', auth, (req, res) => {
  const { client_id, folder_id, shared } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });

  // Cross-folder "Shared" view — every file shared as a report for this client, regardless of
  // which folder it lives in, since a shared file is otherwise easy to lose track of once
  // there's more than a couple of folders.
  if (shared === '1') {
    const files = db.prepare(`
      SELECT cf.*, cff.name AS folder_name, cfr.status AS report_status, cfr.view_token AS report_view_token,
        cfr.visible_pages AS report_visible_pages, cfr.released_at AS report_released_at
      FROM client_files cf
      JOIN client_file_reports cfr ON cfr.client_file_id = cf.id
      LEFT JOIN client_file_folders cff ON cff.id = cf.folder_id
      WHERE cf.client_id = ?
      ORDER BY cfr.created_at DESC
    `).all(client_id);
    return res.json(files);
  }

  const files = folder_id && folder_id !== 'root'
    ? db.prepare(`${FILE_WITH_REPORT_SELECT} WHERE cf.client_id = ? AND cf.folder_id = ? ORDER BY cf.created_at DESC`).all(client_id, folder_id)
    : db.prepare(`${FILE_WITH_REPORT_SELECT} WHERE cf.client_id = ? AND cf.folder_id IS NULL ORDER BY cf.created_at DESC`).all(client_id);
  res.json(files);
});

router.post('/', auth, (req, res, next) => {
  upload.single('file')(req, res, err => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File is too large — the maximum upload size is 20MB.' });
    }
    if (err) return res.status(400).json({ error: err.message || 'Failed to upload file' });
    next();
  });
}, (req, res) => {
  const { client_id, folder_id, label } = req.body;
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const result = db.prepare(`
    INSERT INTO client_files (client_id, filename, original_name, size, mime_type, folder_id, label)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(client_id, req.file.filename, req.file.originalname, req.file.size, req.file.mimetype, folder_id || null, label || null);
  audit.log('client_file', result.lastInsertRowid, 'uploaded',
    `Uploaded "${req.file.originalname}"${label ? ` (labelled "${label}")` : ''}`);
  res.status(201).json(db.prepare('SELECT * FROM client_files WHERE id = ?').get(result.lastInsertRowid));
});

router.patch('/:id', auth, (req, res) => {
  const file = db.prepare('SELECT * FROM client_files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'Not found' });
  const label = req.body.label !== undefined ? (req.body.label || null) : file.label;
  const folder_id = req.body.folder_id !== undefined ? (req.body.folder_id || null) : file.folder_id;
  db.prepare('UPDATE client_files SET label = ?, folder_id = ? WHERE id = ?').run(label, folder_id, req.params.id);
  const updated = db.prepare('SELECT * FROM client_files WHERE id = ?').get(req.params.id);
  const changes = audit.diff(file, updated, ['label', 'folder_id']);
  if (changes) audit.log('client_file', file.id, 'updated', changes);
  res.json(updated);
});

router.get('/:id/download', auth, (req, res) => {
  const file = db.prepare('SELECT * FROM client_files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'Not found' });
  res.download(path.join(UPLOAD_DIR, file.filename), file.original_name);
});

// Turns an existing PDF already in Files into a shareable draft report — no separate upload,
// the original stays exactly where the practitioner put it. Generates the redacted preview and
// a public view_token (server/routes/reportView.js serves the preview or, once released, the
// real client_files original at that same link).
router.post('/:id/share-report', auth, async (req, res) => {
  const file = db.prepare('SELECT * FROM client_files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'Not found' });
  if (file.mime_type !== 'application/pdf') return res.status(400).json({ error: 'Only PDF files can be shared as a report.' });
  const existing = db.prepare('SELECT 1 FROM client_file_reports WHERE client_file_id = ?').get(file.id);
  if (existing) return res.status(409).json({ error: 'This file is already shared as a report.' });

  const visiblePages = Math.max(0, Math.min(10, parseInt(req.body.visible_pages, 10) || 0));
  let previewBuffer;
  try {
    const original = fs.readFileSync(path.join(UPLOAD_DIR, file.filename));
    previewBuffer = await generateReportPreview(original, visiblePages);
  } catch (e) {
    console.error('Report preview generation failed:', e);
    return res.status(400).json({ error: 'Could not process this PDF — it may be corrupt or password-protected.' });
  }

  const previewFilename = `${Date.now()}-${Math.round(Math.random() * 1e9)}-preview.pdf`;
  fs.writeFileSync(path.join(UPLOAD_DIR, previewFilename), previewBuffer);
  const viewToken = crypto.randomBytes(24).toString('hex');
  db.prepare(`
    INSERT INTO client_file_reports (client_file_id, view_token, preview_filename, visible_pages)
    VALUES (?, ?, ?, ?)
  `).run(file.id, viewToken, previewFilename, visiblePages);

  audit.log('client_file', file.id, 'updated', `Shared "${file.label || file.original_name}" as a draft report`);
  res.status(201).json(db.prepare(`${FILE_WITH_REPORT_SELECT} WHERE cf.id = ?`).get(file.id));
});

// Removes report sharing entirely (the file itself, and its download, are untouched) — distinct
// from setting status back to 'pending', which keeps it shared but reverts the client's link to
// the blurred preview.
router.delete('/:id/share-report', auth, (req, res) => {
  const report = db.prepare('SELECT * FROM client_file_reports WHERE client_file_id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Not found' });
  try { fs.unlinkSync(path.join(UPLOAD_DIR, report.preview_filename)); } catch {}
  db.prepare('DELETE FROM client_file_reports WHERE client_file_id = ?').run(req.params.id);
  const file = db.prepare('SELECT * FROM client_files WHERE id = ?').get(req.params.id);
  audit.log('client_file', Number(req.params.id), 'updated', `Stopped sharing "${file?.label || file?.original_name}" as a report`);
  res.json(db.prepare(`${FILE_WITH_REPORT_SELECT} WHERE cf.id = ?`).get(req.params.id));
});

router.patch('/:id/report-status', auth, (req, res) => {
  const report = db.prepare('SELECT * FROM client_file_reports WHERE client_file_id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Not found' });
  const { status } = req.body;
  if (!['pending', 'released'].includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const releasedAt = status === 'released' ? new Date().toISOString() : null;
  db.prepare('UPDATE client_file_reports SET status = ?, released_at = ? WHERE client_file_id = ?').run(status, releasedAt, req.params.id);
  const file = db.prepare('SELECT * FROM client_files WHERE id = ?').get(req.params.id);
  audit.log('client_file', file.id, status === 'released' ? 'released' : 'unreleased',
    status === 'released' ? `Released "${file.label || file.original_name}" to client` : `Reverted "${file.label || file.original_name}" to draft`);
  res.json(db.prepare(`${FILE_WITH_REPORT_SELECT} WHERE cf.id = ?`).get(req.params.id));
});

router.patch('/:id/report-visible-pages', auth, async (req, res) => {
  const file = db.prepare('SELECT * FROM client_files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'Not found' });
  const report = db.prepare('SELECT * FROM client_file_reports WHERE client_file_id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Not found' });
  const visiblePages = Math.max(0, Math.min(10, parseInt(req.body.visible_pages, 10) || 0));

  let previewBuffer;
  try {
    const original = fs.readFileSync(path.join(UPLOAD_DIR, file.filename));
    previewBuffer = await generateReportPreview(original, visiblePages);
  } catch (e) {
    console.error('Report preview regeneration failed:', e);
    return res.status(400).json({ error: 'Could not regenerate the preview for this report.' });
  }
  fs.writeFileSync(path.join(UPLOAD_DIR, report.preview_filename), previewBuffer);

  db.prepare('UPDATE client_file_reports SET visible_pages = ? WHERE client_file_id = ?').run(visiblePages, req.params.id);
  audit.log('client_file', file.id, 'updated', `Changed visible pages to ${visiblePages} for "${file.label || file.original_name}"`);
  res.json(db.prepare(`${FILE_WITH_REPORT_SELECT} WHERE cf.id = ?`).get(req.params.id));
});

router.delete('/:id', auth, (req, res) => {
  const file = db.prepare('SELECT * FROM client_files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'Not found' });
  const report = db.prepare('SELECT * FROM client_file_reports WHERE client_file_id = ?').get(req.params.id);
  if (report) { try { fs.unlinkSync(path.join(UPLOAD_DIR, report.preview_filename)); } catch {} }
  try { fs.unlinkSync(path.join(UPLOAD_DIR, file.filename)); } catch {}
  db.prepare('DELETE FROM client_files WHERE id = ?').run(req.params.id);
  audit.log('client_file', file.id, 'deleted', `Deleted "${file.label || file.original_name}"`);
  res.status(204).send();
});

module.exports = router;
