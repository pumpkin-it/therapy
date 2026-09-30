const db = require('../database');
const { appointmentAmounts, isNoCharge } = require('./myobExport');

// Overdue report invoices: report entries (appointments.billable_report_id) still not paid in full
// more than `report_overdue_days` (Settings, default 14) after the entry's date — whether or not
// they've reached MYOB yet. Not voided (cancelled) and not "No charge" ($0). One group per MYOB
// invoice (an invoice can cover several entries), or per entry while it has no invoice number;
// a group is as old as its earliest overdue entry. Shown on the Calendar (everyone — therapists
// see their own reports), in the sidebar badge and on the MYOB Invoices screen (finance).
const DEFAULT_DAYS = 14;

function overdueDays() {
  const raw = db.prepare("SELECT value FROM settings WHERE key = 'report_overdue_days'").get()?.value;
  const v = Number(raw);
  return raw != null && String(raw).trim() !== '' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : DEFAULT_DAYS;
}

// Today in Melbourne, as YYYY-MM-DD (the server clock is UTC).
const melbourneToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne' }).format(new Date());
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (from, to) => Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000);
const round2 = n => Math.round(n * 100) / 100;

// { days, groups: [...] } — oldest first. `practitionerId` limits it to reports that practitioner
// writes; `clientId` is the MYOB screen's client filter.
function overdueReportInvoices({ practitionerId = null, clientId = null } = {}) {
  const days = overdueDays();
  const today = melbourneToday();
  const cutoff = addDays(today, -days);
  const params = [cutoff];
  let where = `a.billable_report_id IS NOT NULL AND a.status != 'cancelled' AND a.is_invoiced = 0
    AND substr(a.start_time, 1, 10) <= ?
    AND NOT (a.myob_invoice_number IS NOT NULL AND a.myob_invoice_number != '' AND a.myob_status = 'closed')`;
  if (practitionerId) { where += ' AND br.practitioner_id = ?'; params.push(practitionerId); }
  if (clientId) { where += ' AND a.client_id = ?'; params.push(clientId); }
  const rows = db.prepare(`
    SELECT a.id, a.start_time, a.client_id, a.myob_exported_at, a.myob_invoice_number, a.myob_status, a.myob_amount_due,
      a.billable_report_id, br.title AS report_title, br.practitioner_id,
      c.first_name || ' ' || c.last_name AS client_name,
      p.first_name || ' ' || p.last_name AS practitioner_name
    FROM appointments a
    JOIN billable_reports br ON br.id = a.billable_report_id
    JOIN clients c ON c.id = a.client_id
    JOIN practitioners p ON p.id = br.practitioner_id
    WHERE ${where}
    ORDER BY a.start_time ASC, a.id ASC
  `).all(...params);
  if (!rows.length) return { days, groups: [] };

  // Invoice totals cover every appointment on the number, whatever its date.
  const numbers = [...new Set(rows.map(r => r.myob_invoice_number).filter(Boolean))];
  const onInvoices = numbers.length ? db.prepare(`SELECT id, myob_invoice_number FROM appointments WHERE myob_invoice_number IN (${numbers.map(() => '?').join(',')})`).all(...numbers) : [];
  const amounts = appointmentAmounts([...new Set([...rows.map(r => r.id), ...onInvoices.map(r => r.id)])]);
  const amountOf = id => round2(amounts.get(id) || 0);
  const invoiceTotal = new Map();
  for (const r of onInvoices) invoiceTotal.set(r.myob_invoice_number, round2((invoiceTotal.get(r.myob_invoice_number) || 0) + amountOf(r.id)));

  const groups = new Map();
  for (const r of rows) {
    if (isNoCharge(amountOf(r.id))) continue;
    const key = r.myob_invoice_number ? `inv:${r.myob_invoice_number}` : `appt:${r.id}`;
    let g = groups.get(key);
    if (!g) {
      const no = r.myob_invoice_number || null;
      const total = no ? invoiceTotal.get(no) || 0 : amountOf(r.id);
      const partPaid = no && r.myob_status === 'open' && r.myob_amount_due > 0 && r.myob_amount_due < total - 0.005;
      g = {
        key, invoice_no: no,
        status: no ? (partPaid ? 'part_paid' : 'unpaid') : (r.myob_exported_at ? 'exported' : 'not_exported'),
        total, due: partPaid ? round2(r.myob_amount_due) : total,
        entry_date: r.start_time.slice(0, 10),
        client_id: r.client_id, client_name: r.client_name,
        report_id: r.billable_report_id, report_title: r.report_title,
        practitioner_id: r.practitioner_id, practitioner_name: r.practitioner_name,
        appointment_ids: [],
      };
      groups.set(key, g);
    }
    g.appointment_ids.push(r.id);
  }
  const list = [...groups.values()].map(g => ({ ...g, days_since: daysBetween(g.entry_date, today) }));
  list.sort((a, b) => a.entry_date.localeCompare(b.entry_date));
  return { days, groups: list };
}

module.exports = { overdueReportInvoices };
