const { roundQty } = require('../lib/billing');

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Expands a budget's line items into the same {description, code, quantity, unit_rate,
// line_total} row shape renderPricingTableHtml already expects — one row per component
// (session, travel, km, notes), same labels/breakdown convention invoices.js already uses for
// real billing, so a budget-sourced pricing table reads the same way a real invoice would.
// Quantity × unit_rate always reconciles with line_total per row (the roundQty convention),
// since sessions is folded into each component's own quantity here rather than shown separately.
function budgetItemsAsPricingRows(items) {
  const rows = [];
  for (const it of items || []) {
    const sessions = Number(it.sessions) || 1;
    const unitRate = Number(it.unit_rate) || 0;
    // NULL/legacy items default to 60 min — matches computeBudgetItemLineTotal's fallback, so a
    // budget's total and its agreement pricing table always agree.
    const durationMin = Number(it.session_duration_min) || 60;
    const perSessionRate = roundQty(durationMin / 60) * unitRate;
    rows.push({ description: `${it.description} (${durationMin} min)`, code: null, quantity: sessions, unit_rate: perSessionRate, line_total: perSessionRate * sessions });

    // Matches computeBudgetItemLineTotal exactly: round the per-session component first, then
    // multiply by sessions — no rounding the product again, so this row's total always agrees
    // with what the budget itself tracks.
    const travelMin = (Number(it.travel_time_to) || 0) + (Number(it.travel_time_from) || 0);
    if (travelMin && it.travel_rate_per_hour) {
      const qty = roundQty(travelMin / 60) * sessions;
      rows.push({ description: `Travel time (${travelMin} min × ${sessions} sessions)`, code: null, quantity: qty, unit_rate: it.travel_rate_per_hour, line_total: qty * it.travel_rate_per_hour });
    }
    if (it.travel_km && it.km_rate) {
      const qty = roundQty(it.travel_km) * sessions;
      rows.push({ description: `Travel distance (${it.travel_km} km × ${sessions} sessions)`, code: null, quantity: qty, unit_rate: it.km_rate, line_total: qty * it.km_rate });
    }
    if (it.notes_min && it.notes_rate) {
      const qty = roundQty(it.notes_min / 60) * sessions;
      rows.push({ description: `Clinical notes (${it.notes_min} min × ${sessions} sessions)`, code: null, quantity: qty, unit_rate: it.notes_rate, line_total: qty * it.notes_rate });
    }
  }
  return rows;
}

// Renders an agreement's pricing table rows into an HTML fragment, substituted in as
// vars.pricing_table via mailer.js's renderTemplate — the same {{var}} pass handles it,
// no separate substitution step needed.
function renderPricingTableHtml(items) {
  const rows = (items || []).map(i => `
    <tr>
      <td>${escapeHtml(i.description)}</td>
      <td>${escapeHtml(i.code || '')}</td>
      <td style="text-align:right">${Number(i.quantity).toFixed(2)}</td>
      <td style="text-align:right">$${Number(i.unit_rate).toFixed(2)}</td>
      <td style="text-align:right">$${Number(i.line_total).toFixed(2)}</td>
    </tr>`).join('');
  const grandTotal = (items || []).reduce((s, i) => s + Number(i.line_total || 0), 0);
  return `
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <thead>
        <tr style="border-bottom:2px solid #333;text-align:left">
          <th>Service</th><th>Code</th><th style="text-align:right">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr style="border-top:2px solid #333;font-weight:bold">
          <td colspan="4" style="text-align:right">Grand Total</td><td style="text-align:right">$${grandTotal.toFixed(2)}</td>
        </tr>
      </tfoot>
    </table>`;
}

module.exports = { renderPricingTableHtml, budgetItemsAsPricingRows, escapeHtml };
