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

// Turns an existing client_files row into a shareable draft: generates the redacted preview and
// a public view_token (server/routes/reportView.js serves the preview or, once released, the real
// original at that same link). Shared by the Files tab's "Share" button and report billing's
// upload. Throws ShareError with an HTTP status for anything the caller should show the user.
async function createReportShare(file, requestedVisiblePages) {
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
      ({ buffer: previewBuffer, visiblePages, pageCount } = await generateReportPreview(original, requestedVisiblePages));
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
      INSERT INTO client_file_reports (client_file_id, view_token, preview_filename, visible_pages, page_count)
      VALUES (?, ?, ?, ?, ?)
    `).run(file.id, viewToken, previewFilename, visiblePages, pageCount);
  } catch (e) {
    // Preview generation isn't instant — a double-click can fire this twice before the first
    // INSERT lands, both passing the "not already shared" check above. The client_file_id
    // primary key turns the second one into a clean conflict instead of a crash.
    try { fs.unlinkSync(path.join(UPLOAD_DIR, previewFilename)); } catch {}
    throw new ShareError(409, 'This file is already shared.');
  }
}

module.exports = { createReportShare, ShareError, SHAREABLE_MIME_TYPES, UPLOAD_DIR };
