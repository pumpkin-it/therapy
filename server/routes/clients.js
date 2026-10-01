const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');
const audit = require('../services/audit');
const { getClientSpend } = require('../services/budgets');
const contacts = require('../services/clientContacts');
const clientMerge = require('../services/clientMerge');

const CLIENT_SELECT = `
  SELECT c.*,
    fp_active.funding_type AS active_funding_type,
    fp_active.start_date AS active_period_start,
    fp_active.end_date AS active_period_end,
    CASE WHEN fp_active.ndis_management = 'self' AND fm_active.name IS NULL THEN 'Self Managed' ELSE fm_active.name END AS active_funds_manager_name,
    fm_legacy.name AS funds_manager_name, fm_legacy.email AS funds_manager_email
  FROM clients c
  LEFT JOIN funding_periods fp_active ON fp_active.id = (
    SELECT id FROM funding_periods
    WHERE client_id = c.id
      AND (start_date IS NULL OR start_date = '' OR DATE(start_date) <= DATE('now')) AND (end_date IS NULL OR end_date = '' OR DATE(end_date) >= DATE('now'))
    ORDER BY start_date DESC LIMIT 1
  )
  LEFT JOIN funds_managers fm_active ON fm_active.id = fp_active.funds_manager_id
  LEFT JOIN funds_managers fm_legacy ON fm_legacy.id = c.funds_manager_id
`;

const CLIENTS_PAGE = 50;

router.get('/', auth, (req, res) => {
  const { search, active } = req.query;
  // ?page=N (the Clients page): one page of clients, only the columns the list shows, plus the
  // total. Without it, every client (pickers and filters elsewhere use the full list).
  const page = req.query.page ? Math.max(1, Number(req.query.page) || 1) : null;
  // active=0 → inactive only, active=1 → active only (default), active=all → both
  const activeFilter = active === 'all' ? null : active === '0' ? 0 : 1;
  // Test/dummy data is excluded from every list view regardless of the active filter — distinct
  // from a genuinely deactivated client, which stays visible under Inactive/All for history.
  // Merged duplicates never appear in lists or pickers (their records are on the kept client).
  const whereParts = ['(c.is_test_data IS NULL OR c.is_test_data = 0)', 'c.merged_into IS NULL'];
  const params = [];
  if (activeFilter !== null) { whereParts.push('c.active = ?'); params.push(activeFilter); }
  if (search) {
    const q = `%${search}%`;
    // A client code (C0012 or 12) finds that client too.
    const code = /^c?0*(\d+)$/i.exec(String(search).trim());
    whereParts.push(`(c.first_name LIKE ? OR c.last_name LIKE ? OR (c.first_name || ' ' || c.last_name) LIKE ? OR c.email LIKE ? OR c.phone LIKE ?${code ? ' OR c.id = ?' : ''})`);
    params.push(q, q, q, q, q, ...(code ? [Number(code[1])] : []));
  }
  const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
  if (!page) {
    const rows = db.prepare(`${CLIENT_SELECT} ${where} ORDER BY c.first_name, c.last_name`).all(...params);
    return res.json(rows);
  }
  const total = db.prepare(`SELECT COUNT(*) n FROM clients c ${where}`).get(...params).n;
  // This page's clients first, then their funding details — not the details for every client.
  const ids = db.prepare(`SELECT c.id FROM clients c ${where} ORDER BY c.first_name, c.last_name, c.id LIMIT ? OFFSET ?`)
    .all(...params, CLIENTS_PAGE, (page - 1) * CLIENTS_PAGE).map(r => r.id);
  const details = ids.length ? db.prepare(`
    SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.active, c.alert, c.funding_type,
      fp_active.funding_type AS active_funding_type,
      CASE WHEN fp_active.ndis_management = 'self' AND fm_active.name IS NULL THEN 'Self Managed' ELSE fm_active.name END AS active_funds_manager_name,
      fm_legacy.name AS funds_manager_name
    ${CLIENT_SELECT.slice(CLIENT_SELECT.indexOf('FROM clients c'))}
    WHERE c.id IN (${ids.map(() => '?').join(',')})
  `).all(...ids) : [];
  const byId = new Map(details.map(d => [d.id, d]));
  res.json({ rows: ids.map(id => byId.get(id)), total, page, page_size: CLIENTS_PAGE });
});

// A name match alone is deliberately NOT enough to flag a duplicate — real clients can share a
// name (e.g. siblings). This only fires when the name matches AND at least one of date_of_birth/
// phone/email also matches, or when email matches regardless of name (still worth a look — could
// be the same person entered under a misspelled name). See feedback_therapy / process_therapy_
// invoice_migration memory: this was added after a real duplicate (same name, same DOB/phone,
// entered ~7 weeks apart) went undetected and had to be found and merged manually.
router.get('/check-duplicates', auth, (req, res) => {
  const { first_name, last_name, date_of_birth, phone, email, exclude_id } = req.query;
  const normPhone = p => (p || '').replace(/[^0-9]/g, '');
  const matches = [];
  const seen = new Set();
  const add = (r, reasons) => {
    if (seen.has(r.id)) return;
    matches.push({ ...r, match_reason: reasons.join(' & ') });
    seen.add(r.id);
  };

  if (first_name && last_name) {
    const conditions = ['merged_into IS NULL', 'LOWER(TRIM(first_name)) = LOWER(TRIM(?)) AND LOWER(TRIM(last_name)) = LOWER(TRIM(?))'];
    const params = [first_name, last_name];
    if (exclude_id) { conditions.push('id != ?'); params.push(exclude_id); }
    const rows = db.prepare(`SELECT id, first_name, last_name, date_of_birth, phone, email FROM clients WHERE ${conditions.join(' AND ')}`).all(...params);
    for (const r of rows) {
      const reasons = [];
      if (date_of_birth && r.date_of_birth && r.date_of_birth === date_of_birth) reasons.push('date of birth');
      if (phone && r.phone && normPhone(phone).length >= 6 && normPhone(r.phone) === normPhone(phone)) reasons.push('phone');
      if (email && r.email && r.email.toLowerCase() === email.toLowerCase()) reasons.push('email');
      if (reasons.length) add(r, reasons);
    }
  }

  if (email) {
    const conditions = ['merged_into IS NULL', 'LOWER(email) = LOWER(?)'];
    const params = [email];
    if (exclude_id) { conditions.push('id != ?'); params.push(exclude_id); }
    for (const r of db.prepare(`SELECT id, first_name, last_name, date_of_birth, phone, email FROM clients WHERE ${conditions.join(' AND ')}`).all(...params)) {
      add(r, ['email']);
    }
  }

  res.json(matches);
});

router.get('/:id', auth, (req, res) => {
  const client = db.prepare(`${CLIENT_SELECT} WHERE c.id = ?`).get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Not found' });
  const appointments = db.prepare(`
    SELECT a.*, p.first_name || ' ' || p.last_name AS practitioner_name
    FROM appointments a
    JOIN practitioners p ON p.id = a.practitioner_id
    WHERE a.client_id = ? ORDER BY a.start_time DESC LIMIT 20
  `).all(req.params.id);
  const invoices = db.prepare('SELECT * FROM invoices WHERE client_id = ? ORDER BY created_at DESC LIMIT 10').all(req.params.id);
  let merged = null;
  if (client.merged_into) {
    const target = db.prepare('SELECT id, first_name, last_name FROM clients WHERE id = ?').get(client.merged_into);
    const m = clientMerge.lastMerge(client.id);
    merged = { into_id: target.id, into_name: `${target.first_name} ${target.last_name}`, at: m?.merged_at || client.merged_at, by: m?.merged_by_name || null };
  }
  res.json({ ...client, appointments, invoices, contacts: contacts.list(req.params.id), merged });
});

// Billables summary — invoiced + projected spend over an arbitrary date range, independent of
// any agreement/budget. Defaults to the last 12 months when from/to are omitted.
router.get('/:id/spend', auth, (req, res) => {
  let { from, to } = req.query;
  if (!to) to = new Date().toISOString().slice(0, 10);
  if (!from) {
    const d = new Date(to);
    d.setFullYear(d.getFullYear() - 1);
    from = d.toISOString().slice(0, 10);
  }
  res.json({ from, to, ...getClientSpend(req.params.id, from, to) });
});

router.post('/', auth, (req, res) => {
  const {
    first_name, last_name, email, phone, date_of_birth, address, notes, alert,
    diagnosis, allergies, regular_medication, gender, is_test_data,
  } = req.body;
  // Contacts arrive as a list. A request without one (an older copy of the page) may still send
  // the flat emergency contact / case manager fields, so turn those into contacts instead.
  let newContacts = Array.isArray(req.body.contacts) ? req.body.contacts : [];
  if (!Array.isArray(req.body.contacts)) {
    const b = req.body;
    if (b.emergency_contact_name || b.emergency_contact_phone || b.emergency_contact_email) {
      newContacts.push({ role: 'other', name: b.emergency_contact_name || 'Emergency contact', relationship: b.emergency_contact_relationship,
        email: b.emergency_contact_email, phone: b.emergency_contact_phone, is_emergency: true });
    }
    if (b.case_manager_name || b.case_manager_phone || b.case_manager_email) {
      newContacts.push({ role: 'support_coordinator', name: b.case_manager_name || 'Support coordinator', organisation: b.case_manager_organisation,
        email: b.case_manager_email, phone: b.case_manager_phone });
    }
  }
  const normalised = [];
  for (const c of newContacts) {
    const { contact, error } = contacts.normalise(c);
    if (error) return res.status(400).json({ error });
    normalised.push(contact);
  }
  const id = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO clients (first_name, last_name, email, phone, date_of_birth, address, notes, alert,
        diagnosis, allergies, regular_medication, gender, is_test_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      first_name, last_name, email||null, phone||null, date_of_birth||null, address||null, notes||null, alert||null,
      diagnosis||null, allergies||null, regular_medication||null, gender||null, is_test_data ? 1 : 0,
    );
    const clientId = result.lastInsertRowid;
    for (const c of normalised) contacts.insert(clientId, c);
    contacts.syncLegacyFields(clientId);
    return clientId;
  })();
  const newClient = db.prepare(`${CLIENT_SELECT} WHERE c.id = ?`).get(id);
  audit.log('client', newClient.id, 'created', `Created client ${first_name} ${last_name}`);
  for (const c of normalised) audit.log('client', newClient.id, 'contact_added', `Added contact ${contacts.describe(c)}`);
  res.status(201).json(newClient);
});

// The flat emergency contact / case manager fields aren't written here: they're derived from the
// client's contacts (routes below).
router.patch('/:id', auth, (req, res) => {
  const {
    first_name, last_name, email, phone, date_of_birth, address, notes, alert,
    diagnosis, allergies, regular_medication, gender, is_test_data,
  } = req.body;
  const before = db.prepare('SELECT * FROM clients WHERE id=?').get(req.params.id);
  db.prepare(`
    UPDATE clients SET
      first_name=?, last_name=?, email=?, phone=?, date_of_birth=?, address=?, notes=?, alert=?,
      diagnosis=?, allergies=?, regular_medication=?, gender=?, is_test_data=?
    WHERE id=?
  `).run(
    first_name, last_name, email||null, phone||null, date_of_birth||null, address||null, notes||null, alert||null,
    diagnosis||null, allergies||null, regular_medication||null, gender||null, is_test_data ? 1 : 0,
    req.params.id,
  );
  const changes = audit.diff(before, req.body, ['first_name','last_name','email','phone','date_of_birth','address','gender','notes','alert']);
  if (changes) audit.log('client', Number(req.params.id), 'updated', changes);
  res.json(db.prepare(`${CLIENT_SELECT} WHERE c.id = ?`).get(req.params.id));
});

// ─── Contacts ─────────────────────────────────────────────────────────────────
// People attached to a client (services/clientContacts.js). Removing one only hides it.

router.get('/:id/contacts', auth, (req, res) => {
  res.json(contacts.list(req.params.id));
});

router.post('/:id/contacts', auth, (req, res) => {
  const clientId = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM clients WHERE id = ?').get(clientId)) return res.status(404).json({ error: 'Client not found' });
  const { contact, error } = contacts.normalise(req.body);
  if (error) return res.status(400).json({ error });
  db.transaction(() => {
    contacts.insert(clientId, contact);
    contacts.syncLegacyFields(clientId);
  })();
  audit.log('client', clientId, 'contact_added', `Added contact ${contacts.describe(contact)}`);
  res.status(201).json(contacts.list(clientId));
});

router.patch('/:id/contacts/:contactId', auth, (req, res) => {
  const clientId = Number(req.params.id);
  const before = db.prepare('SELECT * FROM client_contacts WHERE id = ? AND client_id = ? AND active = 1').get(req.params.contactId, clientId);
  if (!before) return res.status(404).json({ error: 'Contact not found' });
  const { contact, error } = contacts.normalise(req.body);
  if (error) return res.status(400).json({ error });
  db.transaction(() => {
    contacts.update(clientId, before.id, contact);
    contacts.syncLegacyFields(clientId);
  })();
  const changes = audit.diff(before, contact, contacts.FIELDS);
  if (changes) audit.log('client', clientId, 'contact_updated', `Updated contact ${before.name}: ${changes}`);
  res.json(contacts.list(clientId));
});

router.delete('/:id/contacts/:contactId', auth, (req, res) => {
  const clientId = Number(req.params.id);
  const before = db.prepare('SELECT * FROM client_contacts WHERE id = ? AND client_id = ? AND active = 1').get(req.params.contactId, clientId);
  if (!before) return res.status(404).json({ error: 'Contact not found' });
  db.transaction(() => {
    db.prepare('UPDATE client_contacts SET active = 0, is_primary = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(before.id);
    contacts.syncLegacyFields(clientId);
  })();
  audit.log('client', clientId, 'contact_removed', `Removed contact ${contacts.describe(before)}`);
  res.json(contacts.list(clientId));
});

// ─── Merging duplicates (owners and admins) ──────────────────────────────────
const canMerge = req => ['owner', 'admin'].includes(req.user?.role);

router.get('/:id/merge-preview', auth, (req, res) => {
  if (!canMerge(req)) return res.status(403).json({ error: 'Only owners and admins can merge clients' });
  try { res.json(clientMerge.preview(Number(req.params.id), Number(req.query.target))); }
  catch (e) { if (e instanceof clientMerge.MergeError) return res.status(400).json({ error: e.message }); throw e; }
});

router.post('/:id/merge', auth, (req, res) => {
  if (!canMerge(req)) return res.status(403).json({ error: 'Only owners and admins can merge clients' });
  try { res.json(clientMerge.merge(Number(req.params.id), Number(req.body.target_id), req.user.id)); }
  catch (e) { if (e instanceof clientMerge.MergeError) return res.status(400).json({ error: e.message }); throw e; }
});

router.post('/:id/unmerge', auth, (req, res) => {
  if (!canMerge(req)) return res.status(403).json({ error: 'Only owners and admins can undo a merge' });
  try { res.json(clientMerge.undo(Number(req.params.id), req.user.id)); }
  catch (e) { if (e instanceof clientMerge.MergeError) return res.status(400).json({ error: e.message }); throw e; }
});

router.patch('/:id/active', auth, (req, res) => {
  // A merged duplicate stays inactive — undoing the merge is the only way back.
  const merged = db.prepare('SELECT merged_into FROM clients WHERE id = ?').get(req.params.id)?.merged_into;
  if (merged && req.body.active) return res.status(409).json({ error: 'This record was merged into another client — undo the merge to bring it back.' });
  db.prepare('UPDATE clients SET active=? WHERE id=?').run(req.body.active ? 1 : 0, req.params.id);
  audit.log('client', Number(req.params.id), req.body.active ? 'reactivated' : 'deactivated', `Client ${req.body.active ? 'reactivated' : 'deactivated'}`);
  res.json({ ok: true });
});

router.delete('/:id', auth, (req, res) => {
  db.prepare('UPDATE clients SET active = 0 WHERE id = ?').run(req.params.id);
  audit.log('client', Number(req.params.id), 'deactivated', 'Client deactivated');
  res.status(204).send();
});

// Durable per-client link (same bearer-token model as agreements.signing_token /
// practitioners.cal_token) showing everything currently marked shareable for this client —
// see server/routes/clientPortal.js. Lazily generated on first request, regenerable if leaked.
router.post('/:id/reset-portal-token', auth, (req, res) => {
  const crypto = require('crypto');
  const token = crypto.randomBytes(20).toString('hex');
  db.prepare('UPDATE clients SET portal_token = ? WHERE id = ?').run(token, req.params.id);
  audit.log('client', Number(req.params.id), 'updated', 'Portal link generated/reset');
  res.json({ portal_token: token });
});

module.exports = router;
