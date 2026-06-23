const db = require('../database');

async function sendPushToTokens(tokens, { title, body, data }) {
  if (!tokens.length) return;

  const messages = tokens.map(t => ({
    to: t,
    sound: 'default',
    title,
    body,
    data: data || {},
  }));

  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });
    const result = await res.json();
    return result;
  } catch (e) {
    console.error('Push send failed:', e.message);
  }
}

async function notifyPractitioner(practitionerId, { title, body, data }) {
  const rows = db.prepare('SELECT token FROM push_tokens WHERE practitioner_id = ?').all(practitionerId);
  if (!rows.length) return;
  return sendPushToTokens(rows.map(r => r.token), { title, body, data });
}

async function notifyAppointmentChange(appointmentId, action) {
  const appt = db.prepare(`
    SELECT a.*, c.first_name || ' ' || c.last_name AS client_name
    FROM appointments a JOIN clients c ON c.id = a.client_id
    WHERE a.id = ?
  `).get(appointmentId);
  if (!appt) return;

  const time = appt.start_time ? new Date(appt.start_time).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }) : '';
  const date = appt.start_time ? new Date(appt.start_time).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '';

  const messages = {
    created: { title: 'New Appointment', body: `${appt.client_name} — ${date} at ${time}` },
    updated: { title: 'Appointment Updated', body: `${appt.client_name} — ${date} at ${time}` },
    cancelled: { title: 'Appointment Cancelled', body: `${appt.client_name} — ${date} at ${time}` },
  };

  const msg = messages[action] || messages.updated;
  return notifyPractitioner(appt.practitioner_id, { ...msg, data: { appointmentId, action } });
}

module.exports = { sendPushToTokens, notifyPractitioner, notifyAppointmentChange };
