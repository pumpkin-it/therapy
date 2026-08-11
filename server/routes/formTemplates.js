const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');

function requireAdminOrOwner(req, res, next) {
  if (!['owner', 'admin'].includes(req.user?.role))
    return res.status(403).json({ error: 'Only admin or owner can manage forms' });
  next();
}

function serialize(row) {
  if (!row) return row;
  let schema;
  try { schema = JSON.parse(row.schema_json); } catch { schema = { sections: [] }; }
  const { schema_json, ...rest } = row;
  return { ...rest, schema };
}

router.get('/', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM form_templates WHERE active = 1 ORDER BY name').all();
  res.json(rows.map(serialize));
});

router.get('/:id', auth, (req, res) => {
  const row = db.prepare('SELECT * FROM form_templates WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(serialize(row));
});

router.post('/', auth, requireAdminOrOwner, (req, res) => {
  const { name, description, schema } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const result = db.prepare(
    `INSERT INTO form_templates (name, description, schema_json, created_by) VALUES (?, ?, ?, ?)`
  ).run(name.trim(), description || null, JSON.stringify(schema || { sections: [] }), req.user.id);
  res.status(201).json(serialize(db.prepare('SELECT * FROM form_templates WHERE id = ?').get(result.lastInsertRowid)));
});

router.put('/:id', auth, requireAdminOrOwner, (req, res) => {
  const tpl = db.prepare('SELECT * FROM form_templates WHERE id = ?').get(req.params.id);
  if (!tpl) return res.status(404).json({ error: 'Not found' });
  const { name, description, schema } = req.body;
  if (name !== undefined && !name.trim()) return res.status(400).json({ error: 'name required' });
  db.prepare(`UPDATE form_templates SET name = ?, description = ?, schema_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
    name !== undefined ? name.trim() : tpl.name,
    description !== undefined ? description : tpl.description,
    schema !== undefined ? JSON.stringify(schema) : tpl.schema_json,
    req.params.id
  );
  res.json(serialize(db.prepare('SELECT * FROM form_templates WHERE id = ?').get(req.params.id)));
});

router.delete('/:id', auth, requireAdminOrOwner, (req, res) => {
  const tpl = db.prepare('SELECT * FROM form_templates WHERE id = ?').get(req.params.id);
  if (!tpl) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE form_templates SET active = 0 WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

module.exports = router;
