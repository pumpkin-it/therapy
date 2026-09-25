const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../database');
const auth = require('../middleware/auth');
const audit = require('../services/audit');
const { graphSend } = require('../services/mailer');
const { roundQty, computeAppointmentTotal } = require('../lib/billing');
const { buildAppointmentsMyobCsv, markAppointmentsExported } = require('../lib/myobExport');
const { createReportShare, ShareError, SHAREABLE_MIME_TYPES, UPLOAD_DIR } = require('../services/reportShare');
const { getReportInstalments, releaseBlocker, releaseReport, releasePaidReportsInBackground } = require('../services/reportRelease');

// Report billing: a practitioner bills a report in chunks as they write it ("5 hrs today, the
// report is now 50% done"). Each chunk is a real completed appointment linked by
// appointments.billable_report_id, emailed to accounts as a MYOB import CSV the moment it's saved,
// then locked. Once the final report is uploaded and the client has the blurred draft link,
// reportRelease.js releases it automatically when every linked MYOB invoice is paid.

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const isAdmin = user => ['owner', 'admin'].includes(user.role);
// Invoice numbers and voids are accounts work, same people who run MYOB Sync.
const isAccounts = user => ['owner', 'admin', 'finance'].includes(user.role);
// Practitioners bill and upload only their own reports; owner/admin can act on any.
const canManage = (user, report) => isAdmin(user) || report.practitioner_id === user.id;

// MYOB reads the import CSV as Mac Roman, not UTF-8, so any typographic character in the invoice
// note (an em dash, or curly quotes/dashes pasted into a report title from Word) comes out garbled
// on the invoice — e.g. "—" becomes "‚Äî". Keep the note to plain ASCII punctuation.
const plainText = s => String(s)
  .replace(/[\u2012-\u2015\u2212]/g, '-')
  .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
  .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
  .replace(/\u2026/g, '...')
  .replace(/[\u00A0\u2007\u202F]/g, ' ');

const aptRef = id => `APT-${String(id).padStart(5, '0')}`;
const localToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });

// MYOB's status export gives invoice numbers as plain integers, TBSALE as 8-digit zero-padded —
// myobSync.js stores the padded form, so a typed-in number must match it exactly.
const normalizeInvoiceNo = v => {
  const digits = String(v ?? '').trim().replace(/\D/g, '');
  return digits ? digits.padStart(8, '0') : null;
};

function getReport(id) {
  return db.prepare('SELECT * FROM billable_reports WHERE id = ?').get(id);
}

// Funding type for the report's funding period, then that service's rate on the entry's date —
// the same funding-period → funding type → rate period → service rate chain the export uses.
function resolveRate(report, date) {
  const fp = report.funding_period_id
    ? db.prepare('SELECT funding_type FROM funding_periods WHERE id = ?').get(report.funding_period_id)
    : null;
  const ft = fp ? db.prepare('SELECT id FROM funding_types WHERE name = ?').get(fp.funding_type) : null;
  if (!ft) return null;
  const row = db.prepare(`
    SELECT sr.rate FROM service_rates sr
    JOIN rate_periods rp ON rp.id = sr.period_id
    WHERE rp.funding_type_id = ? AND ? BETWEEN rp.start_date AND rp.end_date AND sr.service_id = ?
  `).get(ft.id, date, report.service_id);
  return row ? Number(row.rate) : null;
}

function reportWithDetails(report) {
  const extra = db.prepare(`
    SELECT c.first_name || ' ' || c.last_name AS client_name,
      p.first_name || ' ' || p.last_name AS practitioner_name,
      s.name AS service_name, s.unit AS service_unit,
      fp.funding_type AS funding_type
    FROM billable_reports br
    JOIN clients c ON c.id = br.client_id
    JOIN practitioners p ON p.id = br.practitioner_id
    JOIN services s ON s.id = br.service_id
    LEFT JOIN funding_periods fp ON fp.id = br.funding_period_id
    WHERE br.id = ?
  `).get(report.id);
  const entries = db.prepare(`
    SELECT a.id, a.start_time, a.status, a.report_progress_pct, a.myob_exported_at, a.myob_invoice_number,
      a.myob_status, a.myob_amount_due, ai.quantity AS hours, ai.unit_rate
    FROM appointments a
    LEFT JOIN appointment_items ai ON ai.appointment_id = a.id
    WHERE a.billable_report_id = ?
    ORDER BY a.start_time, a.id
  `).all(report.id).map(e => ({ ...e, ref: aptRef(e.id), amount: computeAppointmentTotal(e.id), voided: e.status === 'cancelled' }));
  const file = report.client_file_id ? db.prepare(`
    SELECT cf.id, cf.label, cf.original_name, cf.mime_type, cf.created_at,
      cfr.status AS report_status, cfr.view_token AS report_view_token, cfr.released_at AS report_released_at,
      cfr.visible_pages AS report_visible_pages, cfr.page_count AS report_page_count
    FROM client_files cf LEFT JOIN client_file_reports cfr ON cfr.client_file_id = cf.id
    WHERE cf.id = ?
  `).get(report.client_file_id) : null;
  const live = entries.filter(e => !e.voided);
  return {
    ...report, ...extra, entries, file,
    notify_to: JSON.parse(report.notify_to || '[]'), notify_cc: JSON.parse(report.notify_cc || '[]'),
    progress_pct: live.length ? live[live.length - 1].report_progress_pct : 0,
    total_hours: live.reduce((s, e) => s + (e.hours || 0), 0),
    total_amount: live.reduce((s, e) => s + e.amount, 0),
    release_blocker: report.status === 'released' ? null : releaseBlocker(report.id),
  };
}

// Builds this one entry's MYOB CSV and emails it to accounts. Only marks the entry exported once
// the email has actually gone — if it fails, the entry stays unexported, keeps showing in the
// Invoices page's normal "not yet exported" list, and can be resent from the report.
async function sendEntryToAccounts(apptId, report) {
  const accounts = (db.prepare("SELECT value FROM settings WHERE key = 'accounts_email'").get()?.value || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (!accounts.length) throw new Error('No accounts email is set in Settings');

  const invDate = localToday();
  const { csv, exportedAppts } = buildAppointmentsMyobCsv([apptId], invDate);
  if (!exportedAppts.length) throw new Error('Nothing billable to export for this entry');

  const d = reportWithDetails(report);
  const entry = d.entries.find(e => e.id === apptId);
  const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const row = (k, v) => `<tr><td style="padding:3px 12px 3px 0;color:#666">${k}</td><td style="padding:3px 0">${esc(v)}</td></tr>`;
  await graphSend({
    to: accounts,
    subject: `Report billing for MYOB — ${d.client_name} — ${d.title} (${entry.report_progress_pct}%)`,
    html: `<p>New report billing to invoice in MYOB. The import file is attached.</p>
      <table style="font-family:sans-serif;font-size:14px;border-collapse:collapse">
        ${row('Client', d.client_name)}${row('Practitioner', d.practitioner_name)}${row('Report', d.title)}
        ${row('Service date', entry.start_time.slice(0, 10).split('-').reverse().join('/'))}
        ${row('Hours', Number(entry.hours).toFixed(2))}${row('Amount', `$${entry.amount.toFixed(2)}`)}
        ${row('Report progress', `${entry.report_progress_pct}% complete`)}${row('Reference', entry.ref)}
      </table>
      <p>The report is released to the client automatically once every invoice for it shows as paid in the MYOB status import.</p>`,
    attachments: [{ filename: `MYOB_Import_Report_${entry.ref}_${invDate}.csv`, content: csv, contentType: 'text/csv' }],
  });
  markAppointmentsExported(exportedAppts, 'report billing, emailed to accounts');
}

router.get('/', auth, (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  const reports = db.prepare('SELECT * FROM billable_reports WHERE client_id = ? ORDER BY created_at DESC').all(client_id);
  res.json(reports.map(reportWithDetails));
});

router.post('/', auth, (req, res) => {
  const { client_id, funding_period_id, service_id, title } = req.body;
  if (!client_id || !service_id || !title?.trim()) return res.status(400).json({ error: 'Client, service and title are required' });
  if (!funding_period_id) return res.status(400).json({ error: 'Choose which funding this report is billed to' });
  // Practitioners always create reports as themselves; owner/admin can raise one for anyone.
  const practitionerId = isAdmin(req.user) && req.body.practitioner_id ? Number(req.body.practitioner_id) : req.user.id;
  const r = db.prepare(`
    INSERT INTO billable_reports (client_id, practitioner_id, funding_period_id, service_id, title, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(client_id, practitionerId, funding_period_id, service_id, title.trim(), req.user.id);
  audit.log('billable_report', r.lastInsertRowid, 'created', `Started report "${title.trim()}"`);
  res.status(201).json(reportWithDetails(getReport(r.lastInsertRowid)));
});

router.patch('/:id', auth, (req, res) => {
  const report = getReport(req.params.id);
  if (!report) return res.status(404).json({ error: 'Not found' });
  if (!canManage(req.user, report)) return res.status(403).json({ error: 'You can only edit your own reports' });
  const title = req.body.title?.trim();
  if (!title) return res.status(400).json({ error: 'Title is required' });
  db.prepare('UPDATE billable_reports SET title = ? WHERE id = ?').run(title, report.id);
  if (title !== report.title) audit.log('billable_report', report.id, 'updated', `Renamed report "${report.title}" → "${title}"`);
  res.json(reportWithDetails(getReport(report.id)));
});

// Only a report with nothing billed can be deleted — once anything has gone to accounts, the
// entries are real invoices and have to be voided instead.
router.delete('/:id', auth, (req, res) => {
  const report = getReport(req.params.id);
  if (!report) return res.status(404).json({ error: 'Not found' });
  if (!canManage(req.user, report)) return res.status(403).json({ error: 'You can only delete your own reports' });
  const count = db.prepare('SELECT COUNT(*) AS c FROM appointments WHERE billable_report_id = ?').get(report.id).c;
  if (count) return res.status(409).json({ error: 'This report already has billed hours, so it can’t be deleted.' });
  db.prepare('DELETE FROM billable_reports WHERE id = ?').run(report.id);
  audit.log('billable_report', report.id, 'deleted', `Deleted report "${report.title}"`);
  res.status(204).send();
});

router.post('/:id/entries', auth, async (req, res) => {
  const report = getReport(req.params.id);
  if (!report) return res.status(404).json({ error: 'Not found' });
  if (!canManage(req.user, report)) return res.status(403).json({ error: 'You can only bill your own reports' });
  if (report.status === 'released') return res.status(400).json({ error: 'This report has already been released.' });

  const date = req.body.service_date;
  const hours = roundQty(Number(req.body.hours));
  const pct = Number(req.body.progress_pct);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ error: 'Enter the service date' });
  if (date > localToday()) return res.status(400).json({ error: 'Only bill hours already worked — the service date can’t be in the future.' });
  if (!(hours > 0 && hours <= 24)) return res.status(400).json({ error: 'Enter the hours worked (more than 0, up to 24)' });
  if (!Number.isInteger(pct) || pct < 1 || pct > 100) return res.status(400).json({ error: 'Enter how complete the report is now, from 1 to 100%' });
  const live = getReportInstalments(report.id);
  const lastPct = live.length ? live[live.length - 1].report_progress_pct : 0;
  if (pct < lastPct) return res.status(400).json({ error: `The report was already ${lastPct}% complete — enter the new total, not this entry's share.` });
  if (lastPct === 100) return res.status(400).json({ error: 'This report is already at 100%.' });
  const accounts = db.prepare("SELECT value FROM settings WHERE key = 'accounts_email'").get()?.value?.trim();
  if (!accounts) return res.status(400).json({ error: 'No accounts email is set up yet. Ask an admin to add one in Settings.' });

  const rate = resolveRate(report, date);
  if (rate == null) return res.status(400).json({ error: 'This service has no rate under the client’s funding on that date.' });
  const service = db.prepare('SELECT name FROM services WHERE id = ?').get(report.service_id);

  // Entered as a 9am block of the hours worked — only for the record, these never appear on the
  // calendar. The invoice note carries the progress onto the MYOB line.
  const minutes = Math.round(hours * 60);
  const start = `${date}T09:00`;
  const endDate = new Date(`${date}T09:00:00`); endDate.setMinutes(endDate.getMinutes() + minutes);
  const pad = n => String(n).padStart(2, '0');
  const end = `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}T${pad(endDate.getHours())}:${pad(endDate.getMinutes())}`;

  const apptId = db.transaction(() => {
    const a = db.prepare(`
      INSERT INTO appointments (practitioner_id, client_id, title, start_time, end_time, status, funding_period_id, billable_report_id, report_progress_pct)
      VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?)
    `).run(report.practitioner_id, report.client_id, `Report: ${report.title}`, start, end, report.funding_period_id, report.id, pct);
    db.prepare(`
      INSERT INTO appointment_items (appointment_id, service_id, description, quantity, unit_rate, item_notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(a.lastInsertRowid, report.service_id, service?.name || 'Report writing', hours, rate, plainText(`Report: ${report.title} - ${pct}% complete`));
    return a.lastInsertRowid;
  })();
  audit.log('appointment', apptId, 'created', `${aptRef(apptId)} billed ${hours} hrs on report "${report.title}" (${pct}% complete)`, { ref: aptRef(apptId) });
  audit.log('billable_report', report.id, 'updated', `Billed ${hours} hrs on ${date} — ${pct}% complete (${aptRef(apptId)})`);

  let sendError = null;
  try { await sendEntryToAccounts(apptId, report); }
  catch (e) {
    sendError = e.message || 'Failed to email accounts';
    audit.log('billable_report', report.id, 'updated', `${aptRef(apptId)} could not be emailed to accounts: ${sendError}`);
  }
  res.status(201).json({ report: reportWithDetails(getReport(report.id)), sendError });
});

router.post('/:id/entries/:apptId/resend', auth, async (req, res) => {
  const report = getReport(req.params.id);
  if (!report) return res.status(404).json({ error: 'Not found' });
  if (!canManage(req.user, report) && !isAccounts(req.user)) return res.status(403).json({ error: 'Not allowed' });
  const appt = db.prepare("SELECT * FROM appointments WHERE id = ? AND billable_report_id = ? AND status != 'cancelled'").get(req.params.apptId, report.id);
  if (!appt) return res.status(404).json({ error: 'Not found' });
  if (appt.myob_exported_at) return res.status(400).json({ error: 'This entry has already been sent to accounts.' });
  try { await sendEntryToAccounts(appt.id, report); }
  catch (e) { return res.status(400).json({ error: e.message || 'Failed to email accounts' }); }
  audit.log('billable_report', report.id, 'updated', `${aptRef(appt.id)} emailed to accounts`);
  res.json(reportWithDetails(getReport(report.id)));
});

router.patch('/:id/entries/:apptId/invoice-number', auth, (req, res) => {
  if (!isAccounts(req.user)) return res.status(403).json({ error: 'Only admin or finance can link MYOB invoices' });
  const report = getReport(req.params.id);
  if (!report) return res.status(404).json({ error: 'Not found' });
  const appt = db.prepare('SELECT * FROM appointments WHERE id = ? AND billable_report_id = ?').get(req.params.apptId, report.id);
  if (!appt) return res.status(404).json({ error: 'Not found' });
  const invoiceNo = req.body.invoice_no ? normalizeInvoiceNo(req.body.invoice_no) : null;
  if (req.body.invoice_no && !invoiceNo) return res.status(400).json({ error: 'Enter the MYOB invoice number (digits only)' });
  // A different number means any previously synced paid/open status belonged to the old invoice.
  db.prepare(`UPDATE appointments SET myob_invoice_number = ?,
      myob_status = CASE WHEN IFNULL(myob_invoice_number,'') = IFNULL(?,'') THEN myob_status END,
      myob_amount_due = CASE WHEN IFNULL(myob_invoice_number,'') = IFNULL(?,'') THEN myob_amount_due END
    WHERE id = ?`).run(invoiceNo, invoiceNo, invoiceNo, appt.id);
  audit.log('appointment', appt.id, 'myob_invoice_linked', invoiceNo ? `Linked to MYOB invoice ${invoiceNo} (entered manually)` : 'MYOB invoice link cleared', { ref: aptRef(appt.id) });
  releasePaidReportsInBackground([report.id]);
  res.json(reportWithDetails(getReport(report.id)));
});

// Undoes an entry that was billed by mistake — the money side is fixed with a credit note in
// MYOB; this just stops the entry counting towards the report, the client's spend and release.
router.post('/:id/entries/:apptId/void', auth, (req, res) => {
  const report = getReport(req.params.id);
  if (!report) return res.status(404).json({ error: 'Not found' });
  if (!isAccounts(req.user)) return res.status(403).json({ error: 'Only admin or finance can void billed hours' });
  const appt = db.prepare("SELECT * FROM appointments WHERE id = ? AND billable_report_id = ? AND status != 'cancelled'").get(req.params.apptId, report.id);
  if (!appt) return res.status(404).json({ error: 'Not found' });
  const reason = req.body.reason?.trim();
  if (!reason) return res.status(400).json({ error: 'Enter a reason for voiding' });
  db.prepare("UPDATE appointments SET status = 'cancelled', late_cancel_billable = 0, exclude_from_budget = 1 WHERE id = ?").run(appt.id);
  audit.log('appointment', appt.id, 'voided', `${aptRef(appt.id)} voided on report "${report.title}": ${reason}`, { ref: aptRef(appt.id) });
  audit.log('billable_report', report.id, 'updated', `Voided ${aptRef(appt.id)}: ${reason}`);
  releasePaidReportsInBackground([report.id]);
  res.json(reportWithDetails(getReport(report.id)));
});

// Uploads the finished report into the client's Files and shares it as a blurred draft. Replacing
// an earlier upload keeps the old file in Files but stops sharing it, so the client's new link is
// the only live one. The client isn't emailed here — the practitioner reviews that email first.
router.post('/:id/upload', auth, (req, res, next) => {
  upload.single('file')(req, res, err => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File is too large — the maximum upload size is 20MB.' });
    if (err) return res.status(400).json({ error: err.message || 'Failed to upload file' });
    next();
  });
}, async (req, res) => {
  const cleanup = () => { if (req.file) try { fs.unlinkSync(path.join(UPLOAD_DIR, req.file.filename)); } catch {} };
  const report = getReport(req.params.id);
  if (!report) { cleanup(); return res.status(404).json({ error: 'Not found' }); }
  if (!canManage(req.user, report)) { cleanup(); return res.status(403).json({ error: 'You can only upload to your own reports' }); }
  if (report.status === 'released') { cleanup(); return res.status(400).json({ error: 'This report has already been released.' }); }
  if (!req.file) return res.status(400).json({ error: 'No file' });
  if (!SHAREABLE_MIME_TYPES.includes(req.file.mimetype)) { cleanup(); return res.status(400).json({ error: 'Upload the report as a PDF (or JPG/PNG).' }); }

  const ins = db.prepare(`
    INSERT INTO client_files (client_id, filename, original_name, size, mime_type, label)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(report.client_id, req.file.filename, req.file.originalname, req.file.size, req.file.mimetype, report.title);
  const file = db.prepare('SELECT * FROM client_files WHERE id = ?').get(ins.lastInsertRowid);
  try {
    // Same 0–10 "pages shown in full" choice as sharing from the Files tab; defaults to 1.
    await createReportShare(file, req.body.visible_pages ?? 1);
  } catch (e) {
    db.prepare('DELETE FROM client_files WHERE id = ?').run(file.id);
    cleanup();
    if (e instanceof ShareError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
  audit.log('client_file', file.id, 'uploaded', `Uploaded "${req.file.originalname}" for report "${report.title}" and shared as a draft`);

  if (report.client_file_id) {
    const old = db.prepare('SELECT * FROM client_file_reports WHERE client_file_id = ?').get(report.client_file_id);
    if (old) {
      try { fs.unlinkSync(path.join(UPLOAD_DIR, old.preview_filename)); } catch {}
      db.prepare('DELETE FROM client_file_reports WHERE client_file_id = ?').run(report.client_file_id);
      audit.log('client_file', report.client_file_id, 'updated', `Stopped sharing — replaced by a newer upload for report "${report.title}"`);
    }
  }
  // A replacement needs the client told about the new link again, so it goes back to 'uploaded'.
  db.prepare("UPDATE billable_reports SET client_file_id = ?, status = 'uploaded' WHERE id = ?").run(file.id, report.id);
  audit.log('billable_report', report.id, 'updated', `${report.client_file_id ? 'Replaced' : 'Uploaded'} the report file`);
  res.status(201).json(reportWithDetails(getReport(report.id)));
});

router.post('/:id/release', auth, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Only an admin can release a report before it’s paid' });
  const report = getReport(req.params.id);
  if (!report) return res.status(404).json({ error: 'Not found' });
  if (!report.client_file_id) return res.status(400).json({ error: 'Upload the report first.' });
  if (report.status === 'released') return res.status(400).json({ error: 'Already released.' });
  const who = db.prepare('SELECT first_name, last_name FROM practitioners WHERE id = ?').get(req.user.id);
  await releaseReport(report.id, { manualBy: who ? `${who.first_name} ${who.last_name}` : `user ${req.user.id}` });
  res.json(reportWithDetails(getReport(report.id)));
});

module.exports = router;
