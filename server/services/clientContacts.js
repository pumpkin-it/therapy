const db = require('../database');

// Keep in step with client/src/lib/clientContacts.js.
const ROLES = ['family', 'carer', 'support_coordinator', 'plan_manager', 'school', 'health', 'other'];

const FIELDS = ['role', 'name', 'relationship', 'organisation', 'email', 'phone', 'notes', 'is_emergency', 'is_primary'];

function list(clientId) {
  return db.prepare(`
    SELECT * FROM client_contacts WHERE client_id = ? AND active = 1
    ORDER BY is_primary DESC, is_emergency DESC, name COLLATE NOCASE, id
  `).all(clientId);
}

// Returns { contact } with trimmed, validated fields, or { error }.
function normalise(input) {
  const s = v => (v == null ? '' : String(v).trim());
  const c = {
    role: ROLES.includes(input.role) ? input.role : 'other',
    name: s(input.name),
    relationship: s(input.relationship) || null,
    organisation: s(input.organisation) || null,
    email: s(input.email) || null,
    phone: s(input.phone) || null,
    notes: s(input.notes) || null,
    is_emergency: input.is_emergency ? 1 : 0,
    is_primary: input.is_primary ? 1 : 0,
  };
  if (!c.name) return { error: 'Contact name is required' };
  if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) return { error: `"${c.email}" is not a valid email address` };
  return { contact: c };
}

// Only one primary contact per client.
function clearOtherPrimaries(clientId, keepId) {
  db.prepare('UPDATE client_contacts SET is_primary = 0 WHERE client_id = ? AND id != ? AND is_primary = 1').run(clientId, keepId);
}

function insert(clientId, contact) {
  const id = db.prepare(`
    INSERT INTO client_contacts (client_id, ${FIELDS.join(', ')}) VALUES (?, ${FIELDS.map(() => '?').join(', ')})
  `).run(clientId, ...FIELDS.map(f => contact[f])).lastInsertRowid;
  if (contact.is_primary) clearOtherPrimaries(clientId, id);
  return id;
}

function update(clientId, contactId, contact) {
  db.prepare(`
    UPDATE client_contacts SET ${FIELDS.map(f => `${f} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND client_id = ?
  `).run(...FIELDS.map(f => contact[f]), contactId, clientId);
  if (contact.is_primary) clearOtherPrimaries(clientId, contactId);
}

// The old flat clients.emergency_contact_* / case_manager_* columns are still read by the mobile
// app, so they're rewritten from the contacts list after every change: the first emergency
// contact, and the first support coordinator.
function syncLegacyFields(clientId) {
  const contacts = list(clientId);
  const ec = contacts.find(c => c.is_emergency) || {};
  const sc = contacts.find(c => c.role === 'support_coordinator') || {};
  db.prepare(`
    UPDATE clients SET
      emergency_contact_name = ?, emergency_contact_phone = ?, emergency_contact_email = ?, emergency_contact_relationship = ?,
      case_manager_name = ?, case_manager_organisation = ?, case_manager_phone = ?, case_manager_email = ?
    WHERE id = ?
  `).run(
    ec.name || null, ec.phone || null, ec.email || null, ec.relationship || null,
    sc.name || null, sc.organisation || null, sc.phone || null, sc.email || null,
    clientId,
  );
}

// A short description for the audit log, e.g. "Jane Smith (Support coordinator, jane@x.com)".
const ROLE_LABELS = {
  family: 'Family / guardian', carer: 'Carer', support_coordinator: 'Support coordinator', plan_manager: 'Plan manager',
  school: 'School / teacher', health: 'Health professional', other: 'Other',
};
function describe(c) {
  return `${c.name} (${[ROLE_LABELS[c.role] || c.role, c.relationship, c.email, c.phone].filter(Boolean).join(', ')})`;
}

module.exports = { ROLES, FIELDS, list, normalise, insert, update, syncLegacyFields, describe };
