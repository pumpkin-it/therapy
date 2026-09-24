const router = require('express').Router();
const crypto = require('crypto');
const db = require('../database');
const audit = require('../services/audit');
const { generateAgreementPdf } = require('../services/pdf');
const { graphSend } = require('../services/mailer');
const { escapeHtml } = require('../services/templateVars');
const fs = require('fs');
const path = require('path');

const UPLOAD_DIR = path.join(__dirname, '../../uploads');

function getAgreementByToken(token) {
  const agreement = db.prepare(`
    SELECT a.*, c.first_name || ' ' || c.last_name AS client_name, c.email AS client_email, c.first_name AS client_first_name
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
    // Captured once, on the FIRST view — this is the moment the sent link was actually opened,
    // kept alongside signed_ip/signed_user_agent (captured separately at the sign action) so the
    // audit trail can show whether the same device that opened the link is the one that signed.
    const viewIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    db.prepare("UPDATE agreements SET status='viewed', viewed_at=?, viewed_ip=?, viewed_user_agent=? WHERE id=?")
      .run(new Date().toISOString(), viewIp, req.headers['user-agent'] || null, agreement.id);
    agreement.status = 'viewed';
    audit.log('agreement', agreement.id, 'viewed', 'Agreement viewed by client');
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

  // The template's signature line is left as a literal {{client_signature}} placeholder by
  // renderAgreementContent at finalize time (there's nothing to fill in yet) — now that there
  // is, replace it in the already-frozen rendered_html so the actual signature shows up where
  // it visually belongs, in the signature space, rather than only in the separate SIGNED audit
  // block generateAgreementPdf appends after the document body. <em> + ql-font-serif matches
  // generateAgreementPdf's rich-text parser (italic serif), giving a handwritten-ish look without
  // needing an embedded cursive font file.
  const signatureHtml = `<em><span class="ql-font-serif">${escapeHtml(signer_name.trim())}</span></em>`;
  const signedRenderedHtml = agreement.rendered_html.replace(/\{\{client_signature\}\}/g, signatureHtml);

  // SHA-256 of the exact final content, computed at the moment of signing — printed in the PDF's
  // audit trail so a disputed copy can be proven byte-for-byte identical to what was actually
  // signed, independent of anything that might change about how the PDF itself is rendered later.
  const contentHash = crypto.createHash('sha256').update(signedRenderedHtml).digest('hex');

  db.prepare(`
    UPDATE agreements SET status='signed', signed_at=?, signer_name=?, signer_email=?, signed_ip=?, signed_user_agent=?, rendered_html=?, content_hash=?
    WHERE id=?
  `).run(signedAt, signer_name.trim(), req.body.signer_email || null, ip, req.headers['user-agent'] || null, signedRenderedHtml, contentHash, agreement.id);

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

  // Best-effort — a client emailing this to themselves for their own records is a nice-to-have,
  // not something that should block the sign confirmation they're waiting on if it fails.
  if (agreement.client_email) {
    try {
      await graphSend({
        to: agreement.client_email,
        subject: `Your signed copy: ${agreement.title}`,
        html: `<p>Hi ${agreement.client_first_name || ''},</p><p>Thanks for signing your ${agreement.title}. A copy is attached for your records.</p>`,
        attachments: [{ filename: `${agreement.title}.pdf`, content: pdf, contentType: 'application/pdf' }],
      });
      audit.log('agreement', agreement.id, 'signed_copy_emailed', `Signed copy emailed to ${agreement.client_email}`);
    } catch (e) { console.error(`Failed to email signed copy for agreement ${agreement.id}:`, e.message); }
  }

  res.json({ status: 'signed' });
});

// Public — lets the client re-download their own signed copy any time from the confirmation
// page, same trust model as the rest of this router (scoped by the unguessable token). Serves
// the actual stored file generated at sign time (not a live re-render), so it's byte-identical
// to what was emailed and to what a real signature dispute would need to point back to.
router.get('/:token/pdf', (req, res) => {
  const agreement = getAgreementByToken(req.params.token);
  if (!agreement) return res.status(404).json({ error: 'Not found' });
  if (agreement.status !== 'signed' || !agreement.pdf_path) return res.status(404).json({ error: 'No signed copy available' });
  const filePath = path.join(UPLOAD_DIR, agreement.pdf_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${agreement.title.replace(/[^a-z0-9]+/gi, '_')}.pdf"`);
  res.send(fs.readFileSync(filePath));
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
