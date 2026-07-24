const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');
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
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  res.json(db.prepare('SELECT * FROM client_files WHERE client_id = ? ORDER BY created_at DESC').all(client_id));
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
  const { client_id } = req.body;
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const result = db.prepare(`
    INSERT INTO client_files (client_id, filename, original_name, size, mime_type)
    VALUES (?, ?, ?, ?, ?)
  `).run(client_id, req.file.filename, req.file.originalname, req.file.size, req.file.mimetype);
  res.status(201).json(db.prepare('SELECT * FROM client_files WHERE id = ?').get(result.lastInsertRowid));
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
  res.status(204).send();
});

module.exports = router;
