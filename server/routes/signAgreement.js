const router = require('express').Router();
const db = require('../database');
const audit = require('../services/audit');
const { generateAgreementPdf } = require('../services/pdf');
const fs = require('fs');
const path = require('path');

const UPLOAD_DIR = path.join(__dirname, '../../uploads');

function getAgreementByToken(token) {
  const agreement = db.prepare(`
    SELECT a.*, c.first_name || ' ' || c.last_name AS client_name
    FROM agreements a JOIN clients c ON c.id = a.client_id
    WHERE a.signing_token = ?
  `).get(token);
  if (agreement) agreement.items = db.prepare('SELECT * FROM agreement_items WHERE agreement_id = ? ORDER BY sort_order, id').all(agreement.id);
  return agreement;
}

// Public — no auth. Scoped entirely by the unguessable signing_token, same trust model as
// the calendar feed's /api/cal/:token.ics.
router.get('/:token', (req, res) => {
  const agreement = getAgreementByToken(req.params.token);
  if (!agreement) return res.status(404).json({ error: 'Not found' });

  if (agreement.status === 'sent') {
    db.prepare("UPDATE agreements SET status='viewed', viewed_at=? WHERE id=?").run(new Date().toISOString(), agreement.id);
    agreement.status = 'viewed';
  }
  res.json({
    title: agreement.title,
    rendered_html: agreement.rendered_html,
    status: agreement.status,
    signed_at: agreement.signed_at,
    declined_at: agreement.declined_at,
  });
});

router.post('/:token', async (req, res) => {
  const agreement = getAgreementByToken(req.params.token);
  if (!agreement) return res.status(404).json({ error: 'Not found' });
  if (agreement.status !== 'sent' && agreement.status !== 'viewed') {
    return res.status(409).json({ error: 'This agreement can no longer be signed' });
  }

  const { signer_name } = req.body;
  if (!signer_name?.trim()) return res.status(400).json({ error: 'Signer name is required' });

  const signedAt = new Date().toISOString();
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;

  db.prepare(`
    UPDATE agreements SET status='signed', signed_at=?, signer_name=?, signer_email=?, signed_ip=?, signed_user_agent=?
    WHERE id=?
  `).run(signedAt, signer_name.trim(), req.body.signer_email || null, ip, req.headers['user-agent'] || null, agreement.id);

  const updated = getAgreementByToken(req.params.token);
  const pdf = await generateAgreementPdf(updated);
  const filename = `agreement-${agreement.id}-${Date.now()}.pdf`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), pdf);

  db.prepare('UPDATE agreements SET pdf_path = ? WHERE id = ?').run(filename, agreement.id);
  db.prepare(`
    INSERT INTO client_files (client_id, filename, original_name, size, mime_type)
    VALUES (?, ?, ?, ?, 'application/pdf')
  `).run(agreement.client_id, filename, `${agreement.title}.pdf`, pdf.length);

  audit.log('agreement', agreement.id, 'signed', `Agreement signed by ${signer_name.trim()} from ${ip}`, { snapshot: { signer_name, ip } });
  res.json({ status: 'signed' });
});

router.post('/:token/decline', (req, res) => {
  const agreement = getAgreementByToken(req.params.token);
  if (!agreement) return res.status(404).json({ error: 'Not found' });
  if (agreement.status !== 'sent' && agreement.status !== 'viewed') {
    return res.status(409).json({ error: 'This agreement can no longer be declined' });
  }

  db.prepare("UPDATE agreements SET status='declined', declined_at=? WHERE id=?").run(new Date().toISOString(), agreement.id);
  audit.log('agreement', agreement.id, 'declined', 'Agreement declined by client');
  res.json({ status: 'declined' });
});

module.exports = router;
