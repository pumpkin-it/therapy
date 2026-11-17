const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../database');
const { generateReportPreview, generateImagePreview } = require('./reportRedact');

const UPLOAD_DIR = path.join(__dirname, '../../uploads');
const SHAREABLE_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const PREVIEW_EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

class ShareError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Turns an existing client_files row into a shareable draft: generates the "DRAFT ONLY" preview and
// a public view_token (server/routes/reportView.js serves the preview or, once released, the real
// original at that same link). Shared by the Files tab's "Share" button and report billing's
// upload. Throws ShareError with an HTTP status for anything the caller should show the user.
async function createReportShare(file) {
  if (!SHAREABLE_MIME_TYPES.includes(file.mime_type)) {
    throw new ShareError(400, 'Only PDF and image (JPG/PNG) files can be shared.');
  }
  const existing = db.prepare('SELECT 1 FROM client_file_reports WHERE client_file_id = ?').get(file.id);
  if (existing) throw new ShareError(409, 'This file is already shared.');

  // Images have no "pages" — visible_pages is meaningless there and always stored as 0.
  const isPdf = file.mime_type === 'application/pdf';
  let previewBuffer, visiblePages = 0, pageCount = null;
  try {
    const original = fs.readFileSync(path.join(UPLOAD_DIR, file.filename));
    if (isPdf) {
      ({ buffer: previewBuffer, visiblePages, pageCount } = await generateReportPreview(original));
    } else {
      previewBuffer = await generateImagePreview(original, file.mime_type);
    }
  } catch (e) {
    console.error('Report preview generation failed:', e);
    throw new ShareError(400, `Could not process this file — it may be corrupt${isPdf ? ' or password-protected' : ''}.`);
  }

  const previewFilename = `${Date.now()}-${Math.round(Math.random() * 1e9)}-preview.${PREVIEW_EXT[file.mime_type]}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, previewFilename), previewBuffer);
  const viewToken = crypto.randomBytes(24).toString('hex');
  try {
    db.prepare(`
      INSERT INTO client_file_reports (client_file_id, view_token, preview_filename, visible_pages, page_count, preview_style)
      VALUES (?, ?, ?, ?, ?, 'watermark')
    `).run(file.id, viewToken, previewFilename, visiblePages, pageCount);
  } catch (e) {
    // Preview generation isn't instant — a double-click can fire this twice before the first
    // INSERT lands, both passing the "not already shared" check above. The client_file_id
    // primary key turns the second one into a clean conflict instead of a crash.
    try { fs.unlinkSync(path.join(UPLOAD_DIR, previewFilename)); } catch {}
    throw new ShareError(409, 'This file is already shared.');
  }
}

// Previews made before 2026-11-17 blurred most pages (preview_style NULL). Remakes each one as the
// "DRAFT ONLY" watermark, one at a time in the background, writing over the same preview file so
// links already sent keep working. Drafts still waiting for payment go first; released ones are
// done too in case one is set back to a draft. A file that can't be read is marked 'error'.
async function upgradeOldPreviews() {
  const rows = db.prepare(`
    SELECT r.client_file_id, r.preview_filename, f.filename, f.mime_type
    FROM client_file_reports r JOIN client_files f ON f.id = r.client_file_id
    WHERE r.preview_style IS NULL
    ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.client_file_id
  `).all();
  if (!rows.length) return;
  let done = 0;
  for (const row of rows) {
    try {
      const original = fs.readFileSync(path.join(UPLOAD_DIR, row.filename));
      let buffer, pageCount = null, visiblePages = 0;
      if (row.mime_type === 'application/pdf') ({ buffer, pageCount, visiblePages } = await generateReportPreview(original));
      else buffer = await generateImagePreview(original, row.mime_type);
      const dest = path.join(UPLOAD_DIR, row.preview_filename);
      fs.writeFileSync(dest + '.tmp', buffer);
      fs.renameSync(dest + '.tmp', dest);
      db.prepare("UPDATE client_file_reports SET preview_style = 'watermark', page_count = COALESCE(?, page_count), visible_pages = ? WHERE client_file_id = ?")
        .run(pageCount, visiblePages, row.client_file_id);
      done++;
    } catch (e) {
      console.error(`Report preview upgrade failed for file ${row.client_file_id}:`, e.message);
      db.prepare("UPDATE client_file_reports SET preview_style = 'error' WHERE client_file_id = ?").run(row.client_file_id);
    }
  }
  console.log(`Report previews: ${done} of ${rows.length} remade with the DRAFT ONLY watermark`);
}

module.exports = { createReportShare, upgradeOldPreviews, ShareError, SHAREABLE_MIME_TYPES, UPLOAD_DIR };
