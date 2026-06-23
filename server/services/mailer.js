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
  await graphSend({
    to: toEmail,
    subject: `Invoice ${invoiceNumber}`,
    html: `<p>Please find your invoice <strong>${invoiceNumber}</strong> attached.</p><p>Thank you.</p>`,
    attachments: [{ filename: `${invoiceNumber}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }],
  });
}

// Returns { practitionerError, clientError } — null = success, string = error msg
async function sendAppointmentNotification(apptId, eventType, { throwOnError = false, target = 'both' } = {}) {
  const appt = db.prepare(`
    SELECT a.*,
      c.first_name || ' ' || c.last_name AS client_name,
      c.email AS client_email,
      c.first_name AS client_first_name,
      p.first_name || ' ' || p.last_name AS practitioner_name,
      p.email AS practitioner_email,
      l.name AS location_name
    FROM appointments a
    JOIN clients c ON c.id = a.client_id
    JOIN practitioners p ON p.id = a.practitioner_id
    LEFT JOIN locations l ON l.id = a.location_id
    WHERE a.id = ?
  `).get(apptId);

  if (!appt) {
    const msg = 'Appointment not found';
    if (throwOnError) throw new Error(msg);
    return { practitionerError: msg, clientError: msg };
  }

  const location = appt.location_name || appt.location_other || appt.location || '';
  const verb = { created: 'New appointment', updated: 'Appointment updated', cancelled: 'Appointment cancelled' }[eventType] || 'Appointment update';

  const practitionerHtml = eventType === 'cancelled'
    ? `<p>Hi ${appt.practitioner_name},</p><p>The following appointment has been <strong style="color:#dc2626">cancelled</strong>.</p>${apptTable([['Client', appt.client_name], ['Date', fmt(appt.start_time)]])}`
    : `<p>Hi ${appt.practitioner_name},</p><p>${eventType === 'created' ? 'A new appointment has been scheduled for you.' : 'An appointment has been updated.'}</p>${apptTable([['Client', appt.client_name], ['Start', fmt(appt.start_time)], ['End', fmt(appt.end_time)], ['Location', location], ['Status', appt.status], ['Notes', appt.notes]])}`;

  const clientHtml = eventType === 'cancelled'
    ? `<p>Hi ${appt.client_first_name},</p><p>Your appointment on <strong>${fmt(appt.start_time)}</strong> has been <strong style="color:#dc2626">cancelled</strong>. Please contact us if you have any questions.</p>`
    : `<p>Hi ${appt.client_first_name},</p><p>${eventType === 'created' ? 'Your appointment has been scheduled.' : 'Your appointment details have been updated.'}</p>${apptTable([['Date', fmt(appt.start_time)], ['End time', fmt(appt.end_time)], ['Practitioner', appt.practitioner_name], ['Location', location], ['Notes', appt.notes]])}`;

  const errors = {};

  const trySend = async (to, subject, html, key) => {
    if (!to) { errors[key] = 'No email address on file'; return; }
    try {
      await graphSend({ to, subject: `${verb}: ${fmt(appt.start_time)}`, html });
      errors[key] = null;
    } catch (e) {
      errors[key] = e.message;
      if (!throwOnError) console.error(`${key} email failed:`, e.message);
    }
  };

  if (target === 'both' || target === 'practitioner')
    await trySend(appt.practitioner_email, `${verb}: ${appt.client_name}`, practitionerHtml, 'practitionerError');
  if (target === 'both' || target === 'client')
    await trySend(appt.client_email, `${verb}`, clientHtml, 'clientError');

  if (throwOnError && (errors.practitionerError || errors.clientError)) {
    const msgs = [errors.practitionerError && `Practitioner: ${errors.practitionerError}`, errors.clientError && `Client: ${errors.clientError}`].filter(Boolean);
    throw new Error(msgs.join(' | '));
  }

  return errors;
}

async function sendTestEmail(toEmail) {
  await graphSend({
    to: toEmail,
    subject: 'Therapy App – SMTP Test',
    html: '<p>This is a test email confirming your email settings are working correctly.</p>',
  });
}

async function sendReminderEmail(toEmail, invoiceNumber, total, dueDate) {
  await graphSend({
    to: toEmail,
    subject: `Payment Reminder — Invoice ${invoiceNumber}`,
    html: `<p>This is a friendly reminder that invoice <strong>${invoiceNumber}</strong> for <strong>$${Number(total).toFixed(2)}</strong> was due on <strong>${dueDate}</strong> and remains unpaid.</p><p>Please arrange payment at your earliest convenience.</p><p>Thank you.</p>`,
  });
}

module.exports = { sendInvoiceEmail, sendAppointmentNotification, sendTestEmail, sendReminderEmail, graphSend };
