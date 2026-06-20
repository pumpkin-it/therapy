const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');

router.get('/', auth, (req, res) => {
  const { entity_type, entity_id, limit = 100, offset = 0 } = req.query;
  let where = '1=1';
  const params = [];
  if (entity_type) { where += ' AND entity_type=?'; params.push(entity_type); }
  if (entity_id)   { where += ' AND entity_id=?';   params.push(entity_id); }
  params.push(Number(limit), Number(offset));
  const rows = db.prepare(`SELECT * FROM audit_logs WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params);
  res.json(rows);
});

module.exports = router;
