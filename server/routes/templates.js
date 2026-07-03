const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');

function requireAdminOrOwner(req, res, next) {
  if (!['owner', 'admin'].includes(req.user?.role))
    return res.status(403).json({ error: 'Only admin or owner can manage templates' });
  next();
}

router.get('/', auth, (req, res) => {
  const { type } = req.query;
  let query = 'SELECT * FROM templates WHERE active = 1';
  const params = [];
  if (type) { query += ' AND type = ?'; params.push(type); }
  query += ' ORDER BY type, name';
  res.json(db.prepare(query).all(...params));
});

router.post('/', auth, requireAdminOrOwner, (req, res) => {
  const { name, body, type, has_pricing_table } = req.body;
  if (!name || !body) return res.status(400).json({ error: 'name and body required' });
  const result = db.prepare(
    `INSERT INTO templates (type, name, body, is_system, has_pricing_table) VALUES (?, ?, ?, 0, ?)`
  ).run(type || 'session_note', name, body, has_pricing_table ? 1 : 0);
  res.status(201).json(db.prepare('SELECT * FROM templates WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/:id', auth, requireAdminOrOwner, (req, res) => {
  const tpl = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
  if (!tpl) return res.status(404).json({ error: 'Not found' });
  const { name, subject, body, has_pricing_table } = req.body;
  db.prepare(`UPDATE templates SET name = ?, subject = ?, body = ?, has_pricing_table = ? WHERE id = ?`)
    .run(name ?? tpl.name, subject ?? tpl.subject, body ?? tpl.body, has_pricing_table !== undefined ? (has_pricing_table ? 1 : 0) : tpl.has_pricing_table, req.params.id);
  res.json(db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id));
});

router.delete('/:id', auth, requireAdminOrOwner, (req, res) => {
  const tpl = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
  if (!tpl) return res.status(404).json({ error: 'Not found' });
  if (tpl.is_system) return res.status(400).json({ error: 'System templates cannot be deleted' });
  db.prepare('UPDATE templates SET active = 0 WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

module.exports = router;
