const ical = require('node-ical');
const db = require('../database');

// How far around "now" to pull busy time from an external calendar. Past buffer is small (just
// enough to cover an event that started yesterday and runs past midnight); future is generous
// since the whole point is catching meetings booked well ahead of the therapy schedule.
const WINDOW_PAST_DAYS = 1;
const WINDOW_FUTURE_DAYS = 180;

// Expands whatever node-ical returns for one calendar into a flat list of concrete busy periods
// within the sync window. Recurring events (VEVENT with an RRULE) come back from node-ical with
// a `.rrule` (an rrule.js instance) on the base event, plus already-parsed standalone VEVENT
// entries for any individually-edited occurrence (a normal exception, no `.rrule` of its own) —
// so recurrence expansion only needs to handle the `.rrule` case; anything else is already a
// concrete event.
function expandOccurrences(calendarData, windowStart, windowEnd) {
  const occurrences = [];
  for (const key of Object.keys(calendarData)) {
    const ev = calendarData[key];
    if (ev.type !== 'VEVENT' || !ev.start || !ev.end) continue;
    const summary = (ev.summary && String(ev.summary).trim()) || 'Busy (synced)';

    if (ev.rrule) {
      const durationMs = ev.end.getTime() - ev.start.getTime();
      const exceptionDates = new Set(
        Object.values(ev.exdate || {}).map(d => d.toISOString().slice(0, 10))
      );
      const overriddenDates = new Set(
        Object.keys(ev.recurrences || {}).map(d => new Date(d).toISOString().slice(0, 10))
      );
      for (const occStart of ev.rrule.between(windowStart, windowEnd, true)) {
        const dateKey = occStart.toISOString().slice(0, 10);
        // Exceptions/overrides are already represented as their own standalone VEVENT (picked
        // up by the non-rrule branch below) — skip here to avoid a duplicate block.
        if (exceptionDates.has(dateKey) || overriddenDates.has(dateKey)) continue;
        occurrences.push({
          uid: `${ev.uid}::${occStart.toISOString()}`,
          start: occStart,
          end: new Date(occStart.getTime() + durationMs),
          summary,
        });
      }
    } else {
      if (ev.end < windowStart || ev.start > windowEnd) continue;
      occurrences.push({ uid: ev.uid, start: ev.start, end: ev.end, summary });
    }
  }
  return occurrences;
}

// Fetches, parses, and diffs one practitioner's external calendar into practitioner_time_blocks.
// Never touches manually-created blocks (source IS NULL) — only rows this same sync previously
// wrote (source = 'external_sync'), matched by external_uid, so it's safe to run repeatedly:
// unchanged events are left alone, changed ones are updated in place, removed ones are deleted,
// new ones are inserted.
async function syncPractitionerCalendar(practitionerId) {
  const practitioner = db.prepare('SELECT * FROM practitioners WHERE id = ?').get(practitionerId);
  if (!practitioner || !practitioner.external_cal_url) return { skipped: true };

  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_PAST_DAYS * 86400000);
  const windowEnd = new Date(now.getTime() + WINDOW_FUTURE_DAYS * 86400000);

  let calendarData;
  try {
    calendarData = await ical.async.fromURL(practitioner.external_cal_url);
  } catch (e) {
    db.prepare('UPDATE practitioners SET external_cal_error = ? WHERE id = ?')
      .run(e.message || 'Failed to fetch calendar', practitionerId);
    throw e;
  }

  const occurrences = expandOccurrences(calendarData, windowStart, windowEnd);
  const existing = db.prepare(
    `SELECT id, external_uid FROM practitioner_time_blocks WHERE practitioner_id = ? AND source = 'external_sync'`
  ).all(practitionerId);
  const existingByUid = new Map(existing.map(r => [r.external_uid, r.id]));
  const seenUids = new Set();

  const insert = db.prepare(`
    INSERT INTO practitioner_time_blocks (practitioner_id, start_time, end_time, reason, source, external_uid, created_by)
    VALUES (?, ?, ?, ?, 'external_sync', ?, NULL)
  `);
  const update = db.prepare(`UPDATE practitioner_time_blocks SET start_time = ?, end_time = ?, reason = ? WHERE id = ?`);
  const remove = db.prepare(`DELETE FROM practitioner_time_blocks WHERE id = ?`);

  let created = 0, updated = 0, removed = 0;
  const apply = db.transaction(() => {
    for (const occ of occurrences) {
      seenUids.add(occ.uid);
      const startIso = occ.start.toISOString();
      const endIso = occ.end.toISOString();
      const existingId = existingByUid.get(occ.uid);
      if (existingId) {
        update.run(startIso, endIso, occ.summary, existingId);
        updated++;
      } else {
        insert.run(practitionerId, startIso, endIso, occ.summary, occ.uid);
        created++;
      }
    }
    for (const row of existing) {
      if (!seenUids.has(row.external_uid)) {
        remove.run(row.id);
        removed++;
      }
    }
    db.prepare('UPDATE practitioners SET external_cal_synced_at = ?, external_cal_error = NULL WHERE id = ?')
      .run(new Date().toISOString(), practitionerId);
  });
  apply();

  return { created, updated, removed, total: occurrences.length };
}

// Called from the scheduler — every practitioner with a URL on file, one at a time, each
// failure isolated so one broken/expired link doesn't stop everyone else's sync.
async function syncAllPractitionerCalendars() {
  const practitioners = db.prepare(
    `SELECT id FROM practitioners WHERE external_cal_url IS NOT NULL AND external_cal_url != '' AND active = 1`
  ).all();
  let synced = 0, failed = 0;
  for (const { id } of practitioners) {
    try {
      await syncPractitionerCalendar(id);
      synced++;
    } catch (e) {
      failed++;
      console.error(`Calendar sync failed for practitioner ${id}:`, e.message);
    }
  }
  return { checked: practitioners.length, synced, failed };
}

module.exports = { syncPractitionerCalendar, syncAllPractitionerCalendars };
