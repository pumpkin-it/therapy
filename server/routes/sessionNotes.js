const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');
const { generateSessionNotePdf } = require('../services/pdf');
const { graphSend, renderTemplate, getTemplate } = require('../services/mailer');

function loadNotesWithClient(noteIds) {
  if (!Array.isArray(noteIds) || !noteIds.length) return { client: null, notes: [] };
  const placeholders = noteIds.map(() => '?').join(',');
  const notes = db.prepare(`
    SELECT cn.*, p.first_name || ' ' || p.last_name AS practitioner_name
    FROM session_notes cn
    LEFT JOIN practitioners p ON p.id = cn.practitioner_id
    WHERE cn.id IN (${placeholders})
    ORDER BY cn.created_at ASC
  `).all(...noteIds);
  const client = notes.length ? db.prepare('SELECT * FROM clients WHERE id = ?').get(notes[0].client_id) : null;
  return { client, notes };
}

function dateRangeLabel(notes) {
  if (!notes.length) return '';
  const dates = notes.map(n => new Date(n.created_at));
  const fmt = d => d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  const min = new Date(Math.min(...dates));
  const max = new Date(Math.max(...dates));
  return min.getTime() === max.getTime() ? fmt(min) : `${fmt(min)} – ${fmt(max)}`;
}

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

router.post('/pdf', auth, async (req, res, next) => {
  try {
    const { note_ids } = req.body;
    const { client, notes } = loadNotesWithClient(note_ids);
    if (!client) return res.status(400).json({ error: 'note_ids must reference at least one existing note' });

    const clientName = `${client.first_name} ${client.last_name}`;
    const pdf = await generateSessionNotePdf({ client_name: clientName, notes });
    const filename = `SessionNotes_${client.last_name}_${dateRangeLabel(notes).replace(/[^a-z0-9]+/gi, '_')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (e) { next(e); }
});

router.post('/email', auth, async (req, res, next) => {
  try {
    const { note_ids, to, cc, subject, body } = req.body;
    if (!Array.isArray(to) || !to.length) return res.status(400).json({ error: 'At least one recipient is required' });

    const { client, notes } = loadNotesWithClient(note_ids);
    if (!client) return res.status(400).json({ error: 'note_ids must reference at least one existing note' });

    const clientName = `${client.first_name} ${client.last_name}`;
    const practitioner = db.prepare('SELECT first_name, last_name FROM practitioners WHERE id = ?').get(req.user.id);
    const settings = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value]));
    const dateRange = dateRangeLabel(notes);

    const vars = {
      client_name: clientName,
      client_first_name: client.first_name,
      practitioner_name: practitioner ? `${practitioner.first_name} ${practitioner.last_name}` : '',
      practice_name: settings.practice_name || '',
      date_range: dateRange,
      note_count: notes.length,
      recipient_name: client.first_name || 'there',
    };

    const tpl = getTemplate('session_note_email');
    const finalSubject = subject || (tpl ? renderTemplate(tpl.subject, vars) : `Session notes for ${clientName}`);
    const finalBody = body || (tpl ? renderTemplate(tpl.body, vars) : `<p>Please find attached the session notes for ${clientName} covering ${dateRange}.</p>`);

    const pdf = await generateSessionNotePdf({ client_name: clientName, notes });
    const filename = `SessionNotes_${client.last_name}_${dateRange.replace(/[^a-z0-9]+/gi, '_')}.pdf`;

    await graphSend({
      to,
      cc: cc?.length ? cc : undefined,
      subject: finalSubject,
      html: finalBody,
      attachments: [{ filename, content: pdf, contentType: 'application/pdf' }],
    });

    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
