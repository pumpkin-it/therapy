const router = require('express').Router();
const db = require('../database');

function icalEscape(str) {
  if (!str) return '';
  return str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function toICalDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

router.get('/:token.ics', (req, res) => {
  const prac = db.prepare('SELECT id, first_name, last_name FROM practitioners WHERE cal_token = ? AND active = 1').get(req.params.token);
  if (!prac) return res.status(404).send('Not found');

  const now = new Date();
  const from = new Date(now);
  from.setMonth(from.getMonth() - 3);
  const to = new Date(now);
  to.setMonth(to.getMonth() + 6);

  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  const appointments = db.prepare(`
    SELECT a.id, a.start_time, a.end_time, a.notes, a.status, a.location, a.location_id, a.location_other,
      c.first_name || ' ' || c.last_name AS client_name, c.address AS client_address,
      l.address AS location_address
    FROM appointments a
    JOIN clients c ON c.id = a.client_id
    LEFT JOIN locations l ON l.id = a.location_id
    WHERE a.practitioner_id = ? AND a.status != 'cancelled'
      AND DATE(a.start_time) >= ? AND DATE(a.start_time) <= ?
    ORDER BY a.start_time
  `).all(prac.id, fromStr, toStr);

  const items = appointments.length
    ? db.prepare(`
        SELECT ai.appointment_id, s.name AS service_name
        FROM appointment_items ai
        LEFT JOIN services s ON s.id = ai.service_id
        WHERE ai.appointment_id IN (${appointments.map(() => '?').join(',')})
      `).all(...appointments.map(a => a.id))
    : [];

  const servicesByAppt = {};
  for (const i of items) (servicesByAppt[i.appointment_id] ||= []).push(i.service_name);

  const events = appointments.map(a => {
    const address = a.location_address || a.location_other || a.client_address || a.location || '';
    const services = (servicesByAppt[a.id] || []).filter(Boolean).join(', ');
    const descParts = [];
    if (services) descParts.push(services);
    if (a.notes) descParts.push(a.notes);

    return [
      'BEGIN:VEVENT',
      `UID:apt-${a.id}@therapy.pumpkinit.com.au`,
      `DTSTART;TZID=Australia/Sydney:${toICalDate(a.start_time)}`,
      `DTEND;TZID=Australia/Sydney:${toICalDate(a.end_time)}`,
      `SUMMARY:${icalEscape(a.client_name)}`,
      address ? `LOCATION:${icalEscape(address)}` : null,
      descParts.length ? `DESCRIPTION:${icalEscape(descParts.join('\\n'))}` : null,
      `STATUS:CONFIRMED`,
      'END:VEVENT',
    ].filter(Boolean).join('\r\n');
  });

  const cal = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Therapy//Calendar//EN',
    `X-WR-CALNAME:${icalEscape(prac.first_name + ' ' + prac.last_name + ' — Therapy')}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE',
    'TZID:Australia/Sydney',
    'BEGIN:STANDARD',
    'DTSTART:19700405T030000',
    'RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU',
    'TZOFFSETFROM:+1100',
    'TZOFFSETTO:+1000',
    'TZNAME:AEST',
    'END:STANDARD',
    'BEGIN:DAYLIGHT',
    'DTSTART:19701004T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU',
    'TZOFFSETFROM:+1000',
    'TZOFFSETTO:+1100',
    'TZNAME:AEDT',
    'END:DAYLIGHT',
    'END:VTIMEZONE',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="calendar.ics"');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(cal);
});

module.exports = router;
