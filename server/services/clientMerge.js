// Merging a duplicate client record into the one being kept.
//
// Everything attached to the duplicate — appointments, invoices, notes, files and folders, forms,
// reports, agreements, budgets, funding periods, recurring series, contacts and filed emails — moves
// to the kept client. The kept client's own details are not changed. The duplicate stays in the
// database, marked merged_into the kept client (and inactive), so it drops out of lists, pickers and
// email suggestions; its old links and portal link lead to the kept client. Every moved row is
// recorded in client_merges, so undo() can move exactly those rows back.
const db = require('../database');
const audit = require('./audit');
const contacts = require('./clientContacts');

// Tables whose rows simply move to the kept client.
const SIMPLE_TABLES = [
  ['appointments', 'appointment'], ['invoices', 'invoice'], ['session_notes', 'session note'], ['client_files', 'file'],
  ['client_file_folders', 'file folder'], ['form_responses', 'form'], ['client_reports', 'client report'],
  ['billable_reports', 'report'], ['agreements', 'agreement'], ['budgets', 'budget'], ['funding_periods', 'funding period'],
  ['recurring_series', 'recurring series'],
];

const label = c => `C${String(c.id).padStart(4, '0')} ${c.first_name} ${c.last_name}`.replace(/\s+/g, ' ');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : (word.endsWith('s') ? '' : 's')}`;

class MergeError extends Error {}

function check(sourceId, targetId) {
  const source = db.prepare('SELECT * FROM clients WHERE id = ?').get(sourceId);
  const target = db.prepare('SELECT * FROM clients WHERE id = ?').get(targetId);
  if (!source || !target) throw new MergeError('Client not found');
  if (source.id === target.id) throw new MergeError('Choose a different client to keep');
  if (source.merged_into) throw new MergeError(`${label(source)} has already been merged`);
  if (target.merged_into) throw new MergeError(`${label(target)} has itself been merged into another client — choose that one`);
  return { source, target };
}

// What would move, for the confirmation screen.
function preview(sourceId, targetId) {
  const { source, target } = check(sourceId, targetId);
  const counts = [];
  for (const [table, word] of SIMPLE_TABLES) {
    const n = db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE client_id = ?`).get(source.id).n;
    if (n) counts.push({ table, n, text: plural(n, word) });
  }
  const contactN = db.prepare('SELECT COUNT(*) n FROM client_contacts WHERE client_id = ? AND active = 1').get(source.id).n;
  if (contactN) counts.push({ table: 'client_contacts', n: contactN, text: plural(contactN, 'contact') });
  const emailN = db.prepare('SELECT COUNT(DISTINCT message_id) n FROM email_message_clients WHERE client_id = ? AND removed_at IS NULL').get(source.id).n;
  if (emailN) counts.push({ table: 'email_message_clients', n: emailN, text: plural(emailN, 'filed email') });
  const pick = c => ({ id: c.id, label: label(c), first_name: c.first_name, last_name: c.last_name, date_of_birth: c.date_of_birth, email: c.email,
    phone: c.phone, address: c.address, ndis_number: c.ndis_number, active: c.active, created_at: c.created_at });
  return { source: pick(source), target: pick(target), counts };
}

function merge(sourceId, targetId, userId) {
  return db.transaction(() => {
    const { source, target } = check(sourceId, targetId);
    const moved = {};

    // Folders first: a folder whose name the kept client already uses gets "(from C0003)".
    const takenNames = new Set(db.prepare('SELECT LOWER(name) n FROM client_file_folders WHERE client_id = ?').all(target.id).map(r => r.n));
    moved.renamed_folders = [];
    for (const f of db.prepare('SELECT id, name FROM client_file_folders WHERE client_id = ?').all(source.id)) {
      if (takenNames.has(f.name.toLowerCase())) {
        const name = `${f.name} (from C${String(source.id).padStart(4, '0')})`;
        db.prepare('UPDATE client_file_folders SET name = ? WHERE id = ?').run(name, f.id);
        moved.renamed_folders.push({ id: f.id, from: f.name });
      }
    }
    for (const [table] of SIMPLE_TABLES) {
      const ids = db.prepare(`SELECT id FROM ${table} WHERE client_id = ?`).all(source.id).map(r => r.id);
      if (ids.length) db.prepare(`UPDATE ${table} SET client_id = ? WHERE client_id = ?`).run(target.id, source.id);
      moved[table] = ids;
    }

    // Contacts: someone already on the kept client (same email) isn't added twice.
    moved.client_contacts = [];
    moved.contacts_hidden = [];
    moved.primary_contacts = db.prepare('SELECT id FROM client_contacts WHERE client_id = ? AND active = 1 AND is_primary = 1').all(source.id).map(r => r.id);
    const targetEmails = new Set(db.prepare("SELECT LOWER(TRIM(email)) e FROM client_contacts WHERE client_id = ? AND active = 1 AND COALESCE(email, '') != ''").all(target.id).map(r => r.e));
    for (const c of db.prepare('SELECT * FROM client_contacts WHERE client_id = ? AND active = 1').all(source.id)) {
      if (c.email && targetEmails.has(c.email.trim().toLowerCase())) {
        db.prepare('UPDATE client_contacts SET active = 0 WHERE id = ?').run(c.id);
        moved.contacts_hidden.push(c.id);
      } else {
        db.prepare('UPDATE client_contacts SET client_id = ?, is_primary = 0 WHERE id = ?').run(target.id, c.id);
        moved.client_contacts.push(c.id);
      }
    }

    // Filed emails: an email already filed to both keeps one link.
    moved.email_message_clients = [];
    moved.email_links_removed = [];
    for (const l of db.prepare('SELECT * FROM email_message_clients WHERE client_id = ? AND removed_at IS NULL').all(source.id)) {
      const dup = db.prepare('SELECT 1 FROM email_message_clients WHERE message_id = ? AND client_id = ? AND removed_at IS NULL').get(l.message_id, target.id);
      if (dup) {
        db.prepare('UPDATE email_message_clients SET removed_at = CURRENT_TIMESTAMP, removed_by = ? WHERE id = ?').run(userId, l.id);
        moved.email_links_removed.push(l.id);
      } else {
        db.prepare('UPDATE email_message_clients SET client_id = ? WHERE id = ?').run(target.id, l.id);
        moved.email_message_clients.push(l.id);
      }
    }
    // Suggestions pointing at the duplicate now point at the kept client.
    db.prepare(`INSERT OR IGNORE INTO email_link_suggestions (message_id, client_id, reason, detail)
      SELECT message_id, ?, reason, detail FROM email_link_suggestions WHERE client_id = ?`).run(target.id, source.id);
    db.prepare('DELETE FROM email_link_suggestions WHERE client_id = ?').run(source.id);

    db.prepare('UPDATE clients SET merged_into = ?, merged_at = CURRENT_TIMESTAMP, active = 0 WHERE id = ?').run(target.id, source.id);
    contacts.syncLegacyFields(target.id);
    contacts.syncLegacyFields(source.id);
    const mergeId = db.prepare('INSERT INTO client_merges (source_id, target_id, moved, source_was_active, merged_by) VALUES (?, ?, ?, ?, ?)')
      .run(source.id, target.id, JSON.stringify(moved), source.active ? 1 : 0, userId).lastInsertRowid;

    const summary = SIMPLE_TABLES.map(([t, w]) => (moved[t].length ? plural(moved[t].length, w) : null))
      .concat(moved.client_contacts.length ? plural(moved.client_contacts.length, 'contact') : null,
        moved.email_message_clients.length ? plural(moved.email_message_clients.length, 'filed email') : null)
      .filter(Boolean).join(', ') || 'nothing attached';
    audit.log('client', target.id, 'merged_in', `Merged in duplicate ${label(source)}: ${summary}`);
    audit.log('client', source.id, 'merged_into', `Merged into ${label(target)}: ${summary} moved`);
    return { mergeId, summary };
  })();
}

// Undo the most recent merge of this duplicate: move back exactly the rows that were moved
// (any that have since been moved elsewhere stay put) and restore the duplicate.
function undo(sourceId, userId) {
  return db.transaction(() => {
    const m = db.prepare('SELECT * FROM client_merges WHERE source_id = ? AND undone_at IS NULL ORDER BY id DESC LIMIT 1').get(sourceId);
    if (!m) throw new MergeError('This client has not been merged');
    const moved = JSON.parse(m.moved);
    const back = (table, ids) => {
      for (const id of ids || []) db.prepare(`UPDATE ${table} SET client_id = ? WHERE id = ? AND client_id = ?`).run(m.source_id, id, m.target_id);
    };
    for (const [table] of SIMPLE_TABLES) back(table, moved[table]);
    for (const f of moved.renamed_folders || []) db.prepare('UPDATE client_file_folders SET name = ? WHERE id = ?').run(f.from, f.id);
    back('client_contacts', moved.client_contacts);
    for (const id of moved.contacts_hidden || []) db.prepare('UPDATE client_contacts SET active = 1 WHERE id = ?').run(id);
    for (const id of moved.primary_contacts || []) db.prepare('UPDATE client_contacts SET is_primary = 1 WHERE id = ? AND client_id = ?').run(id, m.source_id);
    back('email_message_clients', moved.email_message_clients);
    for (const id of moved.email_links_removed || []) db.prepare('UPDATE email_message_clients SET removed_at = NULL, removed_by = NULL WHERE id = ?').run(id);
    db.prepare('UPDATE clients SET merged_into = NULL, merged_at = NULL, active = ? WHERE id = ?').run(m.source_was_active, m.source_id);
    db.prepare('UPDATE client_merges SET undone_at = CURRENT_TIMESTAMP, undone_by = ? WHERE id = ?').run(userId, m.id);
    contacts.syncLegacyFields(m.target_id);
    contacts.syncLegacyFields(m.source_id);
    const source = db.prepare('SELECT * FROM clients WHERE id = ?').get(m.source_id);
    const target = db.prepare('SELECT * FROM clients WHERE id = ?').get(m.target_id);
    // Unfiled emails suggesting either client get their suggestions worked out again.
    const affected = db.prepare(`SELECT DISTINCT s.message_id FROM email_link_suggestions s JOIN email_messages e ON e.id = s.message_id
      WHERE s.client_id = ? AND e.status = 'unfiled'`).all(m.target_id).map(r => r.message_id);
    require('./mailLinking').refreshSuggestions({ messageIds: affected });
    audit.log('client', m.target_id, 'merge_undone', `Undid merge of ${label(source)} — its records moved back`);
    audit.log('client', m.source_id, 'merge_undone', `Merge into ${label(target)} undone — records moved back`);
    return { targetId: m.target_id };
  })();
}

function lastMerge(sourceId) {
  return db.prepare(`SELECT m.*, p.first_name || ' ' || p.last_name AS merged_by_name FROM client_merges m
    LEFT JOIN practitioners p ON p.id = m.merged_by WHERE m.source_id = ? AND m.undone_at IS NULL ORDER BY m.id DESC LIMIT 1`).get(sourceId);
}

module.exports = { preview, merge, undo, lastMerge, MergeError };
