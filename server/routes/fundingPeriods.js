const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');

router.get('/', auth, (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  const periods = db.prepare(`
    SELECT fp.*, fm.name AS funds_manager_name, fm.email AS funds_manager_email
    FROM funding_periods fp
    LEFT JOIN funds_managers fm ON fm.id = fp.funds_manager_id
    WHERE fp.client_id = ?
    ORDER BY fp.start_date DESC
  `).all(client_id);
  res.json(periods);
});

router.post('/', auth, (req, res) => {
  const { client_id, funding_type, funds_manager_id, start_date, end_date } = req.body;

  // Check for overlaps (only when both periods have dates)
  if (start_date || end_date) {
    const overlaps = db.prepare(`
      SELECT id FROM funding_periods
      WHERE client_id = ?
        AND (start_date IS NULL OR start_date = '' OR DATE(start_date) <= DATE(?))
        AND (end_date IS NULL OR end_date = '' OR DATE(end_date) >= DATE(?))
    `).all(client_id, end_date || '9999-12-31', start_date || '0000-01-01');

    if (overlaps.length) {
      return res.status(422).json({ error: 'This period overlaps with an existing funding period.' });
    }
  }

  const { client_identifier } = req.body;
  const result = db.prepare(`
    INSERT INTO funding_periods (client_id, funding_type, funds_manager_id, client_identifier, start_date, end_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(client_id, funding_type, funds_manager_id || null, client_identifier || null, start_date || null, end_date || null);

  res.status(201).json(db.prepare(`
    SELECT fp.*, fm.name AS funds_manager_name
    FROM funding_periods fp LEFT JOIN funds_managers fm ON fm.id = fp.funds_manager_id
    WHERE fp.id = ?
  `).get(result.lastInsertRowid));
});

router.patch('/:id', auth, (req, res) => {
  const { funding_type, funds_manager_id, client_identifier, start_date, end_date } = req.body;
  const existing = db.prepare('SELECT client_id FROM funding_periods WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  // Check for overlaps excluding self (only when dates exist)
  if (start_date || end_date) {
    const overlaps = db.prepare(`
      SELECT id FROM funding_periods
      WHERE client_id = ? AND id != ?
        AND (start_date IS NULL OR start_date = '' OR DATE(start_date) <= DATE(?))
        AND (end_date IS NULL OR end_date = '' OR DATE(end_date) >= DATE(?))
    `).all(existing.client_id, req.params.id, end_date || '9999-12-31', start_date || '0000-01-01');

    if (overlaps.length) {
      return res.status(422).json({ error: 'This period overlaps with an existing funding period.' });
    }
  }

  db.prepare(`
    UPDATE funding_periods SET funding_type=?, funds_manager_id=?, client_identifier=?, start_date=?, end_date=? WHERE id=?
  `).run(funding_type, funds_manager_id || null, client_identifier || null, start_date || null, end_date || null, req.params.id);

  res.json(db.prepare(`
    SELECT fp.*, fm.name AS funds_manager_name
    FROM funding_periods fp LEFT JOIN funds_managers fm ON fm.id = fp.funds_manager_id
    WHERE fp.id = ?
  `).get(req.params.id));
});

router.delete('/:id', auth, (req, res) => {
  db.prepare('DELETE FROM funding_periods WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

module.exports = router;
