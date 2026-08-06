const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');
const audit = require('../services/audit');

router.get('/', auth, (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  const folders = db.prepare('SELECT * FROM client_file_folders WHERE client_id = ? ORDER BY name').all(client_id);
  const withCounts = folders.map(f => ({
    ...f,
    file_count: db.prepare('SELECT COUNT(*) c FROM client_files WHERE folder_id = ?').get(f.id).c,
  }));
  res.json(withCounts);
});

router.post('/', auth, (req, res) => {
  const { client_id, name } = req.body;
  if (!client_id || !name?.trim()) return res.status(400).json({ error: 'client_id and name required' });
  const result = db.prepare('INSERT INTO client_file_folders (client_id, name) VALUES (?, ?)').run(client_id, name.trim());
  audit.log('client_file_folder', result.lastInsertRowid, 'created', `Created folder "${name.trim()}"`);
  res.status(201).json({ ...db.prepare('SELECT * FROM client_file_folders WHERE id = ?').get(result.lastInsertRowid), file_count: 0 });
});

router.delete('/:id', auth, (req, res) => {
  const folder = db.prepare('SELECT * FROM client_file_folders WHERE id = ?').get(req.params.id);
  if (!folder) return res.status(404).json({ error: 'Not found' });
  const files = db.prepare('SELECT original_name, label FROM client_files WHERE folder_id = ?').all(req.params.id);
  if (files.length) {
    return res.status(409).json({
      error: 'This folder is not empty and cannot be deleted.',
      usage: { files: files.map(f => f.label || f.original_name) },
    });
  }
  db.prepare('DELETE FROM client_file_folders WHERE id = ?').run(req.params.id);
  audit.log('client_file_folder', folder.id, 'deleted', `Deleted folder "${folder.name}"`);
  res.status(204).send();
});

module.exports = router;
