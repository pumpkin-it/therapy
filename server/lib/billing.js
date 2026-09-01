// Standard rounding convention for any $ = qty * rate calculation: round the
// quantity to 2 decimal places FIRST, then multiply. This keeps every dollar
// figure (MYOB export, invoices, reports) reconcilable against qty * rate as
// displayed, rather than carrying hidden precision (e.g. minutes/60) that
// external systems recomputing from the displayed quantity can't reproduce.
function roundQty(qty) {
  return Number(Number(qty || 0).toFixed(2));
}

// The per-line dollar amounts a MYOB export would produce for one appointment_item
// (joined with its service_rates row) — same math/order as invoices.js's addRow,
// kept here so the MYOB-sync matching engine (server/routes/myobSync.js) can verify
// a candidate appointment's total against an imported MYOB line-amount sum without
// duplicating the formula.
function computeApptItemAmounts(item) {
  const amounts = [];
  amounts.push(roundQty(item.billed_quantity ?? item.quantity) * (item.billed_unit_rate ?? item.unit_rate));
  const travelMin = (item.travel_time_to || 0) + (item.travel_time_from || 0);
  if (travelMin) amounts.push(roundQty(travelMin / 60) * (item.travel_rate_per_hour || item.unit_rate));
  if (item.travel_km && item.km_rate) amounts.push(roundQty(item.travel_km) * item.km_rate);
  if (item.notes_min) amounts.push(roundQty(item.notes_min / 60) * (item.notes_rate || item.unit_rate));
  return amounts;
}

module.exports = { roundQty, computeApptItemAmounts };
