const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');

function serialize(row) {
  if (!row) return row;
  let answers;
  try { answers = JSON.parse(row.answers_json); } catch { answers = {}; }
  const { answers_json, ...rest } = row;
  return { ...rest, answers };
}

router.get('/', auth, (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  const rows = db.prepare(`
    SELECT r.*, t.name AS template_name
    FROM form_responses r JOIN form_templates t ON t.id = r.form_template_id
    WHERE r.client_id = ?
    ORDER BY r.created_at DESC
  `).all(client_id);
  res.json(rows.map(serialize));
});

router.get('/:id', auth, (req, res) => {
  const row = db.prepare(`
    SELECT r.*, t.name AS template_name, t.schema_json AS template_schema_json
    FROM form_responses r JOIN form_templates t ON t.id = r.form_template_id
    WHERE r.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const serialized = serialize(row);
  let schema;
  try { schema = JSON.parse(row.template_schema_json); } catch { schema = { sections: [] }; }
  delete serialized.template_schema_json;
  serialized.template_schema = schema;
  res.json(serialized);
});

router.post('/', auth, (req, res) => {
  const { form_template_id, client_id, answers } = req.body;
  if (!form_template_id || !client_id) return res.status(400).json({ error: 'form_template_id and client_id required' });
  const template = db.prepare('SELECT id FROM form_templates WHERE id = ?').get(form_template_id);
  if (!template) return res.status(404).json({ error: 'Form template not found' });
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO form_responses (form_template_id, client_id, status, answers_json, created_by, submitted_at)
    VALUES (?, ?, 'submitted', ?, ?, ?)
  `).run(form_template_id, client_id, JSON.stringify(answers || {}), req.user.id, now);
  res.status(201).json(serialize(db.prepare('SELECT * FROM form_responses WHERE id = ?').get(result.lastInsertRowid)));
});

router.put('/:id', auth, (req, res) => {
  const row = db.prepare('SELECT * FROM form_responses WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const { answers } = req.body;
  db.prepare(`UPDATE form_responses SET answers_json = ?, submitted_at = ? WHERE id = ?`).run(
    JSON.stringify(answers ?? JSON.parse(row.answers_json)),
    new Date().toISOString(),
    req.params.id
  );
  res.json(serialize(db.prepare('SELECT * FROM form_responses WHERE id = ?').get(req.params.id)));
});

module.exports = router;
