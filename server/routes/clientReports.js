const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');
const { generateReportPdf } = require('../services/reportPdf');

router.get('/', auth, (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  const reports = db.prepare(`
    SELECT cr.*,
      p.first_name || ' ' || p.last_name AS practitioner_name
    FROM client_reports cr
    LEFT JOIN practitioners p ON p.id = cr.practitioner_id
    WHERE cr.client_id = ?
    ORDER BY cr.created_at DESC
  `).all(client_id);
  res.json(reports.map(r => ({ ...r, sections: JSON.parse(r.sections || '[]') })));
});

router.post('/', auth, (req, res) => {
  const { client_id, template_id, template_name, title, sections, appointment_id } = req.body;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  if (!title)     return res.status(400).json({ error: 'title required' });
  const result = db.prepare(`
    INSERT INTO client_reports (client_id, practitioner_id, template_id, template_name, title, sections, appointment_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(client_id, req.user.id, template_id || null, template_name || null, title, JSON.stringify(sections || []), appointment_id || null);
  const row = db.prepare(`
    SELECT cr.*, p.first_name || ' ' || p.last_name AS practitioner_name
    FROM client_reports cr LEFT JOIN practitioners p ON p.id = cr.practitioner_id
    WHERE cr.id = ?
  `).get(result.lastInsertRowid);
  res.status(201).json({ ...row, sections: JSON.parse(row.sections) });
});

router.put('/:id', auth, (req, res) => {
  const { title, sections } = req.body;
  db.prepare(`
    UPDATE client_reports SET title = ?, sections = ?, updated_at = datetime('now') WHERE id = ?
  `).run(title, JSON.stringify(sections || []), req.params.id);
  const row = db.prepare(`
    SELECT cr.*, p.first_name || ' ' || p.last_name AS practitioner_name
    FROM client_reports cr LEFT JOIN practitioners p ON p.id = cr.practitioner_id
    WHERE cr.id = ?
  `).get(req.params.id);
  res.json({ ...row, sections: JSON.parse(row.sections) });
});

router.delete('/:id', auth, (req, res) => {
  db.prepare('DELETE FROM client_reports WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

router.get('/:id/pdf', auth, async (req, res) => {
  const report = db.prepare(`
    SELECT cr.*,
      c.first_name || ' ' || c.last_name AS client_name,
      p.first_name || ' ' || p.last_name AS practitioner_name
    FROM client_reports cr
    LEFT JOIN clients c ON c.id = cr.client_id
    LEFT JOIN practitioners p ON p.id = cr.practitioner_id
    WHERE cr.id = ?
  `).get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Not found' });

  const settings = db.prepare("SELECT key, value FROM settings WHERE key IN ('practice_name','practice_phone','practice_email','practice_abn')").all();
  const s = Object.fromEntries(settings.map(r => [r.key, r.value]));

  const pdf = await generateReportPdf({
    title: report.title,
    client_name: report.client_name,
    practitioner_name: report.practitioner_name,
    report_date: report.created_at ? report.created_at.split('T')[0].split('-').reverse().join('/') : null,
    sections: JSON.parse(report.sections || '[]'),
    practice_name: s.practice_name,
    practice_phone: s.practice_phone,
    practice_email: s.practice_email,
    practice_abn: s.practice_abn,
  });

  const safeName = (report.title || 'report').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="${safeName}.pdf"`);
  res.send(pdf);
});

module.exports = router;
