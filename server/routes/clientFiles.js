const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');
const audit = require('../services/audit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { generateReportPreview } = require('../services/reportRedact');
const { createReportShare, ShareError } = require('../services/reportShare');
const { releasePaidReportsInBackground } = require('../services/reportRelease');

// A file that's the uploaded copy of a billed report (routes/billableReports.js) is held back until
// its invoices are paid — so it can't be released, un-shared or deleted from the Files tab the
// way an ordinary shared file can, or the payment gate would be trivially bypassed.
const getLinkedBillableReport = fileId => db.prepare('SELECT * FROM billable_reports WHERE client_file_id = ?').get(fileId);
const LINKED_REPORT_MSG = 'This file is a billed report — manage it from the client’s Reports tab.';
const { graphSend, getTemplate, renderTemplate, plainTextToHtml } = require('../services/mailer');

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
    cfr.visible_pages AS report_visible_pages, cfr.page_count AS report_page_count, cfr.released_at AS report_released_at,
    (SELECT br.id FROM billable_reports br WHERE br.client_file_id = cf.id) AS billable_report_id
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
        cfr.visible_pages AS report_visible_pages, cfr.page_count AS report_page_count, cfr.released_at AS report_released_at,
        (SELECT br.id FROM billable_reports br WHERE br.client_file_id = cf.id) AS billable_report_id
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

// Turns an existing file already in Files into a shareable draft — no separate upload, the
// original stays exactly where the practitioner put it. Generates the redacted preview and a
// public view_token (server/routes/reportView.js serves the preview or, once released, the
// real client_files original at that same link). PDF and JPG/PNG only — Word/Excel have no
// rasterization path here (would need converting to PDF first, e.g. headless LibreOffice) and
// aren't worth the new dependency until there's an actual need for it.
router.post('/:id/share-report', auth, async (req, res) => {
  const file = db.prepare('SELECT * FROM client_files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'Not found' });
  try {
    await createReportShare(file, req.body.visible_pages);
  } catch (e) {
    if (e instanceof ShareError) return res.status(e.status).json({ error: e.message });
    throw e;
  }

  audit.log('client_file', file.id, 'updated', `Shared "${file.label || file.original_name}" as a draft report`);
  res.status(201).json(db.prepare(`${FILE_WITH_REPORT_SELECT} WHERE cf.id = ?`).get(file.id));
});

// Removes report sharing entirely (the file itself, and its download, are untouched) — distinct
// from setting status back to 'pending', which keeps it shared but reverts the client's link to
// the blurred preview.
router.delete('/:id/share-report', auth, (req, res) => {
  const report = db.prepare('SELECT * FROM client_file_reports WHERE client_file_id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Not found' });
  if (getLinkedBillableReport(req.params.id)) return res.status(409).json({ error: LINKED_REPORT_MSG });
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
  const billable = getLinkedBillableReport(req.params.id);
  if (billable && !['owner', 'admin'].includes(req.user.role)) return res.status(403).json({ error: LINKED_REPORT_MSG });

  const releasedAt = status === 'released' ? new Date().toISOString() : null;
  db.prepare('UPDATE client_file_reports SET status = ?, released_at = ? WHERE client_file_id = ?').run(status, releasedAt, req.params.id);
  if (billable) {
    db.prepare('UPDATE billable_reports SET status = ?, released_at = ? WHERE id = ?')
      .run(status === 'released' ? 'released' : (billable.notify_to ? 'draft_sent' : 'uploaded'), releasedAt, billable.id);
  }
  const file = db.prepare('SELECT * FROM client_files WHERE id = ?').get(req.params.id);
  audit.log('client_file', file.id, status === 'released' ? 'released' : 'unreleased',
    status === 'released' ? `Released "${file.label || file.original_name}" to client` : `Reverted "${file.label || file.original_name}" to draft`);
  res.json(db.prepare(`${FILE_WITH_REPORT_SELECT} WHERE cf.id = ?`).get(req.params.id));
});

// Sends the "your report is ready" email directly, instead of the practitioner copying the
// link and pasting it into their own mail client. `to`/`cc`/`subject`/`body` come pre-rendered
// from the client's editable preview (same pattern as session-notes email) — the fallback
// template rendering below only kicks in if the client sent an empty value.
router.post('/:id/notify-report', auth, async (req, res) => {
  const file = db.prepare('SELECT * FROM client_files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'Not found' });
  const report = db.prepare('SELECT * FROM client_file_reports WHERE client_file_id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Not found' });

  const { to, cc, subject, body } = req.body;
  if (!Array.isArray(to) || !to.length) return res.status(400).json({ error: 'At least one recipient is required' });

  const client = db.prepare('SELECT first_name, last_name FROM clients WHERE id = ?').get(file.client_id);
  const practitioner = db.prepare('SELECT first_name, last_name FROM practitioners WHERE id = ?').get(req.user.id);
  const reportTitle = file.label || file.original_name;
  const reportLink = `${process.env.APP_URL || ''}/report/${report.view_token}`;
  const vars = {
    client_name: client ? `${client.first_name} ${client.last_name}` : '',
    client_first_name: client?.first_name || '',
    practitioner_name: practitioner ? `${practitioner.first_name} ${practitioner.last_name}` : '',
    report_title: reportTitle,
    report_link: reportLink,
  };

  const templateCode = report.status === 'released' ? 'report_released' : 'report_shared_draft';
  const tpl = getTemplate(templateCode);
  const finalSubject = subject || (tpl ? renderTemplate(tpl.subject, vars) : `Your ${reportTitle} is ready`);
  const finalBody = plainTextToHtml(body) || (tpl ? renderTemplate(tpl.body, vars) : `<p>You can view "${reportTitle}" using the link below.</p><p><a href="${reportLink}">${reportLink}</a></p>`);

  try {
    await graphSend({ to, cc: cc?.length ? cc : undefined, subject: finalSubject, html: finalBody });
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Failed to send email' });
  }

  audit.log('client_file', file.id, 'updated',
    `Notified client about "${reportTitle}" (${report.status === 'released' ? 'released' : 'draft'})`);

  // For a billed report, the draft email is what starts the payment wait — remember who got it so
  // the automatic release email goes to the same people, then check straight away in case every
  // invoice is already paid.
  const billable = getLinkedBillableReport(file.id);
  if (billable && report.status !== 'released' && billable.status !== 'released') {
    db.prepare("UPDATE billable_reports SET status = 'draft_sent', notify_to = ?, notify_cc = ? WHERE id = ?")
      .run(JSON.stringify(to), JSON.stringify(cc?.length ? cc : []), billable.id);
    audit.log('billable_report', billable.id, 'updated', `Draft sent to ${to.join(', ')} — waiting for payment before release`);
    releasePaidReportsInBackground([billable.id]);
  }
  res.json({ ok: true });
});

router.patch('/:id/report-visible-pages', auth, async (req, res) => {
  const file = db.prepare('SELECT * FROM client_files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'Not found' });
  const report = db.prepare('SELECT * FROM client_file_reports WHERE client_file_id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Not found' });
  if (file.mime_type !== 'application/pdf') return res.status(400).json({ error: 'Visible pages only applies to PDF reports.' });
  let previewBuffer, visiblePages, pageCount;
  try {
    const original = fs.readFileSync(path.join(UPLOAD_DIR, file.filename));
    ({ buffer: previewBuffer, visiblePages, pageCount } = await generateReportPreview(original, req.body.visible_pages));
  } catch (e) {
    console.error('Report preview regeneration failed:', e);
    return res.status(400).json({ error: 'Could not regenerate the preview for this report.' });
  }
  fs.writeFileSync(path.join(UPLOAD_DIR, report.preview_filename), previewBuffer);

  db.prepare('UPDATE client_file_reports SET visible_pages = ?, page_count = ? WHERE client_file_id = ?').run(visiblePages, pageCount, req.params.id);
  audit.log('client_file', file.id, 'updated', `Changed visible pages to ${visiblePages} for "${file.label || file.original_name}"`);
  res.json(db.prepare(`${FILE_WITH_REPORT_SELECT} WHERE cf.id = ?`).get(req.params.id));
});

router.delete('/:id', auth, (req, res) => {
  const file = db.prepare('SELECT * FROM client_files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'Not found' });
  if (getLinkedBillableReport(file.id)) return res.status(409).json({ error: LINKED_REPORT_MSG });
  const report = db.prepare('SELECT * FROM client_file_reports WHERE client_file_id = ?').get(req.params.id);
  if (report) { try { fs.unlinkSync(path.join(UPLOAD_DIR, report.preview_filename)); } catch {} }
  try { fs.unlinkSync(path.join(UPLOAD_DIR, file.filename)); } catch {}
  db.prepare('DELETE FROM client_files WHERE id = ?').run(req.params.id);
  audit.log('client_file', file.id, 'deleted', `Deleted "${file.label || file.original_name}"`);
  res.status(204).send();
});

module.exports = router;
