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

const db = require('../database');

// Resolves the effective funding_type_id for an appointment — matches invoices.js's
// FP_JOIN_DIRECT_DATE: an appointment's own funding_period if set, else whichever of the
// client's funding periods was in effect on the appointment's date.
const FUNDING_TYPE_JOIN = `
  LEFT JOIN funding_periods fp_direct ON fp_direct.id = a.funding_period_id
  LEFT JOIN funding_periods fp_date ON a.funding_period_id IS NULL AND fp_date.client_id = a.client_id
    AND (fp_date.start_date IS NULL OR fp_date.start_date = '' OR fp_date.start_date <= DATE(a.start_time))
    AND (fp_date.end_date IS NULL OR fp_date.end_date = '' OR fp_date.end_date >= DATE(a.start_time))
  LEFT JOIN funding_types ft ON ft.name = COALESCE(fp_direct.funding_type, fp_date.funding_type)
`;

// Full $ total for one appointment — session + travel + km + notes, including the
// late-cancellation percentage-fee branch (the session line bills at late_cancel_pct% of
// rate, but travel/km/notes still bill at their real rate since that reflects what actually
// happened before the cancellation) — same math as invoices.js's MYOB export route. Used by
// the budget spend calculation for any appointment that hasn't been billed (or MYOB-synced)
// yet, so "booked but not yet billed" reflects the real eventual charge, not just the base
// service line.
function computeAppointmentTotal(apptId) {
  const appt = db.prepare(`
    SELECT a.id, a.start_time, a.status, a.late_cancel_billable, a.late_cancel_pct, ft.id AS funding_type_id
    FROM appointments a
    ${FUNDING_TYPE_JOIN}
    WHERE a.id = ?
  `).get(apptId);
  if (!appt) return 0;

  const apptDate = appt.start_time.slice(0, 10);
  const items = db.prepare(`
    SELECT ai.*, sr.travel_rate_per_hour, sr.km_rate, sr.notes_rate
    FROM appointment_items ai
    LEFT JOIN rate_periods rp ON rp.funding_type_id = ? AND ? BETWEEN rp.start_date AND rp.end_date
    LEFT JOIN service_rates sr ON sr.period_id = rp.id AND sr.service_id = ai.service_id
    WHERE ai.appointment_id = ?
  `).all(appt.funding_type_id, apptDate, apptId);

  let total = 0;
  for (const item of items) {
    if (appt.status === 'cancelled' && appt.late_cancel_billable && appt.late_cancel_pct) {
      total += roundQty(item.quantity) * (item.unit_rate * (appt.late_cancel_pct / 100));
      const travelMin = (item.travel_time_to || 0) + (item.travel_time_from || 0);
      if (travelMin) total += roundQty(travelMin / 60) * (item.travel_rate_per_hour || item.unit_rate);
      if (item.travel_km && item.km_rate) total += roundQty(item.travel_km) * item.km_rate;
      if (item.notes_min) total += roundQty(item.notes_min / 60) * (item.notes_rate || item.unit_rate);
    } else {
      total += computeApptItemAmounts(item).reduce((a, b) => a + b, 0);
    }
  }
  return total;
}

module.exports = { roundQty, computeApptItemAmounts, computeAppointmentTotal };
