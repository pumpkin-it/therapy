const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');
const perm = require('../middleware/requirePermission');

// GET is readable by anyone who can see clients — not just the funds_managers permission —
// since filling in a client's "Funding details" form field needs the fund-manager list
// regardless of role (practitioners have clients but not funds_managers by default). Same
// permAny carve-out pattern as requirePermission.js's own doc comment describes for finance.
// Write actions (create/edit/delete a funder) stay on the original funds_managers permission.
router.get('/', auth, perm.permAny('clients', 'funds_managers'), (req, res) => {
  res.json(db.prepare('SELECT * FROM funds_managers WHERE active = 1 ORDER BY name').all());
});

router.post('/', auth, perm('funds_managers'), (req, res) => {
  const { name, email, phone } = req.body;
  const result = db.prepare('INSERT INTO funds_managers (name, email, phone) VALUES (?, ?, ?)').run(name, email, phone || null);
  res.status(201).json(db.prepare('SELECT * FROM funds_managers WHERE id = ?').get(result.lastInsertRowid));
});

router.patch('/:id', auth, perm('funds_managers'), (req, res) => {
  const { name, email, phone } = req.body;
  db.prepare('UPDATE funds_managers SET name=?, email=?, phone=? WHERE id=?').run(name, email, phone || null, req.params.id);
  res.json(db.prepare('SELECT * FROM funds_managers WHERE id = ?').get(req.params.id));
});

router.delete('/:id', auth, perm('funds_managers'), (req, res) => {
  db.prepare('UPDATE funds_managers SET active = 0 WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

module.exports = router;
