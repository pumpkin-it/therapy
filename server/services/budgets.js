const db = require('../database');
const { computeAppointmentTotal, computeBudgetItemLiveTotal } = require('../lib/billing');
const { graphSend } = require('./mailer');
const audit = require('./audit');

// Spend for a given client + date range = money actually billed (either a formal invoice, for
// the invoicing_mode='generate' pathway, or a MYOB-exported appointment — export_only mode
// never touches the invoices table, so that money was invisible here before) plus projected
// (booked but not yet billed at all). Deliberately scoped by client_id + date range only — not
// by funding_period_id — since agreements have no funding_period FK, only a funding_type
// category.
//
// Pre-launch/migrated invoices are recorded on the exact same appointment columns
// (myob_exported_at/myob_amount_due/myob_invoice_number/myob_status) a real export would use
// — deliberately, so this calculation (and everything downstream of it) treats them exactly
// like any other billed appointment, with no separate "external billing" concept to keep in
// sync.
//
// `disciplineId`, when given, restricts every part of this to only items/appointments whose
// service belongs to that discipline — an appointment is bound to a practitioner, not a
// discipline, so in principle it can carry items from more than one, and this has to filter
// at the item level rather than assume a whole appointment is homogeneous. Used by budgets,
// which (per-discipline funding) each track spend against just their own discipline; omitted
// entirely (null) for the client-wide totals `getClientSpend`/legacy agreement budgets use.
//
// `forBudget` leaves out appointments flagged exclude_from_budget. Only budget/agreement-budget
// callers pass it — the Billing tab's billed-period totals (getClientSpend) still count every
// appointment, since that money was genuinely billed regardless of which budget it belongs to.
function computeSpend(clientId, startDate, endDate, disciplineId = null, { forBudget = false } = {}) {
  const from = startDate || '0000-01-01';
  const to = endDate || new Date().toISOString().slice(0, 10);

  const disciplineFilter = disciplineId != null ? 'AND s.discipline_id = ?' : '';
  const disciplineParams = disciplineId != null ? [disciplineId] : [];
  const excludeFilter = forBudget ? 'AND COALESCE(ap.exclude_from_budget, 0) = 0' : '';
  const excludeFilterA = forBudget ? 'AND a.exclude_from_budget = 0' : '';

  const { invoiced: formalInvoiced } = db.prepare(`
    SELECT COALESCE(SUM(ii.line_total), 0) AS invoiced
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    LEFT JOIN appointment_items ai ON ai.id = ii.appointment_item_id
    LEFT JOIN appointments ap ON ap.id = ai.appointment_id
    LEFT JOIN services s ON s.id = ai.service_id
    WHERE i.client_id = ? AND i.status != 'void' AND ii.service_date BETWEEN ? AND ? ${disciplineFilter} ${excludeFilter}
  `).get(clientId, from, to, ...disciplineParams);

  // Billed via MYOB export (or a migrated equivalent) — counted at what was BILLED for the
  // appointment, recomputed with the exact formula the export itself used. Deliberately not
  // myob_amount_due: that's MYOB's outstanding balance on the whole invoice, so it drops to $0
  // once paid (a status sync would make every paid session vanish from its budget) and, while
  // unpaid, repeats the full invoice balance on every appointment sharing that invoice.
  // A voided report billing entry (routes/billableReports.js) was exported but then credited back
  // in MYOB, so it's no longer money billed anywhere — left out of every total, not just budgets.
  const exportedAppts = db.prepare(`
    SELECT a.id FROM appointments a
    WHERE a.client_id = ? AND a.myob_exported_at IS NOT NULL AND DATE(a.start_time) BETWEEN ? AND ? ${excludeFilterA}
      AND NOT (a.billable_report_id IS NOT NULL AND a.status = 'cancelled')
  `).all(clientId, from, to);
  let exportedTotal = 0;
  for (const appt of exportedAppts) exportedTotal += computeAppointmentTotal(appt.id, disciplineId);

  // Booked but not yet billed by either mechanism — real future/pending exposure against the
  // budget. Includes a billable late cancellation (real money, just not cancelled-and-worthless)
  // but not a plain non-billable one. Excludes anything already covered by a formal invoice
  // above, so it's never double-counted.
  const pendingAppts = db.prepare(`
    SELECT a.id FROM appointments a
    WHERE a.client_id = ? AND a.myob_exported_at IS NULL
      AND (a.status != 'cancelled' OR a.late_cancel_billable = 1)
      AND DATE(a.start_time) BETWEEN ? AND ? ${excludeFilterA}
      AND NOT EXISTS (
        SELECT 1 FROM invoice_items ii
        JOIN appointment_items ai2 ON ai2.id = ii.appointment_item_id
        WHERE ai2.appointment_id = a.id
      )
  `).all(clientId, from, to);
  let projected = 0;
  for (const appt of pendingAppts) projected += computeAppointmentTotal(appt.id, disciplineId);

  const invoiced = formalInvoiced + exportedTotal;
  return { invoiced, projected, total: invoiced + projected };
}

// Spend for one budget row, against its own discipline + [start_date, end_date-or-today]
// window. `total` (invoiced + projected) is deliberately what pct_used is based on, not just
// invoiced — billing happens in arrears, so by the time something is actually billed, several
// more sessions may already have happened and pushed real exposure well past what's invoiced
// so far. This is also what the 75/90/100% notification job checks against.
function computeBudgetSpend(budgetId) {
  const budget = db.prepare('SELECT * FROM budgets WHERE id = ?').get(budgetId);
  if (!budget) return null;
  const spend = computeSpend(budget.client_id, budget.start_date, budget.end_date, budget.discipline_id, { forBudget: true });

  // `total_amount` is the frozen figure from when this budget was quoted/revised — kept as a
  // historical reference. `current_total_amount` is what pct_used (and the 75/90/100% alerts)
  // actually track, so an NDIS indexation update — which raises the $ figure specifically to
  // keep the same authorized hours affordable — moves the tracked ceiling too, rather than
  // making the same real entitlement look like it's being consumed faster than it actually is.
  // Read from the stored column (refreshed nightly by refreshBudgetCurrentTotals, not
  // recomputed here) — the underlying rates change only a few times a year, so re-resolving
  // every item's rate on every single read bought nothing over refreshing it once a day.
  const currentTotalAmount = budget.current_total_amount ?? budget.total_amount;

  return {
    ...spend,
    total_amount: budget.total_amount,
    current_total_amount: currentTotalAmount,
    pct_used: currentTotalAmount ? (spend.total / currentTotalAmount) * 100 : null,
  };
}

// Called from server/routes/fundingTypes.js the instant a rate period/service rate is
// created, edited, or removed — just flips a flag, no recompute happens here. Keeps the
// (potentially large) recompute off the request thread entirely: a save just needs to record
// "something changed," not wait for every affected budget to be walked.
function markBudgetRatesDirty() {
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('budget_rates_dirty', '1')`).run();
}

// Nightly (wired into server/index.js's runDaily scheduler) — does nothing at all unless a
// rate was actually changed since the last run (checked via the flag markBudgetRatesDirty
// sets), so the 364-ish nights nothing changed cost a single settings lookup, not a walk over
// every budget. When it IS dirty, recomputes and stores current_total_amount for every active
// budget with real line items, then clears the flag. Inactive/superseded budgets are left
// alone — they're historical and nothing about them should keep moving.
function refreshBudgetCurrentTotals() {
  const dirty = db.prepare(`SELECT value FROM settings WHERE key = 'budget_rates_dirty'`).get();
  if (!dirty || dirty.value !== '1') return { skipped: true };

  const today = new Date().toISOString().slice(0, 10);
  const activeBudgets = db.prepare(`SELECT id FROM budgets WHERE status = 'active'`).all();
  const updateStmt = db.prepare(`UPDATE budgets SET current_total_amount = ? WHERE id = ?`);
  let updated = 0;
  for (const { id } of activeBudgets) {
    const items = db.prepare('SELECT * FROM budget_items WHERE budget_id = ?').all(id);
    if (items.length === 0) continue; // legacy migrated budgets have nothing to re-resolve
    const currentTotalAmount = items.reduce((sum, it) => sum + computeBudgetItemLiveTotal(it, today), 0);
    updateStmt.run(currentTotalAmount, id);
    updated++;
  }
  db.prepare(`DELETE FROM settings WHERE key = 'budget_rates_dirty'`).run();
  return { checked: activeBudgets.length, updated };
}

// Nightly (wired into server/index.js's runDaily, unconditional — real spend can change every
// day appointments happen, unlike the rate-refresh above there's no "dirty flag" to gate this
// on). For each active budget, checks whether pct_used has newly crossed 75/90/100% since the
// last time this ran (the notified_*_at columns on `budgets` — see server/database.js — record
// that, so each threshold only ever fires once per budget, never repeats on every subsequent
// night it stays above that line). Only the highest newly-crossed tier for a given run sends —
// jumping straight past 75% and 90% in one day (e.g. several appointments billed at once)
// shouldn't produce three emails, just the one that reflects where things actually stand.
async function sendBudgetAlerts() {
  const practiceInboxRow = db.prepare(`SELECT value FROM settings WHERE key = 'budget_alert_email'`).get();
  const practiceInbox = practiceInboxRow?.value || null;

  const financeOwnerEmails = db.prepare(`
    SELECT email FROM practitioners WHERE role IN ('finance', 'owner') AND active = 1 AND email IS NOT NULL AND email != ''
  `).all().map(r => r.email);

  const activeBudgets = db.prepare(`
    SELECT b.*, d.name AS discipline_name, c.first_name || ' ' || c.last_name AS client_name
    FROM budgets b
    LEFT JOIN disciplines d ON d.id = b.discipline_id
    JOIN clients c ON c.id = b.client_id
    WHERE b.status = 'active'
  `).all();

  // One-time baseline on the very first run in a given database: any threshold a budget has
  // ALREADY passed (e.g. legacy agreement budgets migrated in at go-live) is recorded as
  // notified without emailing anyone, so alerts only ever go out for crossings that happen
  // after the feature went live — not a burst of stale alerts on the first startup.
  const baselined = db.prepare(`SELECT value FROM settings WHERE key = 'budget_alerts_baselined'`).get();
  if (!baselined) {
    const now = new Date().toISOString();
    let marked = 0;
    for (const budget of activeBudgets) {
      const pct = computeBudgetSpend(budget.id)?.pct_used || 0;
      const cols = ['notified_75_at', 'notified_90_at', 'notified_100_at'].filter((_, i) => pct >= [75, 90, 100][i]);
      if (!cols.length) continue;
      db.prepare(`UPDATE budgets SET ${cols.map(c => `${c} = COALESCE(${c}, ?)`).join(', ')} WHERE id = ?`).run(...cols.map(() => now), budget.id);
      audit.log('budget', budget.id, 'threshold_alert_baselined', `Already at ${Math.round(pct)}% when budget alerts went live — marked as notified without emailing`);
      marked++;
    }
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('budget_alerts_baselined', ?)`).run(now);
    console.log(`Budget alerts baselined: ${marked} budget(s) already past a threshold, no emails sent`);
    return 0;
  }

  let sent = 0;
  for (const budget of activeBudgets) {
    const spend = computeBudgetSpend(budget.id);
    if (!spend || !spend.pct_used) continue;
    const pct = spend.pct_used;

    let tier = null;
    if (pct >= 100 && !budget.notified_100_at) tier = 100;
    else if (pct >= 90 && !budget.notified_90_at) tier = 90;
    else if (pct >= 75 && !budget.notified_75_at) tier = 75;
    if (!tier) continue;

    const endForQuery = budget.end_date || new Date().toISOString().slice(0, 10);
    const practitionerEmails = db.prepare(`
      SELECT DISTINCT p.email FROM appointments a
      JOIN practitioners p ON p.id = a.practitioner_id
      WHERE a.client_id = ? AND DATE(a.start_time) BETWEEN ? AND ?
        AND p.active = 1 AND p.email IS NOT NULL AND p.email != ''
    `).all(budget.client_id, budget.start_date, endForQuery).map(r => r.email);

    const recipients = [...new Set([...practitionerEmails, ...financeOwnerEmails, ...(practiceInbox ? [practiceInbox] : [])])];
    if (recipients.length === 0) continue;

    // Labeled purely for UAT's redirected-email visibility (see server/services/mailer.js) —
    // real production sends ignore this entirely and just use `recipients`.
    const debugRecipients = [
      ...practitionerEmails.map(e => `PRACTITIONER EMAIL - ${e}`),
      ...financeOwnerEmails.map(e => `FINANCE/OWNER EMAIL - ${e}`),
      ...(practiceInbox ? [`PRACTICE INBOX - ${practiceInbox}`] : []),
    ];

    const disciplineLabel = budget.discipline_name || 'budget';
    // Every recipient here is staff (practitioners, finance/owner, practice inbox) — this never
    // goes to a client — tagged so it's identifiable at a glance in an inbox, same convention
    // to apply to any future client-facing budget email if one's ever added.
    const subject = `[Internal] Budget alert: ${budget.client_name} — ${disciplineLabel} has reached ${tier}%`;
    const html = `
      <p>The <strong>${disciplineLabel}</strong> budget for <strong>${budget.client_name}</strong> has reached
      <strong>${Math.round(pct)}%</strong> of its currently tracked total
      (${budget.start_date} – ${budget.end_date || 'ongoing'}).</p>
      <p>Spent/scheduled: $${spend.total.toFixed(2)} of $${spend.current_total_amount.toFixed(2)}</p>
    `;

    try {
      await graphSend({ to: recipients, subject, html, debugRecipients });
      // Crossing a higher tier implies every lower one was crossed too — mark all of them
      // notified in the same pass, not just the one that triggered this email. Otherwise a
      // budget that jumps straight to 100% (several appointments billed at once) would still
      // have notified_90_at/notified_75_at sitting null, and a later run would fire a
      // confusing "reached 90%" email *after* the client already knows it hit 100%.
      const now = new Date().toISOString();
      const setCols = ['notified_75_at', 'notified_90_at', 'notified_100_at']
        .filter((col, idx) => [75, 90, 100][idx] <= tier)
        .map(col => `${col} = COALESCE(${col}, ?)`);
      db.prepare(`UPDATE budgets SET ${setCols.join(', ')} WHERE id = ?`)
        .run(...setCols.map(() => now), budget.id);
      audit.log('budget', budget.id, 'threshold_alert_sent', `${tier}% threshold alert sent to ${recipients.join(', ')}`);
      sent++;
    } catch (e) { console.error(`Budget alert failed for budget ${budget.id}:`, e.message); }
  }
  return sent;
}

function getAgreementSpend(agreementId) {
  const agreement = db.prepare('SELECT * FROM agreements WHERE id = ?').get(agreementId);
  if (!agreement) return null;
  const spend = computeSpend(agreement.client_id, agreement.start_date, agreement.end_date, null, { forBudget: true });
  const budget = agreement.budget_amount || null;
  return {
    ...spend,
    budget_amount: budget,
    pct_used: budget ? (spend.total / budget) * 100 : null,
  };
}

function getClientSpend(clientId, from, to) {
  return computeSpend(clientId, from, to);
}

module.exports = {
  getAgreementSpend, getClientSpend, computeBudgetSpend,
  refreshBudgetCurrentTotals, markBudgetRatesDirty, sendBudgetAlerts,
};
