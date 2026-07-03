function escapeHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

module.exports = { renderPricingTableHtml };
