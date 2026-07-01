const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');

router.get('/', auth, (req, res) => {
  const { client_id, appointment_id } = req.query;
  let where = '1=1';
  const params = [];
  if (client_id)      { where += ' AND cn.client_id = ?';      params.push(client_id); }
  if (appointment_id) { where += ' AND cn.appointment_id = ?'; params.push(appointment_id); }

  const notes = db.prepare(`
    SELECT cn.*,
      p.first_name || ' ' || p.last_name AS practitioner_name,
      a.start_time AS appointment_time
    FROM session_notes cn
    LEFT JOIN practitioners p ON p.id = cn.practitioner_id
    LEFT JOIN appointments a ON a.id = cn.appointment_id
    WHERE ${where}
    ORDER BY cn.created_at DESC
  `).all(...params);
  res.json(notes);
});

router.post('/', auth, (req, res) => {
  const { appointment_id, client_id, note } = req.body;
  const result = db.prepare(`
    INSERT INTO session_notes (appointment_id, client_id, practitioner_id, note)
    VALUES (?, ?, ?, ?)
  `).run(appointment_id || null, client_id, req.user.id, note);
  res.status(201).json(db.prepare(`
    SELECT cn.*, p.first_name || ' ' || p.last_name AS practitioner_name
    FROM session_notes cn LEFT JOIN practitioners p ON p.id = cn.practitioner_id
    WHERE cn.id = ?
  `).get(result.lastInsertRowid));
});

router.patch('/:id', auth, (req, res) => {
  db.prepare('UPDATE session_notes SET note = ? WHERE id = ?').run(req.body.note, req.params.id);
  res.json(db.prepare('SELECT * FROM session_notes WHERE id = ?').get(req.params.id));
});

router.delete('/:id', auth, (req, res) => {
  db.prepare('DELETE FROM session_notes WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

module.exports = router;
