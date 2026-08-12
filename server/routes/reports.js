const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');

const PERIOD_DAYS = { weekly: 7, fortnightly: 14, monthly: 30.44 };

const csvEscape = v => {
  const s = String(v ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
};

function daysInRange(from, to) {
  const ms = new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`);
  return Math.max(1, Math.round(ms / 86400000) + 1);
}

// Parses a comma-separated query param (e.g. "1,4,7") into an array of ids, or [] if absent.
function parseIds(raw) {
  if (!raw) return [];
  return String(raw).split(',').map(s => s.trim()).filter(Boolean);
}

function inClause(column, ids, params) {
  if (!ids.length) return '';
  params.push(...ids);
  return ` AND ${column} IN (${ids.map(() => '?').join(',')})`;
}

// Booked activity: hours/travel/km/notes/$ resolved per appointment_item, exactly mirroring
// the invoice-generation rate-resolution join and the billable-cancellation branch in invoices.js
// (a billable cancellation contributes its fee $ but no hours/travel/km/notes — no session happened).
function queryBooked({ from, to, practitionerIds, clientIds, serviceIds }) {
  const params = [from, `${to}T23:59`];
  let where = "(a.status != 'cancelled' OR a.late_cancel_billable = 1) AND a.status != 'pending' AND a.start_time >= ? AND a.start_time <= ? AND (c.is_test_data IS NULL OR c.is_test_data = 0)";
  where += inClause('a.practitioner_id', practitionerIds, params);
  where += inClause('a.client_id', clientIds, params);
  where += inClause('ai.service_id', serviceIds, params);

  return db.prepare(`
    SELECT ai.quantity, ai.unit_rate, ai.billed_quantity, ai.billed_unit_rate, ai.travel_time_to, ai.travel_time_from, ai.travel_km, ai.notes_min,
      a.practitioner_id, a.client_id, a.status, a.late_cancel_billable, a.late_cancel_pct,
      ai.service_id, s.name AS service_name,
      sr.travel_rate_per_hour, sr.km_rate, sr.notes_rate
    FROM appointment_items ai
    JOIN appointments a ON a.id = ai.appointment_id
    JOIN clients c ON c.id = a.client_id
    LEFT JOIN services s ON s.id = ai.service_id
    LEFT JOIN funding_periods fp_direct ON fp_direct.id = a.funding_period_id
    LEFT JOIN funding_periods fp_date ON a.funding_period_id IS NULL AND fp_date.client_id = a.client_id
      AND (fp_date.start_date IS NULL OR fp_date.start_date = '' OR fp_date.start_date <= DATE(a.start_time))
      AND (fp_date.end_date IS NULL OR fp_date.end_date = '' OR fp_date.end_date >= DATE(a.start_time))
    LEFT JOIN funding_types ft ON ft.name = COALESCE(fp_direct.funding_type, fp_date.funding_type)
    LEFT JOIN rate_periods rp ON rp.funding_type_id = ft.id AND DATE(a.start_time) BETWEEN rp.start_date AND rp.end_date
    LEFT JOIN service_rates sr ON sr.period_id = rp.id AND sr.service_id = ai.service_id
    WHERE ${where}
  `).all(...params);
}

function queryInvoiced({ from, to, practitionerIds, clientIds, serviceIds }) {
  const params = [from, to];
  let where = "i.status != 'void' AND ii.service_date BETWEEN ? AND ? AND (c.is_test_data IS NULL OR c.is_test_data = 0)";
  where += inClause('i.practitioner_id', practitionerIds, params);
  where += inClause('i.client_id', clientIds, params);
  where += inClause('ai2.service_id', serviceIds, params);

  return db.prepare(`
    SELECT i.practitioner_id, i.client_id, ai2.service_id, SUM(ii.line_total) AS invoiced_total
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    JOIN clients c ON c.id = i.client_id
    LEFT JOIN appointment_items ai2 ON ai2.id = ii.appointment_item_id
    WHERE ${where}
    GROUP BY i.practitioner_id, i.client_id, ai2.service_id
  `).all(...params);
}

function bucketKey(groupBy, row) {
  if (groupBy === 'client') return row.client_id ?? 'unassigned';
  if (groupBy === 'service') return row.service_id ?? 'unassigned';
  return row.practitioner_id ?? 'unassigned';
}

function buildReport({ from, to, practitionerIds, clientIds, serviceIds, groupBy }) {
  const bookedRows = queryBooked({ from, to, practitionerIds, clientIds, serviceIds });
  const invoicedRows = queryInvoiced({ from, to, practitionerIds, clientIds, serviceIds });

  const buckets = {};
  const get = key => (buckets[key] ??= { key, hours: 0, travelMin: 0, km: 0, notesMin: 0, booked: 0, invoiced: 0 });

  for (const r of bookedRows) {
    const bucket = get(bucketKey(groupBy, r));
    if (r.status === 'cancelled' && r.late_cancel_billable && r.late_cancel_pct) {
      bucket.booked += r.quantity * r.unit_rate * (r.late_cancel_pct / 100);
      continue; // no hours/travel/km/notes for a fee-only cancellation line
    }
    bucket.hours += r.quantity;
    bucket.booked += (r.billed_quantity ?? r.quantity) * (r.billed_unit_rate ?? r.unit_rate);
    const travelMin = (r.travel_time_to || 0) + (r.travel_time_from || 0);
    if (travelMin) {
      bucket.travelMin += travelMin;
      bucket.booked += (travelMin / 60) * (r.travel_rate_per_hour || r.unit_rate);
    }
    if (r.travel_km && r.km_rate) {
      bucket.km += r.travel_km;
      bucket.booked += r.travel_km * r.km_rate;
    }
    if (r.notes_min) {
      bucket.notesMin += r.notes_min;
      bucket.booked += (r.notes_min / 60) * (r.notes_rate || r.unit_rate);
    }
  }

  for (const r of invoicedRows) {
    const key = groupBy === 'client' ? (r.client_id ?? 'unassigned')
      : groupBy === 'service' ? (r.service_id ?? 'unassigned')
      : (r.practitioner_id ?? 'unassigned');
    get(key).invoiced += r.invoiced_total || 0;
  }

  // For the practitioner view, always show every (active, or filtered) practitioner —
  // a practitioner with zero billing in the period is exactly what this report should surface,
  // not silently omit.
  if (groupBy === 'practitioner') {
    const practs = practitionerIds.length
      ? db.prepare(`SELECT id, first_name, last_name, active, target_amount, target_period FROM practitioners WHERE id IN (${practitionerIds.map(() => '?').join(',')})`).all(...practitionerIds)
      : db.prepare("SELECT id, first_name, last_name, active, target_amount, target_period FROM practitioners WHERE role = 'practitioner' AND active = 1 ORDER BY first_name, last_name").all();

    const range = daysInRange(from, to);
    return practs.map(p => {
      const bucket = buckets[p.id] || { hours: 0, travelMin: 0, km: 0, notesMin: 0, booked: 0, invoiced: 0 };
      const row = {
        key: p.id,
        label: `${p.first_name} ${p.last_name}`,
        hours: bucket.hours, travelMin: bucket.travelMin, km: bucket.km, notesMin: bucket.notesMin,
        booked: bucket.booked, invoiced: bucket.invoiced,
      };
      if (p.target_amount) {
        const periodDays = PERIOD_DAYS[p.target_period] || PERIOD_DAYS.monthly;
        const expectedTarget = p.target_amount * (range / periodDays);
        row.targetAmount = p.target_amount;
        row.targetPeriod = p.target_period;
        row.expectedTarget = expectedTarget;
        row.pctBooked = expectedTarget ? (bucket.booked / expectedTarget) * 100 : null;
        row.pctInvoiced = expectedTarget ? (bucket.invoiced / expectedTarget) * 100 : null;
      }
      return row;
    });
  }

  if (groupBy === 'client') {
    const ids = Object.keys(buckets).filter(k => k !== 'unassigned');
    const clients = ids.length
      ? db.prepare(`SELECT id, first_name, last_name FROM clients WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)
      : [];
    const nameById = Object.fromEntries(clients.map(c => [c.id, `${c.first_name} ${c.last_name}`]));
    return Object.values(buckets).map(b => ({ ...b, label: b.key === 'unassigned' ? 'Unassigned' : (nameById[b.key] || `Client #${b.key}`) }));
  }

  // service
  const ids = Object.keys(buckets).filter(k => k !== 'unassigned');
  const services = ids.length
    ? db.prepare(`SELECT id, name FROM services WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)
    : [];
  const nameById = Object.fromEntries(services.map(s => [s.id, s.name]));
  return Object.values(buckets).map(b => ({ ...b, label: b.key === 'unassigned' ? 'Unassigned' : (nameById[b.key] || `Service #${b.key}`) }));
}

function resolveFilters(req) {
  const { from, to, group_by } = req.query;
  let practitionerIds = parseIds(req.query.practitioner_id);
  // Security: a practitioner can only ever see their own data, regardless of what's requested.
  if (req.user.role === 'practitioner') practitionerIds = [String(req.user.id)];
  const clientIds = parseIds(req.query.client_id);
  const serviceIds = parseIds(req.query.service_id);
  const groupBy = ['service', 'client'].includes(group_by) ? group_by : 'practitioner';
  return { from, to, practitionerIds, clientIds, serviceIds, groupBy };
}

router.get('/billing', auth, (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to are required' });
  const filters = resolveFilters(req);
  res.json({ ...filters, rows: buildReport(filters) });
});

router.get('/billing/csv', auth, (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to are required' });
  const filters = resolveFilters(req);
  const rows = buildReport(filters);

  const headers = ['Name', 'Hours', 'Travel (min)', 'Km', 'Notes (min)', '$ Booked', '$ Invoiced'];
  if (filters.groupBy === 'practitioner') headers.push('Target $', 'Expected (prorated)', '% Booked', '% Invoiced');

  const lines = [headers.join(',')];
  for (const r of rows) {
    const cells = [r.label, r.hours.toFixed(2), Math.round(r.travelMin), r.km.toFixed(1), Math.round(r.notesMin), r.booked.toFixed(2), r.invoiced.toFixed(2)];
    if (filters.groupBy === 'practitioner') {
      cells.push(
        r.targetAmount != null ? r.targetAmount.toFixed(2) : '',
        r.expectedTarget != null ? r.expectedTarget.toFixed(2) : '',
        r.pctBooked != null ? r.pctBooked.toFixed(0) : '',
        r.pctInvoiced != null ? r.pctInvoiced.toFixed(0) : ''
      );
    }
    lines.push(cells.map(csvEscape).join(','));
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="billing-report_${from}_${to}.csv"`);
  res.send(lines.join('\n'));
});

module.exports = router;
