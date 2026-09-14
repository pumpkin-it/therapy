const db = require('../database');
const { computeAppointmentTotal } = require('../lib/billing');

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
function computeSpend(clientId, startDate, endDate) {
  const from = startDate || '0000-01-01';
  const to = endDate || new Date().toISOString().slice(0, 10);

  const { invoiced: formalInvoiced } = db.prepare(`
    SELECT COALESCE(SUM(ii.line_total), 0) AS invoiced
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    WHERE i.client_id = ? AND i.status != 'void' AND ii.service_date BETWEEN ? AND ?
  `).get(clientId, from, to);

  // Billed via MYOB export (or a migrated equivalent) — use the synced dollar amount where
  // known, else fall back to the same full calculation a real export would produce (covers the
  // window between exporting and the status-sync job pulling the amount back).
  const exportedAppts = db.prepare(`
    SELECT id, myob_amount_due FROM appointments
    WHERE client_id = ? AND myob_exported_at IS NOT NULL AND DATE(start_time) BETWEEN ? AND ?
  `).all(clientId, from, to);
  let exportedTotal = 0;
  for (const appt of exportedAppts) {
    exportedTotal += appt.myob_amount_due != null ? appt.myob_amount_due : computeAppointmentTotal(appt.id);
  }

  // Booked but not yet billed by either mechanism — real future/pending exposure against the
  // budget. Includes a billable late cancellation (real money, just not cancelled-and-worthless)
  // but not a plain non-billable one. Excludes anything already covered by a formal invoice
  // above, so it's never double-counted.
  const pendingAppts = db.prepare(`
    SELECT a.id FROM appointments a
    WHERE a.client_id = ? AND a.myob_exported_at IS NULL
      AND (a.status != 'cancelled' OR a.late_cancel_billable = 1)
      AND DATE(a.start_time) BETWEEN ? AND ?
      AND NOT EXISTS (
        SELECT 1 FROM invoice_items ii
        JOIN appointment_items ai2 ON ai2.id = ii.appointment_item_id
        WHERE ai2.appointment_id = a.id
      )
  `).all(clientId, from, to);
  let projected = 0;
  for (const appt of pendingAppts) projected += computeAppointmentTotal(appt.id);

  const invoiced = formalInvoiced + exportedTotal;
  return { invoiced, projected, total: invoiced + projected };
}

function getAgreementSpend(agreementId) {
  const agreement = db.prepare('SELECT * FROM agreements WHERE id = ?').get(agreementId);
  if (!agreement) return null;
  const spend = computeSpend(agreement.client_id, agreement.start_date, agreement.end_date);
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

module.exports = { getAgreementSpend, getClientSpend };
