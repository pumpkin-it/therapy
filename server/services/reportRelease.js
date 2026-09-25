const db = require('../database');
const audit = require('./audit');
const { graphSend, getTemplate, renderTemplate } = require('./mailer');

const parseList = v => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };

// Every non-voided billing entry on a report, oldest first. A voided entry is set to cancelled
// (see billableReports.js), so it no longer counts towards what the client owes.
function getReportInstalments(reportId) {
  return db.prepare(`
    SELECT id, start_time, status, report_progress_pct, myob_exported_at, myob_invoice_number, myob_status, myob_amount_due
    FROM appointments WHERE billable_report_id = ? AND status != 'cancelled'
    ORDER BY start_time, id
  `).all(reportId);
}

// Why a draft-sent report is still locked, or null once it's ready to release. Requires the
// latest entry to be at 100% so a report can't release early just because the first chunks of
// billing happen to be paid before the final hours have been logged.
function releaseBlocker(reportId) {
  const rows = getReportInstalments(reportId);
  if (!rows.length) return 'No hours billed yet';
  if (rows[rows.length - 1].report_progress_pct !== 100) return 'Final hours (100%) not billed yet';
  if (rows.some(r => !r.myob_exported_at)) return 'Not all hours have been sent to accounts';
  if (rows.some(r => !r.myob_invoice_number)) return 'Waiting for MYOB invoice numbers';
  if (rows.some(r => r.myob_status !== 'closed')) return 'Waiting for payment';
  return null;
}

async function sendReleasedEmail(report) {
  const to = parseList(report.notify_to);
  if (!to.length) return false;
  const cc = parseList(report.notify_cc);
  const file = db.prepare(`
    SELECT cf.label, cf.original_name, cfr.view_token
    FROM client_files cf JOIN client_file_reports cfr ON cfr.client_file_id = cf.id WHERE cf.id = ?
  `).get(report.client_file_id);
  const client = db.prepare('SELECT first_name, last_name FROM clients WHERE id = ?').get(report.client_id);
  const practitioner = db.prepare('SELECT first_name, last_name FROM practitioners WHERE id = ?').get(report.practitioner_id);
  const reportTitle = file?.label || file?.original_name || report.title;
  const reportLink = `${process.env.APP_URL || ''}/report/${file?.view_token}`;
  const vars = {
    client_name: client ? `${client.first_name} ${client.last_name}` : '',
    client_first_name: client?.first_name || '',
    practitioner_name: practitioner ? `${practitioner.first_name} ${practitioner.last_name}` : '',
    report_title: reportTitle,
    report_link: reportLink,
  };
  const tpl = getTemplate('report_released');
  await graphSend({
    to, cc: cc.length ? cc : undefined,
    subject: tpl ? renderTemplate(tpl.subject, vars) : `Your ${reportTitle} is ready to download`,
    html: tpl ? renderTemplate(tpl.body, vars) : `<p>Your "${reportTitle}" is ready to download.</p><p><a href="${reportLink}">${reportLink}</a></p>`,
  });
  return true;
}

// Flips the shared file to released (the client's existing link now serves the real original)
// and emails whoever the draft went to. The release itself never depends on the email — if
// sending fails the report is still released and the failure is recorded in the audit log.
async function releaseReport(reportId, { manualBy = null } = {}) {
  const report = db.prepare('SELECT * FROM billable_reports WHERE id = ?').get(reportId);
  if (!report || !report.client_file_id || report.status === 'released') return false;
  const blocker = manualBy ? releaseBlocker(report.id) : null;
  const now = new Date().toISOString();
  db.prepare("UPDATE client_file_reports SET status = 'released', released_at = ? WHERE client_file_id = ?").run(now, report.client_file_id);
  db.prepare("UPDATE billable_reports SET status = 'released', released_at = ? WHERE id = ?").run(now, report.id);
  audit.log('billable_report', report.id, 'released', manualBy
    ? `Report "${report.title}" released manually by ${manualBy}${blocker ? ` before it was ready (${blocker})` : ''}`
    : `Report "${report.title}" released automatically — all linked MYOB invoices paid`);
  audit.log('client_file', report.client_file_id, 'released', `Released "${report.title}" to client${manualBy ? '' : ' (all invoices paid)'}`);
  try {
    const sent = await sendReleasedEmail(report);
    if (sent) audit.log('billable_report', report.id, 'updated', `Emailed client that "${report.title}" is ready to download`);
  } catch (e) {
    console.error('Report release email failed:', e);
    audit.log('billable_report', report.id, 'updated', `Release email for "${report.title}" failed to send: ${e.message}`);
  }
  return true;
}

// Called after anything that could complete a report's payment picture: a MYOB status import,
// invoice numbers being linked (TBSALE or typed in), or the client's draft email going out.
// Pass specific report ids, or none to check every report still waiting.
async function releasePaidReports(reportIds = null) {
  const reports = reportIds
    ? reportIds.length
      ? db.prepare(`SELECT id FROM billable_reports WHERE status = 'draft_sent' AND id IN (${reportIds.map(() => '?').join(',')})`).all(...reportIds)
      : []
    : db.prepare("SELECT id FROM billable_reports WHERE status = 'draft_sent'").all();
  const released = [];
  for (const r of reports) {
    if (releaseBlocker(r.id)) continue;
    if (await releaseReport(r.id)) released.push(r.id);
  }
  return released;
}

// Fire-and-forget wrapper for routes that shouldn't wait on (or fail because of) release emails.
function releasePaidReportsInBackground(reportIds = null) {
  releasePaidReports(reportIds).catch(e => console.error('Report auto-release check failed:', e));
}

module.exports = { getReportInstalments, releaseBlocker, releaseReport, releasePaidReports, releasePaidReportsInBackground };
