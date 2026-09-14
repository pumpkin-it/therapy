const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');
const { generateSessionNotePdf } = require('../services/pdf');
const { graphSend, renderTemplate, getTemplate } = require('../services/mailer');

function loadNotesWithClient(noteIds) {
  if (!Array.isArray(noteIds) || !noteIds.length) return { client: null, notes: [] };
  const placeholders = noteIds.map(() => '?').join(',');
  const notes = db.prepare(`
    SELECT cn.*, p.first_name || ' ' || p.last_name AS practitioner_name, a.start_time AS appointment_time
    FROM session_notes cn
    LEFT JOIN practitioners p ON p.id = cn.practitioner_id
    LEFT JOIN appointments a ON a.id = cn.appointment_id
    WHERE cn.id IN (${placeholders})
    ORDER BY cn.created_at ASC
  `).all(...noteIds);
  const client = notes.length ? db.prepare('SELECT * FROM clients WHERE id = ?').get(notes[0].client_id) : null;
  return { client, notes };
}

// The date a note's PDF/email should show is the actual SESSION date (the linked appointment's
// start_time), never created_at (when the note text was typed) — a note entered days after the
// session must still say it covers the session date, not today. appointment_time is naive LOCAL
// Sydney time (same convention as every other appointments.start_time read in this codebase, see
// mailer.js's fmt/fmtDateOnly), so it's parsed with no 'Z' suffix — unlike created_at, which is
// naive UTC and needs one appended before parsing (see client/src/lib/utils.js's fmtDateOnly for
// the same distinction). A standalone note with no linked appointment (e.g. a phone-call/
// communication note) has no session date at all, so created_at is the only meaningful fallback
// for those — this deliberately leaves created_at itself, and any note-added log/audit timestamp
// that reads it, showing the real entry date.
function sessionDateOf(note) {
  if (note.appointment_time) return new Date(note.appointment_time);
  if (!note.created_at) return null;
  return new Date(note.created_at.endsWith('Z') ? note.created_at : note.created_at + 'Z');
}

function dateRangeLabel(notes) {
  const dates = notes.map(sessionDateOf).filter(Boolean);
  if (!dates.length) return '';
  const fmt = d => d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Sydney' });
  const min = new Date(Math.min(...dates));
  const max = new Date(Math.max(...dates));
  return min.getTime() === max.getTime() ? fmt(min) : `${fmt(min)} – ${fmt(max)}`;
}

router.get('/', auth, (req, res) => {
  const { client_id, appointment_id } = req.query;
  let where = 'cn.archived = 0';
  const params = [];
  if (client_id)      { where += ' AND cn.client_id = ?';      params.push(client_id); }
  if (appointment_id) { where += ' AND cn.appointment_id = ?'; params.push(appointment_id); }

  const notes = db.prepare(`
    SELECT cn.*,
      p.first_name || ' ' || p.last_name AS practitioner_name,
      a.start_time AS appointment_time,
      (SELECT COUNT(*) FROM session_note_files f WHERE f.session_note_id = cn.id) AS file_count
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

// Also used to link/unlink a standalone note to an appointment after the fact (note and
// appointment_id are independent — either can be sent without the other). A note can only be
// linked to an appointment belonging to the same client, since the session date shown/used
// elsewhere (PDF, email) comes from that appointment's start_time.
router.patch('/:id', auth, (req, res) => {
  const existing = db.prepare('SELECT * FROM session_notes WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const note = req.body.note !== undefined ? req.body.note : existing.note;
  let appointment_id = existing.appointment_id;
  if (req.body.appointment_id !== undefined) {
    appointment_id = req.body.appointment_id || null;
    if (appointment_id) {
      const appt = db.prepare('SELECT client_id FROM appointments WHERE id = ?').get(appointment_id);
      if (!appt || appt.client_id !== existing.client_id) {
        return res.status(400).json({ error: 'That appointment does not belong to this client' });
      }
    }
  }

  db.prepare('UPDATE session_notes SET note = ?, appointment_id = ? WHERE id = ?').run(note, appointment_id, req.params.id);
  res.json(db.prepare(`
    SELECT cn.*, p.first_name || ' ' || p.last_name AS practitioner_name, a.start_time AS appointment_time
    FROM session_notes cn
    LEFT JOIN practitioners p ON p.id = cn.practitioner_id
    LEFT JOIN appointments a ON a.id = cn.appointment_id
    WHERE cn.id = ?
  `).get(req.params.id));
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
