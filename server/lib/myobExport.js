const db = require('../database');
const audit = require('../services/audit');
const { roundQty } = require('./billing');

// Builds the appointment-based MYOB import CSV — the one format both the Invoices page's "Export
// to MYOB" button and report billing's send-to-accounts email use, so the two can never drift
// apart. Moved here unchanged from invoices.js's /export-myob-appointments route.

const fmtClientRef = id => `C${String(id).padStart(4, '0')}`;
const fmtFundingTypeRef = id => `F${String(id).padStart(4, '0')}`;

const fmtDateDMY = d => {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
};

const csvEscape = v => {
  const s = String(v ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
};

const FP_JOIN_DIRECT_DATE = `
  LEFT JOIN funding_periods fp_direct ON fp_direct.id = a.funding_period_id
  LEFT JOIN funding_periods fp_date ON a.funding_period_id IS NULL AND fp_date.client_id = a.client_id
    AND (fp_date.start_date IS NULL OR fp_date.start_date = '' OR fp_date.start_date <= DATE(a.start_time))
    AND (fp_date.end_date IS NULL OR fp_date.end_date = '' OR fp_date.end_date >= DATE(a.start_time))
`;

const MYOB_HEADERS = ['Date','Detail Date','Activity ID','Hours/Units','Note','Rate','Amount','Journal Memo','Tax Code','Card ID','Customer PO','Comment'];

// One appointment's MYOB lines — exactly what goes into the import file (and so what the MYOB
// invoice for it adds up to). Returns null for an appointment that doesn't exist, and
// { appt, lines: [] } for one with no billable items.
const APPT_HEADER_SELECT = `
  SELECT a.*, c.first_name || ' ' || c.last_name AS client_name, c.id AS cid,
    p.first_name || ' ' || p.last_name AS practitioner_name, p.provider_number,
    COALESCE(fp_direct.funding_type, fp_date.funding_type) AS funding_type,
    COALESCE(fp_direct.client_identifier, fp_date.client_identifier) AS client_identifier,
    ft.id AS funding_type_id
  FROM appointments a
  JOIN clients c ON c.id = a.client_id
  JOIN practitioners p ON p.id = a.practitioner_id
  ${FP_JOIN_DIRECT_DATE}
  LEFT JOIN funding_types ft ON ft.name = COALESCE(fp_direct.funding_type, fp_date.funding_type)
`;

// The MYOB lines for one appointment, from its row and its items (with their rates joined).
function linesFor(appt, items) {
  const lines = [];
  const add = (code, desc, qty, rate, gstType, invoiceNote) => {
    const q = roundQty(qty);
    lines.push({ code, desc, qty: q, rate, amount: q * rate, gstType, invoiceNote });
  };
  for (const item of items) {
    const gstType = item.gst_type || 'GST';
    if (appt.status === 'cancelled' && appt.late_cancel_billable && appt.late_cancel_pct) {
      const cancelRate = item.unit_rate * (appt.late_cancel_pct / 100);
      add(item.cancel_code || '', `Cancellation fee (${appt.late_cancel_pct}% — ${item.service_name || item.description})`, item.quantity, cancelRate, gstType);
    } else {
      add(item.service_code || '', item.service_name || item.description, item.billed_quantity ?? item.quantity, item.billed_unit_rate ?? item.unit_rate, gstType, item.item_notes);
    }
    // Travel/km/notes bill at their real, un-discounted rate regardless of a late
    // cancellation — only the session itself is a percentage fee. These fields reflect
    // what actually happened (e.g. the practitioner already drove to the client's home
    // before the cancellation); if travel never occurred, they're expected to already be
    // cleared on the appointment_item rather than zeroed out here.
    const travelMin = (item.travel_time_to || 0) + (item.travel_time_from || 0);
    if (travelMin) add(item.travel_code || '', `Travel time (${travelMin} min)`, travelMin / 60, item.billed_travel_rate ?? item.travel_rate_per_hour ?? item.unit_rate, gstType);
    if (item.travel_km && item.km_rate) add(item.km_code || '', `Travel distance (${item.travel_km} km)`, item.travel_km, item.billed_km_rate ?? item.km_rate, gstType);
    if (item.notes_min) add(item.notes_code || '', `Clinical notes (${item.notes_min} min)`, item.notes_min / 60, item.billed_notes_rate ?? item.notes_rate ?? item.unit_rate, gstType);
  }
  return lines;
}

// One appointment's MYOB lines — exactly what goes into the import file (and so what the MYOB
// invoice for it adds up to). Returns null for an appointment that doesn't exist, and
// { appt, lines: [] } for one with no billable items.
function appointmentLines(apptId) {
  const appt = db.prepare(`${APPT_HEADER_SELECT} WHERE a.id = ?`).get(apptId);
  if (!appt) return null;

  const apptDate = appt.start_time ? appt.start_time.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const items = db.prepare(`
    SELECT ai.*, s.name AS service_name, sr.code AS service_code,
      sr.travel_rate_per_hour, sr.km_rate, sr.notes_rate,
      sr.travel_code, sr.km_code, sr.notes_code, sr.cancel_code,
      COALESCE(sr.gst_type, 'GST') AS gst_type
    FROM appointment_items ai
    LEFT JOIN services s ON s.id = ai.service_id
    LEFT JOIN rate_periods rp ON rp.funding_type_id = ? AND ? BETWEEN rp.start_date AND rp.end_date
    LEFT JOIN service_rates sr ON sr.period_id = rp.id AND sr.service_id = ai.service_id
    WHERE ai.appointment_id = ?
  `).all(appt.funding_type_id, apptDate, apptId);
  return { appt, lines: linesFor(appt, items) };
}

// What an appointment adds to its MYOB invoice (the sum of its import lines, as exported).
const appointmentAmount = apptId => (appointmentLines(apptId)?.lines || []).reduce((s, l) => s + l.amount, 0);

// The same amounts for many appointments at once (the MYOB Invoices screen) — a handful of
// queries in total instead of two per appointment. Rates are resolved in memory exactly as the
// per-appointment query joins them. Returns Map(id → amount); unknown ids are left out.
function appointmentAmounts(ids) {
  const out = new Map();
  if (!ids.length) return out;
  const rates = db.prepare('SELECT id, funding_type_id, start_date, end_date FROM rate_periods ORDER BY rowid').all();
  const srByKey = new Map();
  for (const sr of db.prepare('SELECT * FROM service_rates ORDER BY rowid').all()) {
    const k = `${sr.period_id}:${sr.service_id}`;
    if (!srByKey.has(k)) srByKey.set(k, []);
    srByKey.get(k).push(sr);
  }
  const today = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const marks = chunk.map(() => '?').join(',');
    const appts = new Map();
    for (const a of db.prepare(`${APPT_HEADER_SELECT} WHERE a.id IN (${marks})`).all(...chunk)) if (!appts.has(a.id)) appts.set(a.id, a);
    const itemsByAppt = new Map();
    for (const it of db.prepare(`SELECT ai.*, s.name AS service_name FROM appointment_items ai LEFT JOIN services s ON s.id = ai.service_id WHERE ai.appointment_id IN (${marks}) ORDER BY ai.rowid`).all(...chunk)) {
      const appt = appts.get(it.appointment_id);
      if (!appt) continue;
      const date = appt.start_time ? appt.start_time.slice(0, 10) : today;
      const periods = rates.filter(rp => rp.funding_type_id === appt.funding_type_id && date >= rp.start_date && date <= rp.end_date);
      const joined = [];
      for (const rp of periods.length ? periods : [null]) {
        const srs = rp ? (srByKey.get(`${rp.id}:${it.service_id}`) || [null]) : [null];
        for (const sr of srs) {
          joined.push({ ...it, service_code: sr?.code ?? null, travel_rate_per_hour: sr?.travel_rate_per_hour ?? null, km_rate: sr?.km_rate ?? null,
            notes_rate: sr?.notes_rate ?? null, travel_code: sr?.travel_code ?? null, km_code: sr?.km_code ?? null, notes_code: sr?.notes_code ?? null,
            cancel_code: sr?.cancel_code ?? null, gst_type: sr?.gst_type ?? 'GST' });
        }
      }
      if (!itemsByAppt.has(it.appointment_id)) itemsByAppt.set(it.appointment_id, []);
      itemsByAppt.get(it.appointment_id).push(...joined);
    }
    for (const [id, appt] of appts) out.set(id, linesFor(appt, itemsByAppt.get(id) || []).reduce((s, l) => s + l.amount, 0));
  }
  return out;
}

// Returns { csv, exportedAppts } — appointments with no billable items are skipped and left out
// of exportedAppts, so callers only ever mark what actually went into the file.
function buildAppointmentsMyobCsv(ids, invDate) {
  const rows = [MYOB_HEADERS.join(',')];
  const exportedAppts = [];

  let first = true;
  for (const apptId of ids) {
    const built = appointmentLines(apptId);
    if (!built || !built.lines.length) continue;
    const { appt, lines } = built;
    exportedAppts.push(appt);

    if (!first) rows.push(',,,,,,,,,,,');
    first = false;

    const serviceDate = appt.start_time ? appt.start_time.slice(0, 10) : '';
    const ftRef = appt.funding_type_id ? fmtFundingTypeRef(appt.funding_type_id) : '';
    const clientRef = fmtClientRef(appt.cid);
    const cardId = ftRef ? `${clientRef}-${ftRef}` : clientRef;

    for (const l of lines) {
      rows.push([
        fmtDateDMY(invDate),
        fmtDateDMY(serviceDate),
        ftRef,
        l.qty.toFixed(2),
        csvEscape([l.code, l.desc, l.invoiceNote].filter(Boolean).join(' - ')),
        l.rate.toFixed(2),
        l.amount.toFixed(2),
        csvEscape(appt.client_name),
        l.gstType,
        cardId,
        csvEscape(appt.client_identifier || ''),
        csvEscape(`${appt.practitioner_name || ''} - ${appt.provider_number || ''}`)
      ].join(','));
    }
  }

  return { csv: rows.join('\r\n') + '\r\n', exportedAppts };
}

function markAppointmentsExported(appts, via = 'pre-generation') {
  const exportedAtIso = new Date().toISOString();
  const exportedAtLabel = new Date(exportedAtIso).toLocaleString('en-AU', {
    timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  });
  const markApptExported = db.prepare('UPDATE appointments SET myob_exported_at = ? WHERE id = ?');
  for (const appt of appts) {
    markApptExported.run(exportedAtIso, appt.id);
    audit.log('appointment', appt.id, 'myob_exported',
      `APT-${String(appt.id).padStart(5, '0')} exported to MYOB (${via}) at ${exportedAtLabel}`,
      { ref: `APT-${String(appt.id).padStart(5, '0')}` });
  }
  return exportedAtIso;
}

module.exports = {
  buildAppointmentsMyobCsv, markAppointmentsExported, appointmentLines, appointmentAmount, appointmentAmounts,
  fmtClientRef, fmtFundingTypeRef, fmtDateDMY, csvEscape, FP_JOIN_DIRECT_DATE, MYOB_HEADERS,
};
