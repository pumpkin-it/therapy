const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');
const audit = require('../services/audit');

const SERIES_SELECT = `
  SELECT rs.*,
    c.first_name || ' ' || c.last_name AS client_name,
    p.first_name || ' ' || p.last_name AS practitioner_name,
    p.color AS practitioner_color,
    l.name AS location_name
  FROM recurring_series rs
  JOIN clients c ON c.id = rs.client_id
  JOIN practitioners p ON p.id = rs.practitioner_id
  LEFT JOIN locations l ON l.id = rs.location_id
`;

const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

const pad = n => String(n).padStart(2, '0');
function localDT(d) {
  if (typeof d === 'string') d = new Date(d);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localDate(d) {
  if (typeof d === 'string') d = new Date(d);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function addInterval(date, freq) {
  const d = new Date(date);
  if (freq === 'weekly')       d.setDate(d.getDate() + 7);
  else if (freq === 'fortnightly') d.setDate(d.getDate() + 14);
  else if (freq === 'every3weeks') d.setDate(d.getDate() + 21);
  else if (freq === 'monthly') d.setMonth(d.getMonth() + 1);
  return localDT(d);
}

function generateForSeries(series, horizon) {
  const items = series.items_json ? JSON.parse(series.items_json) : [];
  const endDate = series.end_type === 'date' && series.end_date ? new Date(series.end_date + 'T23:59') : null;
  const maxOccurrences = series.end_type === 'occurrences' ? series.end_occurrences : null;

  const existingCount = db.prepare("SELECT COUNT(*) as cnt FROM appointments WHERE series_id=? AND status != 'cancelled'").get(series.id).cnt;
  const lastAppt = db.prepare("SELECT start_time FROM appointments WHERE series_id=? AND status != 'cancelled' ORDER BY start_time DESC LIMIT 1").get(series.id);

  // Start from the day after the last generated appointment, or from the series start
  const durMs = new Date(series.end_time) - new Date(series.start_time);
  let st, et;
  if (lastAppt) {
    st = addInterval(lastAppt.start_time, series.freq);
    et = localDT(new Date(new Date(st).getTime() + durMs));
  } else {
    // Adjust start to the correct day_of_week
    const startDt = new Date(series.start_time);
    let diff = series.day_of_week - startDt.getDay();
    if (diff < 0) diff += 7;
    if (diff > 0) startDt.setDate(startDt.getDate() + diff);
    st = `${localDate(startDt)}T${series.start_time.slice(11)}`;
    et = localDT(new Date(new Date(st).getTime() + durMs));
  }

  const insertAppt = db.prepare(`
    INSERT INTO appointments (practitioner_id, client_id, location, location_id, location_other, title, start_time, end_time, notes, status, series_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)
  `);
  const insertItem = db.prepare(`
    INSERT INTO appointment_items (appointment_id, service_id, description, quantity, unit_rate, travel_time_min, travel_time_to, travel_time_from, travel_km, prep_time_min, item_notes, notes_min)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let created = 0;
  let totalCount = existingCount;

  while (true) {
    const stDate = new Date(st);
    if (stDate > horizon) break;
    if (endDate && stDate > endDate) break;
    if (maxOccurrences && totalCount >= maxOccurrences) break;

    if (stDate.getDay() === series.day_of_week) {
      const existing = db.prepare("SELECT id FROM appointments WHERE series_id=? AND start_time=? AND status != 'cancelled'").get(series.id, st);
      if (!existing) {
        const r = insertAppt.run(
          series.practitioner_id, series.client_id, series.location, series.location_id,
          series.location_other, series.title, st, et, series.notes, series.id
        );
        for (const item of items) {
          insertItem.run(r.lastInsertRowid, item.service_id || null, item.description, item.quantity || 1,
            item.unit_rate, item.travel_time_min || null, item.travel_time_to || null, item.travel_time_from || null,
            item.travel_km || null, item.prep_time_min || null, item.item_notes || null, item.notes_min || null);
        }
        created++;
        totalCount++;
      }
    }

    st = addInterval(st, series.freq);
    const durMs = new Date(series.end_time) - new Date(series.start_time);
    et = localDT(new Date(new Date(st).getTime() + durMs));
  }

  if (created > 0) {
    db.prepare('UPDATE recurring_series SET generated_until=? WHERE id=?').run(localDate(horizon), series.id);
  }
  return created;
}

function getHorizon() {
  const h = new Date();
  h.setMonth(h.getMonth() + 2);
  return h;
}

// Generate appointments for all active series
function generateAll() {
  const horizon = getHorizon();
  const active = db.prepare('SELECT * FROM recurring_series WHERE active=1').all();
  let total = 0;
  for (const s of active) {
    total += generateForSeries(s, horizon);
  }
  return total;
}

// List all series
router.get('/', auth, (req, res) => {
  const { active } = req.query;
  const where = active === '0' ? 'WHERE rs.active=0' : active === 'all' ? '' : 'WHERE rs.active=1';
  const rows = db.prepare(`${SERIES_SELECT} ${where} ORDER BY c.first_name, c.last_name`).all();
  // Attach appointment count and next upcoming
  for (const r of rows) {
    r.appointment_count = db.prepare('SELECT COUNT(*) as cnt FROM appointments WHERE series_id=?').get(r.id).cnt;
    r.next_appointment = db.prepare("SELECT start_time FROM appointments WHERE series_id=? AND start_time >= datetime('now') AND status != 'cancelled' ORDER BY start_time LIMIT 1").get(r.id)?.start_time || null;
  }
  res.json(rows);
});

// Get single series with appointments and logs
router.get('/:id', auth, (req, res) => {
  const series = db.prepare(`${SERIES_SELECT} WHERE rs.id=?`).get(req.params.id);
  if (!series) return res.status(404).json({ error: 'Not found' });

  series.appointments = db.prepare(`
    SELECT a.id, a.start_time, a.end_time, a.status, a.notes,
      p.first_name || ' ' || p.last_name AS practitioner_name, p.color AS practitioner_color
    FROM appointments a
    JOIN practitioners p ON p.id = a.practitioner_id
    WHERE a.series_id=? ORDER BY a.start_time ASC
  `).all(req.params.id);

  series.logs = db.prepare('SELECT * FROM recurring_series_logs WHERE series_id=? ORDER BY created_at DESC').all(req.params.id);

  res.json(series);
});

// Create series (called from appointment creation with recurrence)
router.post('/', auth, (req, res) => {
  const { practitioner_id, client_id, location_type, location_id, location_other, title,
    start_time, end_time, notes, items = [], recurrence } = req.body;

  const { freq, endType = 'never', until, occurrences } = recurrence;

  let locationText = '';
  if (location_type === 'home') locationText = 'Home visit';
  else if (location_type === 'clinic') locationText = 'Clinic';
  else if (location_type === 'other') locationText = location_other || 'Other';

  const resolvedLocationId = location_type === 'clinic' && location_id ? Number(location_id) : null;
  const locationOther = location_type === 'other' ? location_other : null;
  const itemsJson = JSON.stringify(items);

  // Determine which days to create series for
  const targetDays = [new Date(start_time).getDay()];

  const insertSeries = db.prepare(`
    INSERT INTO recurring_series (practitioner_id, client_id, location, location_id, location_other, title,
      start_time, end_time, notes, freq, day_of_week, end_type, end_date, end_occurrences, items_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertLog = db.prepare('INSERT INTO recurring_series_logs (series_id, action, details) VALUES (?, ?, ?)');

  const seriesIds = [];
  const horizon = getHorizon();

  for (const day of targetDays) {
    // Adjust start_time to the correct day of week
    const startDt = new Date(start_time);
    let diff = day - startDt.getDay();
    if (diff < 0) diff += 7;
    startDt.setDate(startDt.getDate() + diff);
    const adjStart = localDate(startDt) + 'T' + start_time.slice(11);

    const endDt = new Date(end_time);
    endDt.setDate(endDt.getDate() + diff);
    const adjEnd = localDate(endDt) + 'T' + end_time.slice(11);

    const endTypeDb = until ? 'date' : occurrences ? 'occurrences' : 'never';

    const r = insertSeries.run(
      practitioner_id, client_id, locationText, resolvedLocationId, locationOther, title || null,
      adjStart, adjEnd, notes || null, freq, day, endTypeDb, until || null, occurrences || null, itemsJson
    );

    insertLog.run(r.lastInsertRowid, 'created', `Created ${freq} series on ${DAY_NAMES[day]}s`);
    audit.log('series', r.lastInsertRowid, 'created', `SER-${String(r.lastInsertRowid).padStart(5,'0')} created — ${freq} on ${DAY_NAMES[day]}s`, { ref: `SER-${String(r.lastInsertRowid).padStart(5,'0')}` });
    const series = db.prepare('SELECT * FROM recurring_series WHERE id=?').get(r.lastInsertRowid);
    const generated = generateForSeries(series, horizon);
    // Log creation on each generated appointment
    const genAppts = db.prepare("SELECT id FROM appointments WHERE series_id=? AND status='scheduled'").all(r.lastInsertRowid);
    for (const a of genAppts) {
      audit.log('appointment', a.id, 'created', `APT-${String(a.id).padStart(5,'0')} generated from SER-${String(r.lastInsertRowid).padStart(5,'0')}`, { ref: `APT-${String(a.id).padStart(5,'0')}` });
    }
    seriesIds.push(r.lastInsertRowid);
  }

  res.status(201).json({ seriesIds, count: seriesIds.length });
});

// Edit series — update future appointments
router.patch('/:id', auth, (req, res) => {
  const series = db.prepare('SELECT * FROM recurring_series WHERE id=?').get(req.params.id);
  if (!series) return res.status(404).json({ error: 'Not found' });

  const { practitioner_id, client_id, start_time, end_time, notes, title,
    location_type, location_id, location_other, items, apply_from,
    end_type, end_date, end_occurrences, freq, freq_change_from } = req.body;

  const changes = [];

  if (practitioner_id && practitioner_id !== series.practitioner_id) {
    const oldP = db.prepare('SELECT first_name || \' \' || last_name AS name FROM practitioners WHERE id=?').get(series.practitioner_id);
    const newP = db.prepare('SELECT first_name || \' \' || last_name AS name FROM practitioners WHERE id=?').get(practitioner_id);
    changes.push(`Practitioner: ${oldP?.name} → ${newP?.name}`);
  }
  if (start_time && start_time !== series.start_time) {
    changes.push(`Time: ${series.start_time.slice(11)} → ${start_time.slice(11)}`);
  }

  const FREQ_LABELS = { weekly: 'Weekly', fortnightly: 'Fortnightly', every3weeks: 'Every 3 weeks', monthly: 'Monthly' };

  // Update series record
  const updates = {};
  if (freq && freq !== series.freq) updates.freq = freq;
  if (practitioner_id) updates.practitioner_id = practitioner_id;
  if (client_id) updates.client_id = client_id;
  if (start_time) updates.start_time = start_time;
  if (end_time) updates.end_time = end_time;
  if (notes !== undefined) updates.notes = notes;
  if (title !== undefined) updates.title = title;
  if (items) updates.items_json = JSON.stringify(items);

  if (location_type) {
    if (location_type === 'home') updates.location = 'Home visit';
    else if (location_type === 'clinic') { updates.location = 'Clinic'; updates.location_id = Number(location_id) || null; }
    else { updates.location = location_other || 'Other'; updates.location_other = location_other; }
  }

  // Update day_of_week if start_time date changed
  if (start_time) {
    const newDow = new Date(start_time).getDay();
    if (newDow !== series.day_of_week) {
      updates.day_of_week = newDow;
      changes.push(`Day: ${DAY_NAMES[series.day_of_week]} → ${DAY_NAMES[newDow]}`);
    }
  }

  // Handle end type changes
  if (end_type !== undefined) {
    const oldEndType = series.end_type;
    updates.end_type = end_type;
    updates.end_date = end_type === 'date' ? (end_date || null) : null;
    updates.end_occurrences = end_type === 'occurrences' ? (end_occurrences || null) : null;

    if (end_type === 'date' && end_date) {
      // Cancel all scheduled appointments after the end date
      const cancelled = db.prepare(
        "UPDATE appointments SET status='cancelled' WHERE series_id=? AND start_time > ? AND status='scheduled'"
      ).run(req.params.id, end_date + 'T23:59');
      if (end_date <= new Date().toISOString().slice(0, 10)) {
        updates.active = 0;
      }
      if (cancelled.changes > 0) {
        changes.push(`End date set to ${end_date} — cancelled ${cancelled.changes} appointments after that date`);
      } else {
        changes.push(`End date set to ${end_date}`);
      }
    } else if (end_type === 'occurrences' && end_occurrences) {
      // Cancel excess appointments beyond the occurrence limit
      const allScheduled = db.prepare(
        "SELECT id FROM appointments WHERE series_id=? AND status='scheduled' ORDER BY start_time ASC"
      ).all(req.params.id);
      const totalNonCancelled = db.prepare(
        "SELECT COUNT(*) as cnt FROM appointments WHERE series_id=? AND status != 'cancelled'"
      ).get(req.params.id).cnt;
      if (totalNonCancelled > end_occurrences) {
        const excess = allScheduled.slice(-(totalNonCancelled - end_occurrences));
        for (const a of excess) {
          db.prepare("UPDATE appointments SET status='cancelled' WHERE id=?").run(a.id);
        }
        changes.push(`Occurrence limit set to ${end_occurrences} — cancelled ${excess.length} excess appointments`);
      } else {
        changes.push(`Occurrence limit set to ${end_occurrences}`);
      }
    } else if (end_type === 'never' && oldEndType !== 'never') {
      // Changed to never-ending — generate appointments up to horizon
      changes.push('Changed to never-ending');
    }
  }

  const setClauses = Object.keys(updates).map(k => `${k}=?`).join(', ');
  if (setClauses) {
    db.prepare(`UPDATE recurring_series SET ${setClauses} WHERE id=?`).run(...Object.values(updates), req.params.id);
  }

  // If changed to never-ending, generate new appointments
  if (end_type === 'never' && series.end_type !== 'never') {
    const updatedSeries = db.prepare('SELECT * FROM recurring_series WHERE id=?').get(req.params.id);
    const generated = generateForSeries(updatedSeries, getHorizon());
    if (generated > 0) changes.push(`Generated ${generated} new appointments`);
  }

  // If frequency changed, cancel appointments from the change date and regenerate
  if (freq && freq !== series.freq) {
    const changeFrom = freq_change_from || localDate(new Date());
    const cancelled = db.prepare(
      "UPDATE appointments SET status='cancelled' WHERE series_id=? AND start_time >= ? AND status='scheduled'"
    ).run(req.params.id, changeFrom + 'T00:00');
    changes.push(`Frequency: ${FREQ_LABELS[series.freq] || series.freq} → ${FREQ_LABELS[freq] || freq} from ${changeFrom}. Cancelled ${cancelled.changes} appointments`);

    // Reset generated_until so regeneration starts fresh from the change date
    db.prepare('UPDATE recurring_series SET generated_until=? WHERE id=?').run(
      localDate(new Date(new Date(changeFrom).getTime() - 86400000)), req.params.id
    );
    const updatedSeries = db.prepare('SELECT * FROM recurring_series WHERE id=?').get(req.params.id);
    const generated = generateForSeries(updatedSeries, getHorizon());
    if (generated > 0) changes.push(`Regenerated ${generated} appointments at new frequency`);
  }

  // Update future appointments
  const fromDate = apply_from || localDate(new Date());
  const futureAppts = db.prepare("SELECT id FROM appointments WHERE series_id=? AND start_time >= ? AND status='scheduled'")
    .all(req.params.id, fromDate);

  for (const appt of futureAppts) {
    const apptUpdates = {};
    if (practitioner_id) apptUpdates.practitioner_id = practitioner_id;
    if (client_id) apptUpdates.client_id = client_id;
    if (notes !== undefined) apptUpdates.notes = notes;
    if (title !== undefined) apptUpdates.title = title;
    if (updates.location !== undefined) apptUpdates.location = updates.location;
    if (updates.location_id !== undefined) apptUpdates.location_id = updates.location_id;
    if (updates.location_other !== undefined) apptUpdates.location_other = updates.location_other;

    // For date/time changes, shift each future appointment
    if (start_time || end_time) {
      const existing = db.prepare('SELECT start_time, end_time FROM appointments WHERE id=?').get(appt.id);

      if (start_time) {
        const oldDay = new Date(series.start_time).getDay();
        const newDay = new Date(start_time).getDay();
        const dayShift = newDay - oldDay;
        const newTimeOfDay = start_time.slice(11);
        const oldTimeOfDay = series.start_time.slice(11);

        if (dayShift !== 0 || newTimeOfDay !== oldTimeOfDay) {
          const existDate = new Date(existing.start_time);
          if (dayShift !== 0) existDate.setDate(existDate.getDate() + dayShift);
          apptUpdates.start_time = localDate(existDate) + 'T' + newTimeOfDay;
        }
      }
      if (end_time) {
        const newEndTime = end_time.slice(11);
        const oldEndTime = series.end_time.slice(11);
        const oldDay = new Date(series.start_time).getDay();
        const newDay = start_time ? new Date(start_time).getDay() : oldDay;
        const dayShift = newDay - oldDay;

        if (dayShift !== 0 || newEndTime !== oldEndTime) {
          const existDate = new Date(existing.end_time);
          if (dayShift !== 0) existDate.setDate(existDate.getDate() + dayShift);
          apptUpdates.end_time = localDate(existDate) + 'T' + newEndTime;
        }
      }
    }

    if (Object.keys(apptUpdates).length) {
      const sets = Object.keys(apptUpdates).map(k => `${k}=?`).join(', ');
      db.prepare(`UPDATE appointments SET ${sets} WHERE id=?`).run(...Object.values(apptUpdates), appt.id);
    }

    // Update items if provided
    if (items) {
      db.prepare('DELETE FROM appointment_items WHERE appointment_id=?').run(appt.id);
      const insertItem = db.prepare(`
        INSERT INTO appointment_items (appointment_id, service_id, description, quantity, unit_rate, travel_time_min, travel_time_to, travel_time_from, travel_km, prep_time_min, item_notes, notes_min)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of items) {
        const travelTotal = (item.travel_time_to || 0) + (item.travel_time_from || 0);
        insertItem.run(appt.id, item.service_id || null, item.description, item.quantity || 1,
          item.unit_rate, travelTotal || item.travel_time_min || null,
          item.travel_time_to || null, item.travel_time_from || null,
          item.travel_km || null, item.prep_time_min || null, item.item_notes || null, item.notes_min || null);
      }
    }
  }

  // Log changes
  if (changes.length) {
    const logInsert = db.prepare('INSERT INTO recurring_series_logs (series_id, action, details) VALUES (?, ?, ?)');
    const seriesRef = `SER-${String(req.params.id).padStart(5,'0')}`;
    const detail = `${changes.join('; ')}. Applied to ${futureAppts.length} future appointments from ${fromDate}`;
    logInsert.run(req.params.id, 'updated', detail);
    audit.log('series', Number(req.params.id), 'updated', detail, { ref: seriesRef });
    for (const appt of futureAppts) {
      audit.log('appointment', appt.id, 'updated', `Updated via ${seriesRef}: ${changes.join('; ')}`, { ref: `APT-${String(appt.id).padStart(5,'0')}` });
    }
  }

  res.json(db.prepare(`${SERIES_SELECT} WHERE rs.id=?`).get(req.params.id));
});

// Deactivate series (stop generating)
router.patch('/:id/active', auth, (req, res) => {
  db.prepare('UPDATE recurring_series SET active=? WHERE id=?').run(req.body.active ? 1 : 0, req.params.id);
  const action = req.body.active ? 'reactivated' : 'deactivated';
  db.prepare('INSERT INTO recurring_series_logs (series_id, action, details) VALUES (?, ?, ?)').run(req.params.id, action, `Series ${action}`);
  audit.log('series', Number(req.params.id), action, `SER-${String(req.params.id).padStart(5,'0')} ${action}`, { ref: `SER-${String(req.params.id).padStart(5,'0')}` });
  res.json({ ok: true });
});

// Convert a single appointment into a recurring series
router.post('/from-appointment', auth, (req, res) => {
  const { appointment_id, freq, endType = 'never', until, occurrences } = req.body;

  const appt = db.prepare('SELECT * FROM appointments WHERE id=?').get(appointment_id);
  if (!appt) return res.status(404).json({ error: 'Appointment not found' });
  if (appt.series_id) return res.status(400).json({ error: 'Appointment already belongs to a series' });

  const items = db.prepare('SELECT * FROM appointment_items WHERE appointment_id=?').all(appointment_id);
  const itemsJson = JSON.stringify(items.map(i => ({
    service_id: i.service_id, description: i.description, quantity: i.quantity,
    unit_rate: i.unit_rate, travel_time_min: i.travel_time_min,
    travel_time_to: i.travel_time_to, travel_time_from: i.travel_time_from, travel_km: i.travel_km,
    prep_time_min: i.prep_time_min, item_notes: i.item_notes, notes_min: i.notes_min,
  })));

  const dayOfWeek = new Date(appt.start_time).getDay();
  const endTypeDb = until ? 'date' : occurrences ? 'occurrences' : 'never';

  const r = db.prepare(`
    INSERT INTO recurring_series (practitioner_id, client_id, location, location_id, location_other, title,
      start_time, end_time, notes, freq, day_of_week, end_type, end_date, end_occurrences, items_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    appt.practitioner_id, appt.client_id, appt.location, appt.location_id,
    appt.location_other, appt.title, appt.start_time, appt.end_time,
    appt.notes, freq, dayOfWeek, endTypeDb, until || null, occurrences || null, itemsJson
  );

  // Link the original appointment to the series
  db.prepare('UPDATE appointments SET series_id=? WHERE id=?').run(r.lastInsertRowid, appointment_id);

  db.prepare('INSERT INTO recurring_series_logs (series_id, action, details) VALUES (?, ?, ?)')
    .run(r.lastInsertRowid, 'created', `Converted from appointment #${appointment_id}. ${FREQ_LABEL[freq] || freq} on ${DAY_NAMES[dayOfWeek]}s`);

  // Generate future appointments
  const series = db.prepare('SELECT * FROM recurring_series WHERE id=?').get(r.lastInsertRowid);
  const generated = generateForSeries(series, getHorizon());

  db.prepare('INSERT INTO recurring_series_logs (series_id, action, details) VALUES (?, ?, ?)')
    .run(r.lastInsertRowid, 'generated', `Generated ${generated} appointments`);

  const seriesRef = `SER-${String(r.lastInsertRowid).padStart(5,'0')}`;
  const apptRef = `APT-${String(appointment_id).padStart(5,'0')}`;
  audit.log('series', r.lastInsertRowid, 'created', `${seriesRef} created from ${apptRef} — ${freq} on ${DAY_NAMES[dayOfWeek]}s`, { ref: seriesRef });
  audit.log('appointment', appointment_id, 'converted_to_series', `Converted to recurring series ${seriesRef}`, { ref: apptRef });

  res.status(201).json({ seriesId: r.lastInsertRowid, generated });
});

const FREQ_LABEL = { weekly: 'Weekly', fortnightly: 'Fortnightly', every3weeks: 'Every 3 weeks', monthly: 'Monthly' };

// Manually trigger generation
router.post('/generate', auth, (_req, res) => {
  const count = generateAll();
  res.json({ ok: true, generated: count });
});

module.exports = router;
module.exports.generateAll = generateAll;
