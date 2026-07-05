const router = require('express').Router();
const crypto = require('crypto');
const db = require('../database');
const auth = require('../middleware/auth');
const audit = require('../services/audit');
const { renderTemplate, graphSend } = require('../services/mailer');
const { renderPricingTableHtml } = require('../services/templateVars');
const { generateAgreementPdf } = require('../services/pdf');

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

function getAgreementWithItems(id) {
  const agreement = db.prepare(`
    SELECT a.*, c.first_name || ' ' || c.last_name AS client_name, c.email AS client_email,
      c.address AS client_address, c.ndis_number AS client_ndis_number,
      ft.name AS funding_type_name
    FROM agreements a
    JOIN clients c ON c.id = a.client_id
    LEFT JOIN funding_types ft ON ft.id = a.funding_type_id
    WHERE a.id = ?
  `).get(id);
  if (agreement) agreement.items = db.prepare('SELECT * FROM agreement_items WHERE agreement_id = ? ORDER BY sort_order, id').all(id);
  return agreement;
}

// The active funding period (with its funds manager, if any) as of the agreement's effective
// date — same "most recent period covering this date" logic used elsewhere (clients.js, etc.)
function getFundingPeriodContext(clientId, date) {
  return db.prepare(`
    SELECT fp.start_date AS plan_start_date, fp.end_date AS plan_end_date,
      fm.name AS funds_manager_name, fm.email AS funds_manager_email, fm.phone AS funds_manager_phone
    FROM funding_periods fp
    LEFT JOIN funds_managers fm ON fm.id = fp.funds_manager_id
    WHERE fp.client_id = ?
      AND (fp.start_date IS NULL OR fp.start_date = '' OR fp.start_date <= ?)
      AND (fp.end_date IS NULL OR fp.end_date = '' OR fp.end_date >= ?)
    ORDER BY fp.start_date DESC LIMIT 1
  `).get(clientId, date, date) || {};
}

function assertDraft(agreement, res) {
  if (agreement.status !== 'draft') {
    res.status(409).json({ error: 'Only draft agreements can be edited' });
    return false;
  }
  return true;
}

router.get('/', auth, (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  res.json(db.prepare('SELECT * FROM agreements WHERE client_id = ? ORDER BY created_at DESC').all(client_id));
});

router.get('/:id', auth, (req, res) => {
  const agreement = getAgreementWithItems(req.params.id);
  if (!agreement) return res.status(404).json({ error: 'Not found' });
  res.json(agreement);
});

router.post('/', auth, (req, res) => {
  const { client_id, template_id } = req.body;
  if (!client_id || !template_id) return res.status(400).json({ error: 'client_id and template_id are required' });

  const template = db.prepare('SELECT * FROM templates WHERE id = ? AND type = ?').get(template_id, 'agreement');
  if (!template) return res.status(404).json({ error: 'Agreement template not found' });

  const client = db.prepare(`
    SELECT c.*, fp_active.funding_type AS active_funding_type
    FROM clients c
    LEFT JOIN funding_periods fp_active ON fp_active.id = (
      SELECT id FROM funding_periods
      WHERE client_id = c.id
        AND (start_date IS NULL OR start_date = '' OR DATE(start_date) <= DATE('now')) AND (end_date IS NULL OR end_date = '' OR DATE(end_date) >= DATE('now'))
      ORDER BY start_date DESC LIMIT 1
    )
    WHERE c.id = ?
  `).get(client_id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const fundingType = client.active_funding_type
    ? db.prepare('SELECT id FROM funding_types WHERE name = ?').get(client.active_funding_type)
    : null;

  const effectiveDate = new Date().toISOString().slice(0, 10);
  const result = db.prepare(`
    INSERT INTO agreements (client_id, template_id, funding_type_id, effective_date, title, status, created_by)
    VALUES (?, ?, ?, ?, ?, 'draft', ?)
  `).run(client_id, template_id, fundingType?.id || null, effectiveDate, template.name, req.user.id);

  audit.log('agreement', result.lastInsertRowid, 'created', `Agreement "${template.name}" drafted for ${client.first_name} ${client.last_name}`);
  res.status(201).json(getAgreementWithItems(result.lastInsertRowid));
});

router.patch('/:id', auth, (req, res) => {
  const agreement = db.prepare('SELECT * FROM agreements WHERE id = ?').get(req.params.id);
  if (!agreement) return res.status(404).json({ error: 'Not found' });
  if (!assertDraft(agreement, res)) return;

  const { effective_date, title } = req.body;
  db.prepare('UPDATE agreements SET effective_date = ?, title = ? WHERE id = ?')
    .run(effective_date || agreement.effective_date, title || agreement.title, agreement.id);
  res.json(getAgreementWithItems(agreement.id));
});

// Bulk replace-in-place for pricing table rows — draft-only, server recomputes line_total
router.put('/:id/items', auth, (req, res) => {
  const agreement = db.prepare('SELECT * FROM agreements WHERE id = ?').get(req.params.id);
  if (!agreement) return res.status(404).json({ error: 'Not found' });
  if (!assertDraft(agreement, res)) return;

  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items must be an array' });

  db.transaction(() => {
    db.prepare('DELETE FROM agreement_items WHERE agreement_id = ?').run(agreement.id);
    const insert = db.prepare(`
      INSERT INTO agreement_items (agreement_id, service_id, sort_order, description, code, quantity, unit_rate, line_total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    items.forEach((item, idx) => {
      const quantity = Number(item.quantity) || 0;
      const unitRate = Number(item.unit_rate) || 0;
      insert.run(agreement.id, item.service_id || null, idx, item.description, item.code || null, quantity, unitRate, quantity * unitRate);
    });
  })();

  res.json(getAgreementWithItems(agreement.id));
});

router.delete('/:id/items/:itemId', auth, (req, res) => {
  const agreement = db.prepare('SELECT * FROM agreements WHERE id = ?').get(req.params.id);
  if (!agreement) return res.status(404).json({ error: 'Not found' });
  if (!assertDraft(agreement, res)) return;

  db.prepare('DELETE FROM agreement_items WHERE id = ? AND agreement_id = ?').run(req.params.itemId, agreement.id);
  res.json(getAgreementWithItems(agreement.id));
});

router.post('/:id/void', auth, (req, res) => {
  const agreement = db.prepare('SELECT * FROM agreements WHERE id = ?').get(req.params.id);
  if (!agreement) return res.status(404).json({ error: 'Not found' });
  if (agreement.status === 'signed') return res.status(409).json({ error: 'Cannot void a signed agreement' });

  db.prepare("UPDATE agreements SET status='voided' WHERE id=?").run(agreement.id);
  audit.log('agreement', agreement.id, 'voided', 'Agreement voided');
  res.json(getAgreementWithItems(agreement.id));
});

// Renders the final content, generates the signing token, and either emails the link or
// returns it for in-person opening. Content is written once and never recomputed.
router.post('/:id/finalize', auth, async (req, res) => {
  const agreement = getAgreementWithItems(req.params.id);
  if (!agreement) return res.status(404).json({ error: 'Not found' });
  if (!assertDraft(agreement, res)) return;
  if (!agreement.items.length) return res.status(400).json({ error: 'Add at least one pricing item before sending' });

  const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(agreement.template_id);
  const settings = getSettings();
  const practitioner = db.prepare('SELECT first_name, last_name FROM practitioners WHERE id = ?').get(req.user.id) || {};
  const fundingContext = getFundingPeriodContext(agreement.client_id, agreement.effective_date);
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

  const vars = {
    client_name: agreement.client_name,
    client_first_name: agreement.client_name.split(' ')[0] || '',
    client_address: agreement.client_address || '',
    client_email: agreement.client_email || '',
    client_ndis_number: agreement.client_ndis_number || '',
    practice_name: settings.practice_name || '',
    practice_phone: settings.practice_phone || '',
    practice_abn: settings.practice_abn || '',
    practitioner_name: `${practitioner.first_name || ''} ${practitioner.last_name || ''}`.trim(),
    date: fmtDate(agreement.effective_date),
    plan_start_date: fmtDate(fundingContext.plan_start_date),
    plan_end_date: fmtDate(fundingContext.plan_end_date),
    funds_manager_name: fundingContext.funds_manager_name || '',
    funds_manager_email: fundingContext.funds_manager_email || '',
    funds_manager_phone: fundingContext.funds_manager_phone || '',
    pricing_table: renderPricingTableHtml(agreement.items),
  };
  const renderedHtml = renderTemplate(template.body, vars);
  const token = crypto.randomBytes(24).toString('hex');

  db.prepare(`
    UPDATE agreements SET rendered_html = ?, signing_token = ?, status = 'sent', sent_at = ? WHERE id = ?
  `).run(renderedHtml, token, new Date().toISOString(), agreement.id);

  const signingUrl = `${process.env.APP_URL || ''}/sign/${token}`;

  const { send_email } = req.body;
  if (send_email && agreement.client_email) {
    await graphSend({
      to: agreement.client_email,
      subject: `Please sign: ${agreement.title}`,
      html: `<p>Hi ${vars.client_first_name},</p><p>Please review and sign your ${agreement.title} using the link below.</p><p><a href="${signingUrl}">${signingUrl}</a></p>`,
    });
  }

  audit.log('agreement', agreement.id, 'sent', `Agreement sent${send_email ? ` by email to ${agreement.client_email}` : ' (link only)'}`, { snapshot: { items: agreement.items } });
  res.json({ ...getAgreementWithItems(agreement.id), signing_url: signingUrl });
});

router.get('/:id/pdf', auth, async (req, res) => {
  const agreement = getAgreementWithItems(req.params.id);
  if (!agreement) return res.status(404).json({ error: 'Not found' });

  const pdf = await generateAgreementPdf(agreement);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${agreement.title.replace(/[^a-z0-9]+/gi, '_')}.pdf"`);
  res.send(pdf);
});

module.exports = router;
