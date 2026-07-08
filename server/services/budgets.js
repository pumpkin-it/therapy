const db = require('../database');

// Spend for a given client + date range = invoiced (frozen $ already on an invoice) plus
// projected (uninvoiced appointment line items, i.e. sessions already booked but not yet
// billed). Deliberately scoped by client_id + date range only — not by funding_period_id —
// since agreements have no funding_period FK, only a funding_type category.
function computeSpend(clientId, startDate, endDate) {
  const from = startDate || '0000-01-01';
  const to = endDate || new Date().toISOString().slice(0, 10);

  const { invoiced } = db.prepare(`
    SELECT COALESCE(SUM(ii.line_total), 0) AS invoiced
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    WHERE i.client_id = ? AND i.status != 'void' AND ii.service_date BETWEEN ? AND ?
  `).get(clientId, from, to);

  const { projected } = db.prepare(`
    SELECT COALESCE(SUM(ai.quantity * ai.unit_rate), 0) AS projected
    FROM appointment_items ai
    JOIN appointments a ON a.id = ai.appointment_id
    WHERE a.client_id = ? AND a.is_invoiced = 0 AND a.status != 'cancelled'
      AND DATE(a.start_time) BETWEEN ? AND ?
  `).get(clientId, from, to);

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
