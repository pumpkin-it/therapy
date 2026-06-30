const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');

function requireAdminOrOwner(req, res, next) {
  if (!['owner', 'admin'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Only admin or owner can manage report templates' });
  }
  next();
}

router.get('/', auth, (req, res) => {
  const templates = db.prepare(`
    SELECT rt.*, p.first_name || ' ' || p.last_name AS created_by_name
    FROM report_templates rt
    LEFT JOIN practitioners p ON p.id = rt.created_by
    WHERE rt.active = 1
    ORDER BY rt.name
  `).all();
  res.json(templates.map(t => ({ ...t, sections: JSON.parse(t.sections || '[]') })));
});

router.post('/', auth, requireAdminOrOwner, (req, res) => {
  const { name, description, sections } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const result = db.prepare(`
    INSERT INTO report_templates (name, description, sections, created_by)
    VALUES (?, ?, ?, ?)
  `).run(name, description || null, JSON.stringify(sections || []), req.user.id);
  const row = db.prepare('SELECT * FROM report_templates WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ...row, sections: JSON.parse(row.sections) });
});

router.put('/:id', auth, requireAdminOrOwner, (req, res) => {
  const { name, description, sections } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  db.prepare(`
    UPDATE report_templates SET name = ?, description = ?, sections = ? WHERE id = ?
  `).run(name, description || null, JSON.stringify(sections || []), req.params.id);
  const row = db.prepare('SELECT * FROM report_templates WHERE id = ?').get(req.params.id);
  res.json({ ...row, sections: JSON.parse(row.sections) });
});

router.delete('/:id', auth, requireAdminOrOwner, (req, res) => {
  db.prepare('UPDATE report_templates SET active = 0 WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

module.exports = router;
