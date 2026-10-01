const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');

// One record's history (a client's or appointment's History) is open to anyone signed in — the
// screens it's shown on are already permission-gated. The practice-wide Audit Log page (no
// entity_id) is owner/admin/finance only: it covers every client, user and setting change.
const FULL_LOG_ROLES = ['owner', 'admin', 'finance'];

router.get('/', auth, (req, res) => {
  const { entity_type, entity_id, limit = 100, offset = 0 } = req.query;
  if (!entity_id && !FULL_LOG_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: 'Only owners, admins and finance can view the audit log' });
  }
  let where = '1=1';
  const params = [];
  if (entity_type) { where += ' AND entity_type=?'; params.push(entity_type); }
  if (entity_id)   { where += ' AND entity_id=?';   params.push(entity_id); }
  params.push(Number(limit), Number(offset));
  const rows = db.prepare(`SELECT * FROM audit_logs WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params);
  res.json(rows);
});

module.exports = router;
