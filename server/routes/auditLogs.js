const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');
const activity = require('../services/activity');

// One record's history (a client's or appointment's History) is open to anyone signed in — the
// screens it's shown on are already permission-gated. The practice-wide Audit Log page (no
// entity_id) is owner/admin/finance only: it covers every client, user and setting change.
const FULL_LOG_ROLES = ['owner', 'admin', 'finance'];

// Who was on, for a period (from/to are ISO times, chosen by the screen in local time).
const validPeriod = ({ from, to }) => !Number.isNaN(Date.parse(from)) && !Number.isNaN(Date.parse(to));
router.get('/activity', auth, (req, res) => {
  if (!FULL_LOG_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Only owners, admins and finance can view activity' });
  if (!validPeriod(req.query)) return res.status(400).json({ error: 'from and to are required' });
  res.json(activity.summary(req.query.from, req.query.to));
});
router.get('/activity/:userId', auth, (req, res) => {
  if (!FULL_LOG_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Only owners, admins and finance can view activity' });
  if (!validPeriod(req.query)) return res.status(400).json({ error: 'from and to are required' });
  res.json(activity.detail(Number(req.params.userId), req.query.from, req.query.to));
});

router.get('/', auth, (req, res) => {
  const { entity_type, entity_id, limit = 100, offset = 0 } = req.query;
  if (!entity_id && !FULL_LOG_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: 'Only owners, admins and finance can view the audit log' });
  }
  let where = '1=1';
  const params = [];
  if (entity_type) { where += ' AND a.entity_type=?'; params.push(entity_type); }
  if (entity_id)   { where += ' AND a.entity_id=?';   params.push(entity_id); }
  params.push(Number(limit), Number(offset));
  const rows = db.prepare(`SELECT a.*, p.first_name || ' ' || p.last_name AS user_name FROM audit_logs a LEFT JOIN practitioners p ON p.id = a.user_id
    WHERE ${where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`).all(...params);
  res.json(rows);
});

module.exports = router;
