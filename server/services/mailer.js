const db = require('../database');

// ─── Graph API token cache ────────────────────────────────────────────────────

let _tokenCache = { token: null, expiresAt: 0 };

async function getGraphToken() {
  const now = Date.now();
  if (_tokenCache.token && now < _tokenCache.expiresAt - 60000) return _tokenCache.token;

  const rows = db.prepare("SELECT key,value FROM settings WHERE key LIKE 'graph_%'").all();
  const cfg = Object.fromEntries(rows.map(r => [r.key, r.value]));
  if (!cfg.graph_tenant_id || !cfg.graph_client_id || !cfg.graph_client_secret) {
    throw new Error('Graph API not configured');
  }

  const url = `https://login.microsoftonline.com/${cfg.graph_tenant_id}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: cfg.graph_client_id,
    client_secret: cfg.graph_client_secret,
    scope: 'https://graph.microsoft.com/.default',
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Token fetch failed');

  _tokenCache = { token: data.access_token, expiresAt: now + data.expires_in * 1000 };
  return _tokenCache.token;
}

async function graphSend({ from, to, subject, html, text, attachments }) {
  const rows = db.prepare("SELECT key,value FROM settings WHERE key LIKE 'graph_%'").all();
  const cfg = Object.fromEntries(rows.map(r => [r.key, r.value]));
  const mailbox = cfg.graph_mailbox;
  if (!mailbox) throw new Error('graph_mailbox not configured');

  const token = await getGraphToken();

  const message = {
    subject,
    body: { contentType: 'HTML', content: html || `<p>${text}</p>` },
    toRecipients: (Array.isArray(to) ? to : [to]).map(addr => ({ emailAddress: { address: addr } })),
    from: { emailAddress: { address: from || mailbox } },
  };

  if (attachments?.length) {
    message.attachments = attachments.map(a => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.filename,
      contentType: a.contentType || 'application/octet-stream',
      contentBytes: Buffer.isBuffer(a.content) ? a.content.toString('base64') : Buffer.from(a.content).toString('base64'),
    }));
  }

  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${mailbox}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Graph API error ${res.status}`);
  }
}

// ─── Template engine ──────────────────────────────────────────────────────────

function renderTemplate(text, vars) {
  if (!text) return '';
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] !== undefined ? vars[k] : `{{${k}}}`);
}

function getTemplate(code) {
  return db.prepare('SELECT * FROM templates WHERE code = ? AND active = 1').get(code);
}

// ─── Email builders ───────────────────────────────────────────────────────────

function fmt(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-AU', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function apptTable(rows) {
  return `<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;margin-top:12px">
    ${rows.map(([label, val]) => val ? `<tr><td style="padding:5px 16px 5px 0;color:#666;white-space:nowrap">${label}</td><td><strong>${val}</strong></td></tr>` : '').join('')}
  </table>`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function sendInvoiceEmail(toEmail, invoiceNumber, pdfBuffer) {
  const tpl = getTemplate('invoice_email');
  const vars = { invoice_number: invoiceNumber };
  const subject = tpl ? renderTemplate(tpl.subject, vars) : `Invoice ${invoiceNumber}`;
  const html = tpl
    ? renderTemplate(tpl.body, vars)
    : `<p>Please find your invoice <strong>${invoiceNumber}</strong> attached.</p><p>Thank you.</p>`;
  await graphSend({
    to: toEmail, subject, html,
    attachments: [{ filename: `${invoiceNumber}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }],
  });
}

const FREQ_LABEL = { weekly: 'Weekly', fortnightly: 'Fortnightly', every3weeks: 'Every 3 weeks', monthly: 'Monthly' };

function fmtTimeOnly(iso) {
  return new Date(iso).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true });
}
function fmtDateOnly(iso) {
  return new Date(iso).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtWeekdayLong(iso) {
  return new Date(iso).toLocaleDateString('en-AU', { weekday: 'long' });
}

// Returns { practitionerError, clientError } — null = success, string = error msg
async function sendAppointmentNotification(apptId, eventType, { throwOnError = false, target = 'both', scope = null } = {}) {
  const appt = db.prepare(`
    SELECT a.*,
      c.first_name || ' ' || c.last_name AS client_name,
      c.email AS client_email,
      c.first_name AS client_first_name,
      p.first_name || ' ' || p.last_name AS practitioner_name,
      p.email AS practitioner_email,
      l.name AS location_name,
      rs.freq AS series_freq,
      rs.start_time AS series_start
    FROM appointments a
    JOIN clients c ON c.id = a.client_id
    JOIN practitioners p ON p.id = a.practitioner_id
    LEFT JOIN locations l ON l.id = a.location_id
    LEFT JOIN recurring_series rs ON rs.id = a.series_id
    WHERE a.id = ?
  `).get(apptId);

  if (!appt) {
    const msg = 'Appointment not found';
    if (throwOnError) throw new Error(msg);
    return { practitionerError: msg, clientError: msg };
  }

  const location = appt.location_name || appt.location_other || appt.location || '';
  const apptDate = fmt(appt.start_time);

  // For update emails, pull the before/after snapshot recorded on the audit log so we
  // can show the old time struck through alongside the new one.
  let before = null;
  if (eventType === 'updated') {
    const row = db.prepare(
      "SELECT snapshot FROM audit_logs WHERE entity_type='appointment' AND entity_id=? AND action='updated' ORDER BY id DESC LIMIT 1"
    ).get(appt.id);
    if (row?.snapshot) {
      try {
        const snap = JSON.parse(row.snapshot);
        if (snap.before_start_time && snap.before_end_time) before = snap;
      } catch {}
    }
  }
  const timeChanged = before && (before.before_start_time !== appt.start_time || before.before_end_time !== appt.end_time);

  const freqText = (startIso, endIso) =>
    `${FREQ_LABEL[appt.series_freq] || appt.series_freq} ${fmtWeekdayLong(startIso)} at ${fmtTimeOnly(startIso)} – ${fmtTimeOnly(endIso)}`;

  // For series updates/cancellations scoped to 'this_only', show just the single datetime.
  // "from <date>" is only shown on the initial creation email — for updates the "Changes
  // starting from" row covers it, and for cancellations it's misleading (the last real
  // appointment may be well before the original series start).
  let dateTimeLabel;
  if (appt.series_freq && scope !== 'this_only') {
    const newFreq = freqText(appt.start_time, appt.end_time);
    if (eventType === 'created') {
      dateTimeLabel = `${newFreq} from ${fmtDateOnly(appt.series_start)}`;
    } else if (eventType === 'updated' && timeChanged) {
      const oldFreq = freqText(before.before_start_time, before.before_end_time);
      dateTimeLabel = `<s style="color:#999">${oldFreq}</s><br>${newFreq}`;
    } else {
      dateTimeLabel = newFreq;
    }
  } else if (eventType === 'updated' && timeChanged) {
    dateTimeLabel = `<s style="color:#999">${fmt(before.before_start_time)}</s><br>${apptDate}`;
  } else {
    dateTimeLabel = apptDate;
  }

  const changesFrom = (eventType === 'updated' && scope === 'future') ? fmtDateOnly(appt.start_time) : null;

  // For a whole-series cancellation, show the last appointment that actually remains
  // (i.e. wasn't itself cancelled) — this can be in the past relative to when the
  // cancellation was processed.
  let lastAppointment = null;
  if (eventType === 'cancelled' && appt.series_id && scope !== 'this_only') {
    const last = db.prepare(
      "SELECT start_time FROM appointments WHERE series_id = ? AND status != 'cancelled' ORDER BY start_time DESC LIMIT 1"
    ).get(appt.series_id);
    lastAppointment = last ? fmtDateOnly(last.start_time) : null;
  }

  const baseVars = {
    client_name:       appt.client_name,
    client_first_name: appt.client_first_name,
    practitioner_name: appt.practitioner_name,
    appointment_date:  apptDate,
    appointment_time:  apptDate,
    location,
    appointment_notes: appt.notes || '',
  };

  const pracTable = eventType === 'cancelled'
    ? apptTable([['Client', appt.client_name], ['Date & time', dateTimeLabel], ['Last appointment', lastAppointment], ['Location', location], ['Notes', appt.notes]])
    : apptTable([['Client', appt.client_name], ['Date & time', dateTimeLabel], ['Changes starting from', changesFrom], ['Location', location], ['Status', appt.status], ['Notes', appt.notes]]);

  const clientTable = eventType === 'cancelled'
    ? apptTable([['Date & time', dateTimeLabel], ['Last appointment', lastAppointment], ['Practitioner', appt.practitioner_name], ['Location', location], ['Notes', appt.notes]])
    : apptTable([['Date & time', dateTimeLabel], ['Changes starting from', changesFrom], ['Practitioner', appt.practitioner_name], ['Location', location], ['Notes', appt.notes]]);

  const buildHtml = (code, fallbackHtml, table) => {
    const tpl = getTemplate(code);
    if (!tpl) return fallbackHtml;
    return renderTemplate(tpl.body, { ...baseVars, appointment_details: table });
  };

  const buildSubject = (code, fallback) => {
    const tpl = getTemplate(code);
    return tpl ? renderTemplate(tpl.subject, baseVars) : fallback;
  };

  const verb = { created: 'New appointment', updated: 'Appointment updated', cancelled: 'Appointment cancelled' }[eventType] || 'Appointment update';

  // Fallback HTML (matches previous hardcoded behaviour)
  const fallbackPracHtml = eventType === 'cancelled'
    ? `<p>Hi ${appt.practitioner_name},</p><p>The following appointment has been <strong style="color:#dc2626">cancelled</strong>.</p>${pracTable}`
    : `<p>Hi ${appt.practitioner_name},</p><p>${eventType === 'created' ? 'A new appointment has been scheduled for you.' : 'An appointment has been updated.'}</p>${pracTable}`;

  const fallbackClientHtml = eventType === 'cancelled'
    ? `<p>Hi ${appt.client_first_name},</p><p>Your appointment on <strong>${apptDate}</strong> has been <strong style="color:#dc2626">cancelled</strong>. Please contact us if you have any questions.</p>`
    : `<p>Hi ${appt.client_first_name},</p><p>${eventType === 'created' ? 'Your appointment has been scheduled.' : 'Your appointment details have been updated.'}</p>${clientTable}`;

  const pracCode    = `appt_${eventType}_practitioner`;
  const clientCode  = `appt_${eventType}_client`;

  const practitionerHtml = buildHtml(pracCode,   fallbackPracHtml,   pracTable);
  const clientHtml       = buildHtml(clientCode,  fallbackClientHtml, clientTable);
  const pracSubject      = buildSubject(pracCode,   `${verb}: ${apptDate}`);
  const clientSubject    = buildSubject(clientCode, `${verb}: ${apptDate}`);

  const errors = {};
  const trySend = async (to, subject, html, key) => {
    if (!to) { errors[key] = 'No email address on file'; return; }
    try {
      await graphSend({ to, subject, html });
      errors[key] = null;
    } catch (e) {
      errors[key] = e.message;
      if (!throwOnError) console.error(`${key} email failed:`, e.message);
    }
  };

  if (target === 'both' || target === 'practitioner')
    await trySend(appt.practitioner_email, pracSubject, practitionerHtml, 'practitionerError');
  if (target === 'both' || target === 'client')
    await trySend(appt.client_email, clientSubject, clientHtml, 'clientError');

  if (throwOnError && (errors.practitionerError || errors.clientError)) {
    const msgs = [errors.practitionerError && `Practitioner: ${errors.practitionerError}`, errors.clientError && `Client: ${errors.clientError}`].filter(Boolean);
    throw new Error(msgs.join(' | '));
  }

  return errors;
}

async function sendTestEmail(toEmail) {
  await graphSend({
    to: toEmail,
    subject: 'Therapy App – Email Test',
    html: '<p>This is a test email confirming your email settings are working correctly.</p>',
  });
}

async function sendReminderEmail(toEmail, invoiceNumber, total, dueDate) {
  const tpl = getTemplate('payment_reminder');
  const vars = { invoice_number: invoiceNumber, invoice_total: Number(total).toFixed(2), due_date: dueDate };
  const subject = tpl ? renderTemplate(tpl.subject, vars) : `Payment Reminder — Invoice ${invoiceNumber}`;
  const html = tpl
    ? renderTemplate(tpl.body, vars)
    : `<p>This is a friendly reminder that invoice <strong>${invoiceNumber}</strong> for <strong>$${Number(total).toFixed(2)}</strong> was due on <strong>${dueDate}</strong> and remains unpaid.</p><p>Please arrange payment at your earliest convenience.</p><p>Thank you.</p>`;
  await graphSend({ to: toEmail, subject, html });
}

module.exports = { sendInvoiceEmail, sendAppointmentNotification, sendTestEmail, sendReminderEmail, graphSend };
