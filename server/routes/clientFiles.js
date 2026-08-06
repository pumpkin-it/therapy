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
  const { client_id, folder_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  const files = folder_id && folder_id !== 'root'
    ? db.prepare('SELECT * FROM client_files WHERE client_id = ? AND folder_id = ? ORDER BY created_at DESC').all(client_id, folder_id)
    : db.prepare('SELECT * FROM client_files WHERE client_id = ? AND folder_id IS NULL ORDER BY created_at DESC').all(client_id);
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

router.delete('/:id', auth, (req, res) => {
  const file = db.prepare('SELECT * FROM client_files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'Not found' });
  try { fs.unlinkSync(path.join(UPLOAD_DIR, file.filename)); } catch {}
  db.prepare('DELETE FROM client_files WHERE id = ?').run(req.params.id);
  audit.log('client_file', file.id, 'deleted', `Deleted "${file.label || file.original_name}"`);
  res.status(204).send();
});

module.exports = router;
