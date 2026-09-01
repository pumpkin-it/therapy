const router = require('express').Router();
const multer = require('multer');
const ExcelJS = require('exceljs');
const db = require('../database');
const auth = require('../middleware/auth');
const audit = require('../services/audit');
const { roundQty, computeApptItemAmounts } = require('../lib/billing');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const FP_JOIN_DIRECT_DATE = `
  LEFT JOIN funding_periods fp_direct ON fp_direct.id = a.funding_period_id
  LEFT JOIN funding_periods fp_date ON a.funding_period_id IS NULL AND fp_date.client_id = a.client_id
    AND (fp_date.start_date IS NULL OR fp_date.start_date = '' OR fp_date.start_date <= DATE(a.start_time))
    AND (fp_date.end_date IS NULL OR fp_date.end_date = '' OR fp_date.end_date >= DATE(a.start_time))
`;

// ─── CSV parsing (hand-rolled: MYOB's TBSALE export has a stray leading "{}"
// line before the real header, and $-prefixed amounts — easier to control here
// than fight a library's assumptions) ─────────────────────────────────────────
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// TBSALE.csv's Invoice No. column is zero-padded (e.g. "00000923"); the invoice-status
// export gives the same number as a plain integer (911). Normalize both to 8 digits so
// they actually match on the myob_invoice_number join key.
function normalizeInvoiceNo(v) {
  const digits = String(v ?? '').trim().replace(/\D/g, '');
  return digits ? digits.padStart(8, '0') : '';
}

function moneyToNumber(v) {
  if (v == null) return 0;
  const n = Number(String(v).replace(/[$,]/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

// clientRef/fundingTypeRef formatting mirrors invoices.js's fmtClientRef/fmtFundingTypeRef
function parseCardId(cardId) {
  const m = String(cardId || '').match(/^C(\d+)(?:-F(\d+))?$/);
  if (!m) return null;
  return { clientId: parseInt(m[1], 10), fundingTypeId: m[2] ? parseInt(m[2], 10) : null };
}

function parseTbsaleRows(text) {
  const rows = parseCsv(text).filter(r => r.some(f => f.trim() !== ''));
  const headerIdx = rows.findIndex(r => r.includes('Invoice No.'));
  if (headerIdx === -1) throw new Error('Could not find header row (expected an "Invoice No." column) — is this a TBSALE export?');
  const headers = rows[headerIdx];
  const col = name => headers.indexOf(name);
  const idx = {
    invoiceNo: col('Invoice No.'), detailDate: col('Detail Date'), amount: col('Amount'),
    cardId: col('Card ID'), note: col('Note'), rate: col('Rate'), hours: col('Hours/Units'),
  };
  for (const [k, v] of Object.entries(idx)) if (v === -1) throw new Error(`TBSALE export is missing an expected column: ${k}`);

  return rows.slice(headerIdx + 1).map(r => ({
    invoiceNo: normalizeInvoiceNo(r[idx.invoiceNo]),
    detailDate: parseDmy(r[idx.detailDate]),
    amount: moneyToNumber(r[idx.amount]),
    cardId: r[idx.cardId]?.trim(),
    note: r[idx.note]?.trim(),
  })).filter(r => r.invoiceNo && r.cardId);
}

function parseDmy(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// ─── Shared: appointment + items + rates, for verifying a candidate's total ──
function getApptWithFundingType(apptId) {
  return db.prepare(`
    SELECT a.*, c.first_name || ' ' || c.last_name AS client_name, ft.id AS funding_type_id
    FROM appointments a
    JOIN clients c ON c.id = a.client_id
    ${FP_JOIN_DIRECT_DATE}
    LEFT JOIN funding_types ft ON ft.name = COALESCE(fp_direct.funding_type, fp_date.funding_type)
    WHERE a.id = ?
  `).get(apptId);
}

function getApptExpectedTotal(appt) {
  const apptDate = appt.start_time ? appt.start_time.slice(0, 10) : null;
  const items = db.prepare(`
    SELECT ai.*, sr.travel_rate_per_hour, sr.km_rate, sr.notes_rate
    FROM appointment_items ai
    LEFT JOIN rate_periods rp ON rp.funding_type_id = ? AND ? BETWEEN rp.start_date AND rp.end_date
    LEFT JOIN service_rates sr ON sr.period_id = rp.id AND sr.service_id = ai.service_id
    WHERE ai.appointment_id = ?
  `).all(appt.funding_type_id, apptDate, appt.id);
  let total = 0;
  for (const item of items) for (const amt of computeApptItemAmounts(item)) total += amt;
  return Math.round(total * 100) / 100;
}

// ─── Step 1: link MYOB invoice numbers from TBSALE.csv ──────────────────────
router.post('/preview-tbsale', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  let rows;
  try { rows = parseTbsaleRows(req.file.buffer.toString('utf8')); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  // Group by Invoice No., then sub-group by (Card ID, Detail Date) — one sub-group
  // is normally one original appointment; a single invoice can cover several.
  const byInvoice = new Map();
  for (const r of rows) {
    if (!byInvoice.has(r.invoiceNo)) byInvoice.set(r.invoiceNo, new Map());
    const subKey = `${r.cardId}|${r.detailDate}`;
    const subGroups = byInvoice.get(r.invoiceNo);
    if (!subGroups.has(subKey)) subGroups.set(subKey, { cardId: r.cardId, detailDate: r.detailDate, amount: 0, notes: [] });
    const g = subGroups.get(subKey);
    g.amount += r.amount;
    g.notes.push(r.note);
  }

  const results = [];
  for (const [invoiceNo, subGroups] of byInvoice) {
    const groupResults = [];
    for (const g of subGroups.values()) {
      const amount = Math.round(g.amount * 100) / 100;
      const parsed = parseCardId(g.cardId);
      let status = 'unmatched', candidates = [], matchedAppointmentId = null;
      if (parsed && g.detailDate) {
        const candidateRows = db.prepare(`
          SELECT id FROM appointments
          WHERE client_id = ? AND DATE(start_time) = ? AND myob_exported_at IS NOT NULL AND myob_invoice_number IS NULL
        `).all(parsed.clientId, g.detailDate);
        candidates = candidateRows.map(c => {
          const appt = getApptWithFundingType(c.id);
          return { id: c.id, client_name: appt?.client_name, expectedTotal: appt ? getApptExpectedTotal(appt) : null };
        });
        const exactMatches = candidates.filter(c => c.expectedTotal != null && Math.abs(c.expectedTotal - amount) < 0.01);
        if (exactMatches.length === 1) { status = 'matched'; matchedAppointmentId = exactMatches[0].id; }
        else if (candidates.length > 0) status = 'ambiguous';
      }
      groupResults.push({ cardId: g.cardId, detailDate: g.detailDate, amount, notes: g.notes, status, matchedAppointmentId, candidates });
    }
    results.push({ invoiceNo, subGroups: groupResults });
  }

  res.json({ invoiceGroups: results });
});

router.post('/apply-tbsale', auth, (req, res) => {
  const { links } = req.body; // [{ appointmentId, invoiceNo }]
  if (!Array.isArray(links) || !links.length) return res.status(400).json({ error: 'No links to apply' });

  const update = db.prepare('UPDATE appointments SET myob_invoice_number = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const l of links) {
      const invoiceNo = normalizeInvoiceNo(l.invoiceNo);
      if (!l.appointmentId || !invoiceNo) continue;
      update.run(invoiceNo, l.appointmentId);
      audit.log('appointment', l.appointmentId, 'myob_invoice_linked', `Linked to MYOB invoice ${invoiceNo}`, {});
    }
  });
  tx();
  res.json({ linked: links.length });
});

// ─── Step 2: update paid/open status from MYOB's invoice-status export ──────
router.post('/preview-status', auth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(req.file.buffer); }
  catch (e) { return res.status(400).json({ error: 'Could not read this as an Excel file: ' + e.message }); }

  const ws = wb.worksheets[0];
  if (!ws) return res.status(400).json({ error: 'Workbook has no sheets' });
  const headerRow = ws.getRow(1).values.map(v => (v == null ? '' : String(v).trim()));
  const col = name => headerRow.indexOf(name);
  const idx = { invoiceNo: col('Invoice No.'), amount: col('Amount'), amtDue: col('Amt Due'), status: col('Status'), customer: col('Customer') };
  for (const k of ['invoiceNo', 'amount', 'amtDue', 'status']) {
    if (idx[k] === -1) return res.status(400).json({ error: `Invoice status file is missing an expected column: ${k}` });
  }

  const results = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const invoiceNo = normalizeInvoiceNo(row.values[idx.invoiceNo]);
    if (!invoiceNo) return;
    const amtDue = Number(row.values[idx.amtDue]) || 0;
    const statusRaw = String(row.values[idx.status] ?? '').trim();
    // "Open" = unpaid (partial or full); "Closed" = fully paid.
    const status = statusRaw.toLowerCase() === 'closed' ? 'closed' : 'open';
    const appts = db.prepare('SELECT id, client_id FROM appointments WHERE myob_invoice_number = ?').all(invoiceNo);
    results.push({
      invoiceNo, customer: idx.customer !== -1 ? row.values[idx.customer] : null,
      amount: Number(row.values[idx.amount]) || 0, amountDue: amtDue, status: statusRaw || null, normalizedStatus: status,
      matchedAppointmentIds: appts.map(a => a.id),
    });
  });

  res.json({ rows: results });
});

router.post('/apply-status', auth, (req, res) => {
  const { updates } = req.body; // [{ invoiceNo, status, amountDue }]
  if (!Array.isArray(updates) || !updates.length) return res.status(400).json({ error: 'No updates to apply' });

  const findAppts = db.prepare('SELECT id FROM appointments WHERE myob_invoice_number = ?');
  const update = db.prepare(`
    UPDATE appointments SET myob_status = ?, myob_amount_due = ?, myob_status_synced_at = CURRENT_TIMESTAMP
    WHERE myob_invoice_number = ?
  `);
  let apptsUpdated = 0;
  const tx = db.transaction(() => {
    for (const u of updates) {
      const invoiceNo = normalizeInvoiceNo(u.invoiceNo);
      if (!invoiceNo) continue;
      const apptIds = findAppts.all(invoiceNo).map(r => r.id);
      update.run(u.status, u.amountDue ?? 0, invoiceNo);
      apptsUpdated += apptIds.length;
      for (const id of apptIds) {
        audit.log('appointment', id, 'myob_status_synced', `MYOB invoice ${invoiceNo} synced: ${u.status}, $${(u.amountDue ?? 0).toFixed(2)} due`, {});
      }
    }
  });
  tx();
  res.json({ invoicesUpdated: updates.length, appointmentsUpdated: apptsUpdated });
});

module.exports = router;
