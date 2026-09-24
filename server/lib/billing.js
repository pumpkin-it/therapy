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

// One quoted budget_items line's $ — one session's worth (session + travel + km + notes, same
// math/order as computeApptItemAmounts) multiplied by how many sessions that line represents
// over the budget's period. The session component scales by session_duration_min/60 (NULL/legacy
// items default to 60 min, i.e. the old implicit "1 session = 1 hour" behaviour) rather than
// always being exactly 1 unit — a client with longer or shorter sessions than the catalog
// default bills accordingly. `sessions` is separately what stands in for "how many of these happen".
function computeBudgetItemLineTotal(item) {
  const durationHours = (Number(item.session_duration_min) || 60) / 60;
  const perSession = roundQty(durationHours) * Number(item.unit_rate || 0)
    + (() => {
      const travelMin = (Number(item.travel_time_to) || 0) + (Number(item.travel_time_from) || 0);
      return travelMin ? roundQty(travelMin / 60) * Number(item.travel_rate_per_hour || item.unit_rate || 0) : 0;
    })()
    + (item.travel_km && item.km_rate ? roundQty(item.travel_km) * Number(item.km_rate) : 0)
    + (item.notes_min ? roundQty(item.notes_min / 60) * Number(item.notes_rate || item.unit_rate || 0) : 0);
  return perSession * Number(item.sessions || 1);
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
//
// `disciplineId`, when given, restricts the total to only items whose service belongs to that
// discipline — an appointment can in principle carry items from more than one discipline (it's
// bound to a practitioner, not a discipline), so discipline-scoped budget tracking has to
// filter at the item level rather than assume a whole appointment is homogeneous.
function computeAppointmentTotal(apptId, disciplineId = null) {
  const appt = db.prepare(`
    SELECT a.id, a.start_time, a.status, a.late_cancel_billable, a.late_cancel_pct, ft.id AS funding_type_id
    FROM appointments a
    ${FUNDING_TYPE_JOIN}
    WHERE a.id = ?
  `).get(apptId);
  if (!appt) return 0;

  const apptDate = appt.start_time.slice(0, 10);
  let items = db.prepare(`
    SELECT ai.*, sr.travel_rate_per_hour, sr.km_rate, sr.notes_rate, s.discipline_id
    FROM appointment_items ai
    LEFT JOIN rate_periods rp ON rp.funding_type_id = ? AND ? BETWEEN rp.start_date AND rp.end_date
    LEFT JOIN service_rates sr ON sr.period_id = rp.id AND sr.service_id = ai.service_id
    LEFT JOIN services s ON s.id = ai.service_id
    WHERE ai.appointment_id = ?
  `).all(appt.funding_type_id, apptDate, apptId);
  if (disciplineId != null) items = items.filter(item => item.discipline_id === disciplineId);

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

// Distinct discipline_ids among an appointment's items — used by discipline-scoped spend
// tracking to tell whether a whole appointment's already-synced myob_amount_due can be trusted
// as-is for one discipline (single-discipline appointment, the common case) or must instead be
// recomputed item-by-item via computeAppointmentTotal(apptId, disciplineId) (mixed appointment).
function appointmentDisciplines(apptId) {
  const rows = db.prepare(`
    SELECT DISTINCT s.discipline_id AS discipline_id
    FROM appointment_items ai
    LEFT JOIN services s ON s.id = ai.service_id
    WHERE ai.appointment_id = ?
  `).all(apptId);
  return rows.map(r => r.discipline_id);
}

// Looks up a service's currently-effective rate as of `date`, independent of any client or
// funder context — mirrors the global lookup in server/routes/fundingTypes.js's
// /service-rates route, scoped to one service. Used to keep a budget's live total in step with
// NDIS indexation: the annual price-guide update that raises the $ figure specifically so the
// same number of already-authorized hours stays affordable — so a budget re-resolving rates
// here is tracking the real entitlement, not drifting away from it.
function resolveCurrentServiceRate(serviceId, date) {
  return db.prepare(`
    SELECT sr.rate, sr.travel_rate_per_hour, sr.km_rate, sr.notes_rate
    FROM service_rates sr
    JOIN rate_periods rp ON rp.id = sr.period_id
    WHERE sr.service_id = ? AND ? BETWEEN rp.start_date AND rp.end_date
    ORDER BY rp.start_date DESC
    LIMIT 1
  `).get(serviceId, date) || null;
}

// A budget_item's $ at TODAY's rates rather than whatever was quoted/snapshotted when it was
// added. A catalog-linked item (service_id set) re-resolves its rate fresh via
// resolveCurrentServiceRate every time this runs; a manual/free-text item (no service_id) has
// no catalog entry to re-resolve against, so it just keeps whatever rate was typed in — there's
// nothing for it to track against.
function computeBudgetItemLiveTotal(item, date) {
  const current = item.service_id ? resolveCurrentServiceRate(item.service_id, date) : null;
  const unitRate = current ? current.rate : item.unit_rate;
  const travelRate = current ? (current.travel_rate_per_hour || current.rate) : (item.travel_rate_per_hour || item.unit_rate);
  const kmRate = current ? current.km_rate : item.km_rate;
  const notesRate = current ? (current.notes_rate || current.rate) : (item.notes_rate || item.unit_rate);

  const travelMin = (Number(item.travel_time_to) || 0) + (Number(item.travel_time_from) || 0);
  const durationHours = (Number(item.session_duration_min) || 60) / 60;
  const perSession = roundQty(durationHours) * Number(unitRate || 0)
    + (travelMin ? roundQty(travelMin / 60) * Number(travelRate || 0) : 0)
    + (item.travel_km && kmRate ? roundQty(item.travel_km) * Number(kmRate) : 0)
    + (item.notes_min ? roundQty(item.notes_min / 60) * Number(notesRate || 0) : 0);
  return perSession * Number(item.sessions || 1);
}

module.exports = {
  roundQty, computeApptItemAmounts, computeAppointmentTotal, appointmentDisciplines,
  computeBudgetItemLineTotal, computeBudgetItemLiveTotal,
};
