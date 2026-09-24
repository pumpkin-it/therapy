const router = require('express').Router();
const crypto = require('crypto');
const db = require('../database');
const auth = require('../middleware/auth');
const audit = require('../services/audit');
const { renderTemplate, graphSend, getTemplate } = require('../services/mailer');
const { renderPricingTableHtml, budgetItemsAsPricingRows } = require('../services/templateVars');
const { generateAgreementPdf } = require('../services/pdf');
const { getAgreementSpend, computeBudgetSpend } = require('../services/budgets');

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

function getAgreementWithItems(id) {
  const agreement = db.prepare(`
    SELECT a.*, c.first_name || ' ' || c.last_name AS client_name, c.email AS client_email,
      c.address AS client_address,
      ft.name AS funding_type_name
    FROM agreements a
    JOIN clients c ON c.id = a.client_id
    LEFT JOIN funding_types ft ON ft.id = a.funding_type_id
    WHERE a.id = ?
  `).get(id);
  if (agreement) {
    agreement.items = db.prepare('SELECT * FROM agreement_items WHERE agreement_id = ? ORDER BY sort_order, id').all(id);
    const withDetails = rows => rows.map(b => ({
      ...b,
      spend: computeBudgetSpend(b.id),
      items: db.prepare('SELECT * FROM budget_items WHERE budget_id = ? ORDER BY sort_order, id').all(b.id),
    }));
    // Only the current (superseded_at IS NULL) links power the pricing table and spend
    // tracking. Historical links are kept forever once a practitioner explicitly switches an
    // agreement over to a revised budget (see /:id/budgets/:budgetId/switch below) — they're a
    // permanent record of what this agreement was tracked against at each point in time, shown
    // separately rather than silently dropped.
    agreement.linked_budgets = withDetails(db.prepare(`
      SELECT b.*, d.name AS discipline_name
      FROM agreement_budgets ab
      JOIN budgets b ON b.id = ab.budget_id
      LEFT JOIN disciplines d ON d.id = b.discipline_id
      WHERE ab.agreement_id = ? AND ab.superseded_at IS NULL
      ORDER BY d.name IS NULL, d.name
    `).all(id));
    agreement.historical_budgets = withDetails(db.prepare(`
      SELECT b.*, d.name AS discipline_name, ab.superseded_at
      FROM agreement_budgets ab
      JOIN budgets b ON b.id = ab.budget_id
      LEFT JOIN disciplines d ON d.id = b.discipline_id
      WHERE ab.agreement_id = ? AND ab.superseded_at IS NOT NULL
      ORDER BY ab.superseded_at DESC
    `).all(id));
  }
  return agreement;
}

// Walks a budget's superseded_by chain to the final, still-active head — a budget can be
// revised more than once before anyone gets around to switching an agreement over, so this
// isn't necessarily a single hop.
function currentBudgetHead(budgetId) {
  let id = budgetId;
  for (;;) {
    const row = db.prepare('SELECT superseded_by FROM budgets WHERE id = ?').get(id);
    if (!row || !row.superseded_by) return id;
    id = row.superseded_by;
  }
}

// The active funding period (with its funds manager, if any) as of the agreement's effective
// date — same "most recent period covering this date" logic used elsewhere (clients.js, etc.)
function getFundingPeriodContext(clientId, date) {
  return db.prepare(`
    SELECT fp.start_date AS plan_start_date, fp.end_date AS plan_end_date, fp.client_identifier,
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

// Builds the rendered HTML for an agreement from its current template + items. Used both to
// persist the immutable snapshot at finalize time, and to render a live (unsaved) preview for
// PDF download while still a draft.
function renderAgreementContent(agreement, practitionerId) {
  const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(agreement.template_id);
  const settings = getSettings();
  const practitioner = db.prepare('SELECT first_name, last_name FROM practitioners WHERE id = ?').get(practitionerId) || {};
  const fundingContext = getFundingPeriodContext(agreement.client_id, agreement.effective_date);
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

  const vars = {
    client_name: agreement.client_name,
    client_first_name: agreement.client_name.split(' ')[0] || '',
    client_address: agreement.client_address || '',
    client_email: agreement.client_email || '',
    client_ndis_number: fundingContext.client_identifier || '',
    practice_name: settings.practice_name || '',
    practice_phone: settings.practice_phone || '',
    practice_abn: settings.practice_abn || '',
    practitioner_name: `${practitioner.first_name || ''} ${practitioner.last_name || ''}`.trim(),
    date: fmtDate(agreement.effective_date),
    agreement_start_date: fmtDate(agreement.start_date) || fmtDate(agreement.effective_date),
    agreement_end_date: fmtDate(agreement.end_date) || 'ongoing',
    plan_start_date: fmtDate(fundingContext.plan_start_date),
    plan_end_date: fmtDate(fundingContext.plan_end_date),
    funds_manager_name: fundingContext.funds_manager_name || '',
    funds_manager_email: fundingContext.funds_manager_email || '',
    funds_manager_phone: fundingContext.funds_manager_phone || '',
    // A linked budget already captures every piece of pricing information (service, sessions,
    // travel/km/notes, current rate) — once one's linked, it's the source of truth for what
    // gets shown to the client, so the separately-maintained agreement_items table is only
    // still used as a fallback for agreements with no linked budget at all.
    pricing_table: renderPricingTableHtml(
      agreement.linked_budgets?.length
        ? agreement.linked_budgets.flatMap(b => budgetItemsAsPricingRows(b.items))
        : agreement.items
    ),
  };
  return renderTemplate(template.body, vars);
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
  const { start_date, end_date, budget_amount, label } = req.body;
  // Defaults to the template's own name (unchanged behaviour) — `label` just lets staff tell
  // apart multiple agreements of the same template for one client (e.g. by plan period) instead
  // of every one of them showing up as an identical "Service Agreement" in the list.
  const title = label?.trim() || template.name;
  const result = db.prepare(`
    INSERT INTO agreements (client_id, template_id, funding_type_id, effective_date, start_date, end_date, budget_amount, title, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)
  `).run(client_id, template_id, fundingType?.id || null, effectiveDate, start_date || effectiveDate, end_date || null, budget_amount || null, title, req.user.id);

  audit.log('agreement', result.lastInsertRowid, 'created', `Agreement "${title}" drafted for ${client.first_name} ${client.last_name}`);
  res.status(201).json(getAgreementWithItems(result.lastInsertRowid));
});

router.patch('/:id', auth, (req, res) => {
  const agreement = db.prepare('SELECT * FROM agreements WHERE id = ?').get(req.params.id);
  if (!agreement) return res.status(404).json({ error: 'Not found' });
  if (!assertDraft(agreement, res)) return;

  const { effective_date, title, start_date, end_date, budget_amount, reminder_end_date } = req.body;
  db.prepare(`
    UPDATE agreements SET effective_date = ?, title = ?, start_date = ?, end_date = ?, budget_amount = ?, reminder_end_date = ? WHERE id = ?
  `).run(
    effective_date || agreement.effective_date,
    title || agreement.title,
    start_date !== undefined ? (start_date || null) : agreement.start_date,
    end_date !== undefined ? (end_date || null) : agreement.end_date,
    budget_amount !== undefined ? (budget_amount || null) : agreement.budget_amount,
    reminder_end_date !== undefined ? (reminder_end_date || null) : agreement.reminder_end_date,
    agreement.id
  );
  res.json(getAgreementWithItems(agreement.id));
});

// Non-blocking budget/spend summary for this agreement's own [start_date, end_date-or-today]
// coverage window — invoiced (from invoice_items) + projected (uninvoiced appointment_items).
router.get('/:id/spend', auth, (req, res) => {
  const agreement = db.prepare('SELECT * FROM agreements WHERE id = ?').get(req.params.id);
  if (!agreement) return res.status(404).json({ error: 'Not found' });
  res.json(getAgreementSpend(agreement.id));
});

// Link/unlink a real Billing-tab budget to this agreement (server/database.js's agreement_budgets
// join table) — an agreement's pricing table isn't itself discipline-scoped, so it can link to
// more than one budget (e.g. its OT items to the OT budget, its Physio items to the Physio one).
router.post('/:id/budgets', auth, (req, res) => {
  const agreement = db.prepare('SELECT * FROM agreements WHERE id = ?').get(req.params.id);
  if (!agreement) return res.status(404).json({ error: 'Not found' });
  const { budget_id } = req.body;
  const budget = db.prepare('SELECT * FROM budgets WHERE id = ? AND client_id = ?').get(budget_id, agreement.client_id);
  if (!budget) return res.status(404).json({ error: 'Budget not found for this client' });

  // ON CONFLICT rather than INSERT OR IGNORE: re-linking a budget that's currently sitting in
  // this agreement's history (e.g. reverting a switch) should bring it back as current, not
  // silently no-op and leave it stuck as historical.
  db.prepare(`
    INSERT INTO agreement_budgets (agreement_id, budget_id, superseded_at) VALUES (?, ?, NULL)
    ON CONFLICT(agreement_id, budget_id) DO UPDATE SET superseded_at = NULL
  `).run(agreement.id, budget.id);
  audit.log('agreement', agreement.id, 'budget_linked', `Linked to budget #${budget.id} (${budget.discipline_id ? '' : 'unassigned discipline, '}$${budget.total_amount.toFixed(2)})`);
  res.json(getAgreementWithItems(agreement.id));
});

router.delete('/:id/budgets/:budgetId', auth, (req, res) => {
  const agreement = db.prepare('SELECT * FROM agreements WHERE id = ?').get(req.params.id);
  if (!agreement) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM agreement_budgets WHERE agreement_id = ? AND budget_id = ?').run(agreement.id, req.params.budgetId);
  audit.log('agreement', agreement.id, 'budget_unlinked', `Unlinked budget #${req.params.budgetId}`);
  res.json(getAgreementWithItems(agreement.id));
});

// Explicit, practitioner-initiated carry-forward when a linked budget has since been revised
// (superseded) — deliberately never automatic, since indexation-driven rate changes already
// live-update the same budget's current_total_amount without a revision, and an actual revision
// (new session counts, new services, etc.) is exactly the kind of change the client needs to be
// made aware of rather than have silently swapped underneath an existing agreement. The old link
// is kept, marked historical, rather than deleted — see getAgreementWithItems's
// linked_budgets/historical_budgets split.
router.post('/:id/budgets/:budgetId/switch', auth, (req, res) => {
  const agreement = db.prepare('SELECT * FROM agreements WHERE id = ?').get(req.params.id);
  if (!agreement) return res.status(404).json({ error: 'Not found' });
  const oldBudgetId = Number(req.params.budgetId);
  const link = db.prepare('SELECT * FROM agreement_budgets WHERE agreement_id = ? AND budget_id = ? AND superseded_at IS NULL').get(agreement.id, oldBudgetId);
  if (!link) return res.status(404).json({ error: 'This budget is not currently linked to the agreement' });

  const newBudgetId = currentBudgetHead(oldBudgetId);
  if (newBudgetId === oldBudgetId) return res.status(400).json({ error: 'This budget has not been revised' });
  const newBudget = db.prepare('SELECT * FROM budgets WHERE id = ?').get(newBudgetId);

  db.transaction(() => {
    db.prepare('UPDATE agreement_budgets SET superseded_at = ? WHERE agreement_id = ? AND budget_id = ?')
      .run(new Date().toISOString(), agreement.id, oldBudgetId);
    db.prepare(`
      INSERT INTO agreement_budgets (agreement_id, budget_id, superseded_at) VALUES (?, ?, NULL)
      ON CONFLICT(agreement_id, budget_id) DO UPDATE SET superseded_at = NULL
    `).run(agreement.id, newBudgetId);
  })();

  audit.log('agreement', agreement.id, 'budget_switched', `Switched from budget #${oldBudgetId} to its current revision #${newBudgetId} ($${newBudget.total_amount.toFixed(2)})`);
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
  if (!agreement.items.length && !agreement.linked_budgets.length) return res.status(400).json({ error: 'Add at least one pricing item, or link a budget, before sending' });

  const renderedHtml = renderAgreementContent(agreement, req.user.id);
  const token = crypto.randomBytes(24).toString('hex');
  const sentAt = new Date().toISOString();

  // A per-agreement reminder end date can be set on the draft before sending; if none was
  // set, default to sentAt + agreement_reminder_duration_days from Settings.
  let reminderEndDate = req.body.reminder_end_date || agreement.reminder_end_date || null;
  if (!reminderEndDate) {
    const settings = getSettings();
    const durationDays = parseInt(settings.agreement_reminder_duration_days || '10');
    if (durationDays) {
      const d = new Date(sentAt);
      d.setDate(d.getDate() + durationDays);
      reminderEndDate = d.toISOString().slice(0, 10);
    }
  }

  db.prepare(`
    UPDATE agreements SET rendered_html = ?, signing_token = ?, status = 'sent', sent_at = ?, reminder_end_date = ? WHERE id = ?
  `).run(renderedHtml, token, sentAt, reminderEndDate, agreement.id);

  const signingUrl = `${process.env.APP_URL || ''}/sign/${token}`;

  const { send_email } = req.body;
  if (send_email && agreement.client_email) {
    await graphSend({
      to: agreement.client_email,
      subject: `Please sign: ${agreement.title}`,
      html: `<p>Hi ${agreement.client_name.split(' ')[0] || ''},</p><p>Please review and sign your ${agreement.title} using the link below.</p><p><a href="${signingUrl}">${signingUrl}</a></p>`,
    });
  }

  audit.log('agreement', agreement.id, 'sent', `Agreement sent${send_email ? ` by email to ${agreement.client_email}` : ' (link only)'}`, { snapshot: { items: agreement.items } });
  res.json({ ...getAgreementWithItems(agreement.id), signing_url: signingUrl });
});

// Re-sends the existing signing link by email — does NOT regenerate the token, so a link the
// client may have already opened (or bookmarked) keeps working.
router.post('/:id/resend', auth, async (req, res) => {
  const agreement = getAgreementWithItems(req.params.id);
  if (!agreement) return res.status(404).json({ error: 'Not found' });
  if (!agreement.signing_token) return res.status(409).json({ error: 'Agreement has not been sent yet' });
  if (!agreement.client_email) return res.status(400).json({ error: 'Client has no email on file' });

  // Same link either way — the public sign page itself already shows the right thing depending
  // on status (the sign form if still outstanding, or the signed confirmation + download button
  // if not) — only the email wording needs to know which one to set expectations for.
  const signingUrl = `${process.env.APP_URL || ''}/sign/${agreement.signing_token}`;
  const isSigned = agreement.status === 'signed';
  await graphSend({
    to: agreement.client_email,
    subject: isSigned ? `Your copy: ${agreement.title}` : `Please sign: ${agreement.title}`,
    html: isSigned
      ? `<p>Hi ${agreement.client_name.split(' ')[0] || ''},</p><p>Here's the link to your signed ${agreement.title} — you can download a copy from there any time.</p><p><a href="${signingUrl}">${signingUrl}</a></p>`
      : `<p>Hi ${agreement.client_name.split(' ')[0] || ''},</p><p>Please review and sign your ${agreement.title} using the link below.</p><p><a href="${signingUrl}">${signingUrl}</a></p>`,
  });

  audit.log('agreement', agreement.id, 'resent', `Agreement resent by email to ${agreement.client_email}`);
  res.json({ ok: true });
});

// Lets the reminder end date be changed any time — unlike the main PATCH /:id route this is
// not draft-only, since it's metadata unrelated to the immutable rendered_html snapshot.
router.patch('/:id/reminder-end-date', auth, (req, res) => {
  const agreement = db.prepare('SELECT * FROM agreements WHERE id = ?').get(req.params.id);
  if (!agreement) return res.status(404).json({ error: 'Not found' });
  const { reminder_end_date } = req.body;
  db.prepare('UPDATE agreements SET reminder_end_date = ? WHERE id = ?').run(reminder_end_date || null, agreement.id);
  audit.log('agreement', agreement.id, 'reminder_end_date_changed',
    `Reminder end date ${reminder_end_date ? `set to ${reminder_end_date}` : 'cleared'}`);
  res.json(getAgreementWithItems(agreement.id));
});

router.get('/:id/pdf', auth, async (req, res) => {
  const agreement = getAgreementWithItems(req.params.id);
  if (!agreement) return res.status(404).json({ error: 'Not found' });
  if (!agreement.items.length && !agreement.linked_budgets.length) return res.status(400).json({ error: 'Add at least one pricing item, or link a budget, to preview the PDF' });

  // Once sent, rendered_html is the immutable snapshot of what the client is signing — always
  // use it as-is. While still a draft there's no snapshot yet, so render a live, unsaved
  // preview from the current template + items instead (never persisted).
  const renderedHtml = agreement.rendered_html || renderAgreementContent(agreement, req.user.id);
  const pdf = await generateAgreementPdf({ ...agreement, rendered_html: renderedHtml });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${agreement.title.replace(/[^a-z0-9]+/gi, '_')}.pdf"`);
  res.send(pdf);
});

// ─── Send reminders for agreements awaiting signature (called by scheduler) ─────────────────
// Mirrors sendOverdueReminders in invoices.js: interval-based eligibility tracked via
// last_reminder_at/reminder_count, but also bounded by a per-agreement reminder_end_date
// (invoices remind indefinitely until paid; agreements stop after a configured window).
async function sendAgreementReminders() {
  const settings = getSettings();
  const intervalDays = parseInt(settings.agreement_reminder_interval_days || '3');
  if (!intervalDays) return 0;

  const cutoff = new Date(Date.now() - intervalDays * 86400000).toISOString();
  const due = db.prepare(`
    SELECT a.*, c.first_name || ' ' || c.last_name AS client_name, c.first_name AS client_first_name, c.email AS client_email
    FROM agreements a JOIN clients c ON c.id = a.client_id
    WHERE a.status IN ('sent', 'viewed')
      AND (a.reminder_end_date IS NULL OR DATE('now') <= DATE(a.reminder_end_date))
      AND (a.last_reminder_at IS NULL OR a.last_reminder_at < ?)
  `).all(cutoff);

  let sent = 0;
  for (const agreement of due) {
    if (!agreement.client_email || !agreement.signing_token) continue;
    try {
      const signingUrl = `${process.env.APP_URL || ''}/sign/${agreement.signing_token}`;
      const vars = { client_first_name: agreement.client_first_name, title: agreement.title, signing_url: signingUrl };
      const tpl = getTemplate('agreement_reminder');
      const subject = tpl ? renderTemplate(tpl.subject, vars) : `Reminder: please sign — ${agreement.title}`;
      const html = tpl ? renderTemplate(tpl.body, vars)
        : `<p>Hi ${agreement.client_first_name},</p><p>This is a friendly reminder that your <strong>${agreement.title}</strong> is still awaiting your signature.</p><p><a href="${signingUrl}">${signingUrl}</a></p>`;
      await graphSend({ to: agreement.client_email, subject, html });
      db.prepare('UPDATE agreements SET last_reminder_at=?, reminder_count=reminder_count+1 WHERE id=?')
        .run(new Date().toISOString(), agreement.id);
      audit.log('agreement', agreement.id, 'reminder_sent', `Reminder ${agreement.reminder_count + 1} sent to ${agreement.client_email}`);
      sent++;
    } catch (e) { console.error(`Agreement reminder failed for agreement ${agreement.id}:`, e.message); }
  }
  return sent;
}

module.exports = router;
module.exports.sendAgreementReminders = sendAgreementReminders;
