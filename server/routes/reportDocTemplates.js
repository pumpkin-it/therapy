const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');
const audit = require('../services/audit');
const { acceptImage, discardUpload } = require('./reportImages');

// Report templates for writing reports in the system. Anyone who can see clients can list and
// open them (to start a report from one); only owner/admin can create, change or delete them.
const isAdmin = user => ['owner', 'admin'].includes(user.role);
const validDoc = c => c && c.type === 'doc' && Array.isArray(c.content);

const withNames = `
  SELECT t.id, t.name, t.description, t.active, t.created_at, t.updated_at,
    p.first_name || ' ' || p.last_name AS updated_by_name
  FROM report_doc_templates t LEFT JOIN practitioners p ON p.id = t.updated_by
`;

router.get('/', auth, (req, res) => {
  const rows = req.query.all === '1' && isAdmin(req.user)
    ? db.prepare(`${withNames} ORDER BY t.active DESC, t.name`).all()
    : db.prepare(`${withNames} WHERE t.active = 1 ORDER BY t.name`).all();
  res.json(rows);
});

router.get('/:id', auth, (req, res) => {
  const t = db.prepare('SELECT * FROM report_doc_templates WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  res.json({ ...t, content: JSON.parse(t.content), can_edit: isAdmin(req.user) });
});

router.post('/', auth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Only an owner or admin can create report templates' });
  const name = req.body.name?.trim();
  if (!name) return res.status(400).json({ error: 'Enter a template name' });
  // Start from a copy of another template, or empty.
  let content = { type: 'doc', content: [{ type: 'paragraph' }] };
  if (req.body.copy_from) {
    const src = db.prepare('SELECT content FROM report_doc_templates WHERE id = ?').get(req.body.copy_from);
    if (src) content = JSON.parse(src.content);
  }
  const r = db.prepare('INSERT INTO report_doc_templates (name, description, content, created_by, updated_by) VALUES (?, ?, ?, ?, ?)')
    .run(name, req.body.description?.trim() || null, JSON.stringify(content), req.user.id, req.user.id);
  audit.log('report_template', r.lastInsertRowid, 'created', `Created report template "${name}"`);
  res.status(201).json(db.prepare(`${withNames} WHERE t.id = ?`).get(r.lastInsertRowid));
});

router.put('/:id', auth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Only an owner or admin can change report templates' });
  const t = db.prepare('SELECT * FROM report_doc_templates WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const name = req.body.name !== undefined ? req.body.name.trim() : t.name;
  if (!name) return res.status(400).json({ error: 'Enter a template name' });
  if (req.body.content !== undefined && !validDoc(req.body.content)) return res.status(400).json({ error: 'Invalid document' });
  const content = req.body.content !== undefined ? JSON.stringify(req.body.content) : t.content;
  const description = req.body.description !== undefined ? (req.body.description?.trim() || null) : t.description;
  const active = req.body.active !== undefined ? (req.body.active ? 1 : 0) : t.active;
  db.prepare(`UPDATE report_doc_templates SET name = ?, description = ?, content = ?, active = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(name, description, content, active, req.user.id, t.id);
  const what = [name !== t.name && `renamed to "${name}"`, content !== t.content && 'content changed', active !== t.active && (active ? 'turned on' : 'turned off')].filter(Boolean).join(', ');
  if (what) audit.log('report_template', t.id, 'updated', `Report template "${t.name}": ${what}`);
  res.json(db.prepare(`${withNames} WHERE t.id = ?`).get(t.id));
});

// Reports already started keep their own copy, so deleting a template never changes them.
router.delete('/:id', auth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Only an owner or admin can delete report templates' });
  const t = db.prepare('SELECT * FROM report_doc_templates WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE billable_reports SET template_id = NULL WHERE template_id = ?').run(t.id);
  db.prepare('DELETE FROM report_doc_templates WHERE id = ?').run(t.id);
  audit.log('report_template', t.id, 'deleted', `Deleted report template "${t.name}"`);
  res.status(204).send();
});

router.post('/:id/images', auth, acceptImage, (req, res) => {
  if (!isAdmin(req.user)) { discardUpload(req); return res.status(403).json({ error: 'Only an owner or admin can change report templates' }); }
  if (!db.prepare('SELECT 1 FROM report_doc_templates WHERE id = ?').get(req.params.id)) { discardUpload(req); return res.status(404).json({ error: 'Not found' }); }
  if (!req.file) return res.status(400).json({ error: 'Upload a PNG, JPG, GIF or WebP image.' });
  res.status(201).json({ url: `/api/report-images/${req.file.filename}` });
});

module.exports = router;
