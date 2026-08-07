const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');
const audit = require('../services/audit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

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

router.get('/', auth, (req, res) => {
  const { session_note_id } = req.query;
  if (!session_note_id) return res.status(400).json({ error: 'session_note_id required' });
  res.json(db.prepare('SELECT * FROM session_note_files WHERE session_note_id = ? ORDER BY created_at DESC').all(session_note_id));
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
  const { session_note_id, label } = req.body;
  if (!req.file) return res.status(400).json({ error: 'No file' });
  if (!session_note_id) return res.status(400).json({ error: 'session_note_id required' });
  const result = db.prepare(`
    INSERT INTO session_note_files (session_note_id, filename, original_name, size, mime_type, label)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(session_note_id, req.file.filename, req.file.originalname, req.file.size, req.file.mimetype, label || null);
  audit.log('session_note_file', result.lastInsertRowid, 'uploaded',
    `Uploaded "${req.file.originalname}"${label ? ` (labelled "${label}")` : ''}`);
  res.status(201).json(db.prepare('SELECT * FROM session_note_files WHERE id = ?').get(result.lastInsertRowid));
});

router.patch('/:id', auth, (req, res) => {
  const file = db.prepare('SELECT * FROM session_note_files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'Not found' });
  const label = req.body.label !== undefined ? (req.body.label || null) : file.label;
  db.prepare('UPDATE session_note_files SET label = ? WHERE id = ?').run(label, req.params.id);
  const updated = db.prepare('SELECT * FROM session_note_files WHERE id = ?').get(req.params.id);
  const changes = audit.diff(file, updated, ['label']);
  if (changes) audit.log('session_note_file', file.id, 'updated', changes);
  res.json(updated);
});

router.get('/:id/download', auth, (req, res) => {
  const file = db.prepare('SELECT * FROM session_note_files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'Not found' });
  res.download(path.join(UPLOAD_DIR, file.filename), file.original_name);
});

router.delete('/:id', auth, (req, res) => {
  const file = db.prepare('SELECT * FROM session_note_files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'Not found' });
  try { fs.unlinkSync(path.join(UPLOAD_DIR, file.filename)); } catch {}
  db.prepare('DELETE FROM session_note_files WHERE id = ?').run(req.params.id);
  audit.log('session_note_file', file.id, 'deleted', `Deleted "${file.label || file.original_name}"`);
  res.status(204).send();
});

module.exports = router;
