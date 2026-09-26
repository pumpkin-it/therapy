const router = require('express').Router();
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Pictures inside written reports and report templates (see billableReports.js /:id/images and
// reportDocTemplates.js /:id/images). Stored under unguessable names and served without auth, so
// the editor's <img> tags (which can't send an auth header) and the PDF renderer can load them.
const IMAGE_DIR = path.join(__dirname, '../../uploads/report-images');
if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });
const NAME_RE = /^[a-f0-9]{48}\.(png|jpe?g|gif|webp)$/;
const IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

const upload = multer({
  storage: multer.diskStorage({
    destination: IMAGE_DIR,
    filename: (req, file, cb) => cb(null, `${crypto.randomBytes(24).toString('hex')}.${IMAGE_EXT[file.mimetype]}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, !!IMAGE_EXT[file.mimetype]),
});

// Middleware: accepts one "image" field, turning multer errors into friendly 400s.
function acceptImage(req, res, next) {
  upload.single('image')(req, res, err => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Image is too large — the maximum is 10MB.' });
    if (err) return res.status(400).json({ error: err.message || 'Failed to upload image' });
    next();
  });
}
const discardUpload = req => { if (req.file) try { fs.unlinkSync(req.file.path); } catch {} };

// The practice logo for the "Practice logo" field in reports and templates. Public, like the
// existing /uploads/logo route in index.js — it's already on every invoice and agreement.
router.get('/practice-logo', (req, res) => {
  const file = path.join(__dirname, '../../uploads/logo');
  if (!fs.existsSync(file)) return res.status(404).end();
  res.set('Cache-Control', 'no-cache'); // so a newly uploaded logo shows straight away
  res.sendFile(file);
});

// Public — no auth. The strict name pattern also rules out any path traversal.
router.get('/:name', (req, res) => {
  if (!NAME_RE.test(req.params.name)) return res.status(404).end();
  const file = path.join(IMAGE_DIR, req.params.name);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.sendFile(file);
});

module.exports = router;
module.exports.acceptImage = acceptImage;
module.exports.discardUpload = discardUpload;
