// Email copied in from the practice mailbox (services/mailSync.js): the Email page's lists, one
// email in full, and filing emails against clients. Needs the Email permission (index.js).
const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');
const audit = require('../services/audit');
const store = require('../services/mailStore');
const linking = require('../services/mailLinking');
const mailSync = require('../services/mailSync');
const contacts = require('../services/clientContacts');
const tags = require('../services/mailTags');
const mailSend = require('../services/mailSend');
const crypto = require('crypto');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 20 } });

const PAGE = 50;
const parseList = json => { try { return JSON.parse(json || '[]') || []; } catch { return []; } };

// Free text → an FTS5 query: each word must appear (as a prefix), quotes stripped so nothing
// typed can be read as FTS syntax.
function ftsQuery(q) {
  const words = String(q).match(/[\p{L}\p{N}@._'-]+/gu) || [];
  return words.slice(0, 12).map(w => `"${w.replace(/"/g, '')}"*`).join(' ');
}

// Inactive clients are still offered (an email can be about a past client) but marked so.
const clientName = c => `${c.first_name} ${c.last_name}`.trim() + (c.active === 0 ? ' - INACTIVE' : '');

// Linked clients and suggestions for a set of emails, keyed by message id.
function linksFor(ids) {
  const out = new Map(ids.map(id => [id, { clients: [], suggestions: [] }]));
  if (!ids.length) return out;
  const ph = ids.map(() => '?').join(',');
  for (const r of db.prepare(`
    SELECT l.message_id, l.method, c.id, c.first_name, c.last_name, c.active FROM email_message_clients l JOIN clients c ON c.id = l.client_id
    WHERE l.removed_at IS NULL AND l.message_id IN (${ph}) ORDER BY c.first_name, c.last_name
  `).all(...ids)) out.get(r.message_id).clients.push({ id: r.id, name: clientName(r), method: r.method });
  for (const r of db.prepare(`
    SELECT s.message_id, s.reason, s.detail, c.id, c.first_name, c.last_name, c.active FROM email_link_suggestions s JOIN clients c ON c.id = s.client_id
    WHERE s.message_id IN (${ph}) ORDER BY c.first_name, c.last_name
  `).all(...ids)) {
    const list = out.get(r.message_id).suggestions;
    let entry = list.find(x => x.id === r.id);
    if (!entry) list.push(entry = { id: r.id, name: clientName(r), active: r.active, reasons: [] });
    entry.reasons.push({ reason: r.reason, detail: r.detail });
  }
  return out;
}

const LIST_COLS = `m.id, m.direction, m.from_address, m.from_name, m.to_json, m.subject, m.snippet, m.received_at, m.sent_at,
  m.has_attachments, m.is_read, m.status, m.graph_folder_name, m.mailbox_removed_at, m.auto_hint, m.task_id, m.actioned_at,
  (SELECT status FROM tasks WHERE id = m.task_id) AS task_status`;

function shape(rows) {
  const ids = rows.map(r => r.id);
  const links = linksFor(ids);
  const t = tags.tagsFor(ids);
  return rows.map(r => ({ ...r, to: parseList(r.to_json), to_json: undefined, ...links.get(r.id), ...t.get(r.id) }));
}

// ─── Tags ─────────────────────────────────────────────────────────────────────

router.get('/tags', auth, (req, res) => {
  const counts = new Map(db.prepare('SELECT tag_id, COUNT(*) n FROM email_message_tags GROUP BY tag_id').all().map(r => [r.tag_id, r.n]));
  res.json(tags.listTags().map(t => ({ ...t, count: counts.get(t.id) || 0 })));
});

// A new tag, added while filing. Reuses an existing one of the same name (case-insensitive).
const TAG_COLORS = ['gray', 'blue', 'green', 'yellow', 'red', 'purple', 'orange', 'amber', 'indigo', 'pink', 'teal'];
router.post('/tags', auth, (req, res) => {
  const name = String(req.body.name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!name) return res.status(400).json({ error: 'Tag name is required' });
  const existing = db.prepare('SELECT * FROM email_tags WHERE name = ? COLLATE NOCASE').get(name);
  if (existing) {
    if (!existing.active) db.prepare('UPDATE email_tags SET active = 1 WHERE id = ?').run(existing.id);
    return res.json({ ...existing, active: 1 });
  }
  const color = TAG_COLORS.includes(req.body.color) ? req.body.color : TAG_COLORS[db.prepare('SELECT COUNT(*) n FROM email_tags').get().n % TAG_COLORS.length];
  const id = db.prepare('INSERT INTO email_tags (name, color, sort_order) VALUES (?, ?, 500)').run(name, color).lastInsertRowid;
  audit.log('settings', null, 'email_tag_added', `Email tag added: "${name}"`);
  res.status(201).json(db.prepare('SELECT * FROM email_tags WHERE id = ?').get(id));
});

router.get('/status', auth, (req, res) => res.json(mailSync.status()));

// Sidebar number: how many emails are waiting to be filed.
// The New view: incoming email since the inbox started that no one has dealt with yet.
const NEW_WHERE = "m.direction = 'in' AND m.actioned_at IS NULL AND m.received_at >= COALESCE((SELECT value FROM settings WHERE key = 'email_new_since'), '')";
router.get('/counts', auth, (req, res) => {
  res.json({
    unfiled: db.prepare("SELECT COUNT(*) n FROM email_messages WHERE status = 'unfiled'").get().n,
    new: db.prepare(`SELECT COUNT(*) n FROM email_messages m WHERE ${NEW_WHERE}`).get().n,
  });
});

// Pictures in emails and signatures (e.g. a logo), from the email editor. Stored like report
// pictures; when the email is sent they're attached inline so they show without "download pictures".
router.post('/images', auth, require('./reportImages').acceptImage, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a PNG, JPG, GIF or WebP image.' });
  res.status(201).json({ url: `/api/report-images/${req.file.filename}` });
});

// Mark emails as dealt with (they leave New), or put them back: { done: true|false }.
const markActioned = (ids, userId, done = true) => {
  const set = db.prepare(done ? 'UPDATE email_messages SET actioned_at = CURRENT_TIMESTAMP, actioned_by = ? WHERE id = ? AND actioned_at IS NULL'
    : 'UPDATE email_messages SET actioned_at = NULL, actioned_by = NULL WHERE id = ? AND ? IS NOT NULL');
  for (const id of ids) done ? set.run(userId, id) : set.run(id, userId);
};
router.post('/messages/:id/done', auth, (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM email_messages WHERE id = ?').get(id)) return res.status(404).json({ error: 'Email not found' });
  markActioned([id], req.user.id, req.body.done !== false);
  res.json(loadMessage(id));
});

// ?view=new|unfiled|filed|not_client|all  &q=search  &tag=<tag id>  &page=N
router.get('/messages', auth, (req, res) => {
  const view = ['new', 'unfiled', 'filed', 'not_client', 'all'].includes(req.query.view) ? req.query.view : 'new';
  const page = Math.max(1, Number(req.query.page) || 1);
  const where = [];
  const params = [];
  if (view === 'new') where.push(NEW_WHERE);
  else if (view !== 'all') { where.push('m.status = ?'); params.push(view); }
  const q = ftsQuery(req.query.q || '');
  if (q) { where.push('m.id IN (SELECT rowid FROM email_fts WHERE email_fts MATCH ?)'); params.push(q); }
  if (Number(req.query.tag)) { where.push('m.id IN (SELECT message_id FROM email_message_tags WHERE tag_id = ?)'); params.push(Number(req.query.tag)); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM email_messages m ${w}`).get(...params).n;
  // Filed and No client: most recently filed first, so something just filed is at the top.
  const order = view === 'filed' || view === 'not_client' ? 'm.filed_at DESC, m.received_at DESC, m.id DESC' : 'm.received_at DESC, m.id DESC';
  const rows = db.prepare(`SELECT ${LIST_COLS} FROM email_messages m ${w} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, PAGE, (page - 1) * PAGE);
  res.json({ rows: shape(rows), total, page, page_size: PAGE });
});

// Emails filed against one client, newest first (the client's Communications tab).
router.get('/client/:clientId', auth, (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const params = [req.params.clientId];
  let extra = '';
  const q = ftsQuery(req.query.q || '');
  if (q) { extra = 'AND m.id IN (SELECT rowid FROM email_fts WHERE email_fts MATCH ?)'; params.push(q); }
  const base = `FROM email_messages m WHERE m.id IN (SELECT message_id FROM email_message_clients WHERE client_id = ? AND removed_at IS NULL) ${extra}`;
  const total = db.prepare(`SELECT COUNT(*) n ${base}`).get(...params).n;
  const rows = db.prepare(`SELECT ${LIST_COLS} ${base} ORDER BY m.received_at DESC, m.id DESC LIMIT ? OFFSET ?`).all(...params, PAGE, (page - 1) * PAGE);
  res.json({ rows: shape(rows), total, page, page_size: PAGE });
});

function loadMessage(id) {
  const m = db.prepare('SELECT * FROM email_messages WHERE id = ?').get(id);
  if (!m) return null;
  const { clients, suggestions } = linksFor([m.id]).get(m.id);
  const { tags: tagList, tag_suggestions } = tags.tagsFor([m.id]).get(m.id);
  const attachments = db.prepare('SELECT id, filename, content_type, size, content_id, is_inline FROM email_attachments WHERE message_id = ? ORDER BY id').all(m.id);
  // Other emails in the same conversation, for context.
  const thread = m.conversation_id
    ? db.prepare(`SELECT id, direction, from_name, from_address, subject, received_at, status FROM email_messages
        WHERE mailbox = ? AND conversation_id = ? AND id != ? ORDER BY received_at`).all(m.mailbox, m.conversation_id, m.id)
    : [];
  const filedBy = m.filed_by ? db.prepare('SELECT first_name, last_name FROM practitioners WHERE id = ?').get(m.filed_by) : null;
  const task = m.task_id ? db.prepare(`SELECT t.id, t.title, t.status, t.next_step, t.follow_up_at, p.first_name || ' ' || p.last_name AS assigned_name
    FROM tasks t LEFT JOIN practitioners p ON p.id = t.assigned_to WHERE t.id = ?`).get(m.task_id) : null;
  const autoFiled = !!db.prepare("SELECT 1 FROM email_message_clients WHERE message_id = ? AND removed_at IS NULL AND method = 'auto'").get(m.id);
  return {
    id: m.id, direction: m.direction, from_address: m.from_address, from_name: m.from_name,
    to: parseList(m.to_json), cc: parseList(m.cc_json), bcc: parseList(m.bcc_json), reply_to: parseList(m.reply_to_json),
    subject: m.subject, body_text: m.body_text, has_html: !!m.body_html_key, sent_at: m.sent_at, received_at: m.received_at,
    status: m.status, filed_at: m.filed_at, actioned_at: m.actioned_at,
    filed_by_name: filedBy ? `${filedBy.first_name} ${filedBy.last_name}` : null,
    folder: m.graph_folder_name, mailbox_removed_at: m.mailbox_removed_at, is_read: m.is_read, auto_hint: m.auto_hint,
    attachments, clients, suggestions, tags: tagList, tag_suggestions, thread, task, auto_filed: autoFiled,
  };
}

router.get('/messages/:id', auth, (req, res) => {
  const msg = loadMessage(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Email not found' });
  // Opening an email marks it read here (not yet in Outlook — the sync only reads the mailbox).
  if (!msg.is_read) db.prepare('UPDATE email_messages SET is_read = 1 WHERE id = ?').run(msg.id);
  res.json(msg);
});

// The cleaned-up HTML body, with inline (cid:) images embedded so the page can show it
// without further requests. Remote images are left for the page to allow or block.
const MAX_INLINE_IMAGE = 3 * 1024 * 1024;
router.get('/messages/:id/html', auth, async (req, res) => {
  const m = db.prepare('SELECT id, body_html_key FROM email_messages WHERE id = ?').get(req.params.id);
  if (!m?.body_html_key) return res.status(404).json({ error: 'No HTML body' });
  try {
    let html = (await store.get(m.body_html_key)).toString('utf8');
    const inline = db.prepare("SELECT content_id, content_type, size, storage_key FROM email_attachments WHERE message_id = ? AND content_id IS NOT NULL").all(m.id);
    for (const a of inline) {
      if (!/^image\//.test(a.content_type || '') || a.size > MAX_INLINE_IMAGE) continue;
      const cidRe = new RegExp(`cid:${a.content_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi');
      if (!cidRe.test(html)) continue;
      const data = (await store.get(a.storage_key)).toString('base64');
      html = html.replace(cidRe, `data:${a.content_type};base64,${data}`);
    }
    res.type('text/html').send(html);
  } catch (e) {
    console.error('Email HTML load failed:', e.message);
    res.status(500).json({ error: 'Could not load this email' });
  }
});

router.get('/attachments/:id', auth, async (req, res) => {
  const a = db.prepare('SELECT * FROM email_attachments WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Attachment not found' });
  try {
    const buf = await store.get(a.storage_key);
    res.setHeader('Content-Type', a.content_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(a.filename || 'attachment')}`);
    res.send(buf);
  } catch (e) {
    console.error('Attachment load failed:', e.message);
    res.status(500).json({ error: 'Could not load this attachment' });
  }
});

// The original email file, e.g. to open in Outlook.
router.get('/messages/:id/eml', auth, async (req, res) => {
  const m = db.prepare('SELECT eml_key, subject FROM email_messages WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Email not found' });
  try {
    const buf = await store.get(m.eml_key);
    res.setHeader('Content-Type', 'message/rfc822');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent((m.subject || 'email').slice(0, 80))}.eml`);
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: 'Could not load this email' });
  }
});

function validTagIds(ids) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Boolean))];
  if (!list.length) return list;
  const found = db.prepare(`SELECT id FROM email_tags WHERE id IN (${list.map(() => '?').join(',')})`).all(...list).map(r => r.id);
  return list.length === found.length ? list : null;
}

function validClientIds(ids) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Boolean))];
  if (!list.length) return list;
  const found = db.prepare(`SELECT id FROM clients WHERE merged_into IS NULL AND id IN (${list.map(() => '?').join(',')})`).all(...list).map(r => r.id);
  return list.length === found.length ? list : null;
}

// File one email: its clients become exactly clientIds. With no clients, noClient files it as
// "No client"; otherwise it goes back to Unfiled. Unfiled emails earlier in the same conversation
// are then filed by the thread rule too. tagIds (when given) replace its tags.
function fileOne(messageId, clientIds, userId, { tagIds = null, noClient = false } = {}) {
  const m = db.prepare('SELECT id, subject, status FROM email_messages WHERE id = ?').get(messageId);
  if (!m) return null;
  const subject = m.subject || '(no subject)';
  let added = [], removed = [];
  if (!clientIds.length && noClient) {
    removed = db.prepare('SELECT client_id FROM email_message_clients WHERE message_id = ? AND removed_at IS NULL').all(m.id).map(r => r.client_id);
    linking.markNotClient(m.id, userId);
  } else {
    ({ added, removed } = linking.setLinks(m.id, clientIds, { userId }));
  }
  if (tagIds) tags.setTags(m.id, tagIds, userId);
  const alsoFiled = clientIds.length ? linking.fileUnfiledSiblings(m.id) : [];
  for (const cid of added) audit.log('client', cid, 'email_filed', `Email filed: "${subject}"`);
  for (const cid of removed) audit.log('client', cid, 'email_unfiled', `Email removed from this client: "${subject}"`);
  for (const sid of alsoFiled) {
    const s = db.prepare('SELECT subject FROM email_messages WHERE id = ?').get(sid);
    const cid = db.prepare('SELECT client_id FROM email_message_clients WHERE message_id = ? AND removed_at IS NULL').get(sid)?.client_id;
    if (cid) audit.log('client', cid, 'email_filed', `Email filed (same conversation): "${s.subject || '(no subject)'}"`);
  }
  return { alsoFiled };
}

// Undo for filing. Before a filing, the emails it can change (the email itself and the rest of its
// conversation, which may be filed along with it) are snapshotted: status, tags, and which client
// links were current. Undo puts those back: links the filing added are ended as if by the system
// (so automatic filing may still file them later), links it ended come back, and status and tags
// return to what they were. Each person can undo their own filings for 24 hours.
function snapshotForFiling(messageIds) {
  const ids = new Set(messageIds);
  for (const id of messageIds) {
    const m = db.prepare('SELECT mailbox, conversation_id FROM email_messages WHERE id = ?').get(id);
    if (m?.conversation_id) for (const r of db.prepare('SELECT id FROM email_messages WHERE mailbox = ? AND conversation_id = ?').all(m.mailbox, m.conversation_id)) ids.add(r.id);
  }
  const maxLink = db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM email_message_clients').get().n;
  return {
    max_link_id: maxLink,
    messages: [...ids].map(id => {
      const m = db.prepare('SELECT status, not_client_reason, filed_at, filed_by, actioned_at, actioned_by FROM email_messages WHERE id = ?').get(id);
      return {
        id, ...m,
        links: db.prepare('SELECT id FROM email_message_clients WHERE message_id = ? AND removed_at IS NULL').all(id).map(r => r.id),
        tags: db.prepare('SELECT tag_id FROM email_message_tags WHERE message_id = ?').all(id).map(r => r.tag_id),
      };
    }),
  };
}
const saveUndo = (userId, snapshot) => db.prepare('INSERT INTO email_filing_undo (user_id, snapshot_json) VALUES (?, ?)').run(userId, JSON.stringify(snapshot)).lastInsertRowid;

router.post('/undo/:id', auth, (req, res) => {
  const row = db.prepare("SELECT * FROM email_filing_undo WHERE id = ? AND user_id = ? AND used_at IS NULL AND created_at >= datetime('now', '-1 day')").get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'This filing can no longer be undone' });
  const snap = JSON.parse(row.snapshot_json);
  const restored = [];
  db.transaction(() => {
    for (const m of snap.messages) {
      const cur = db.prepare('SELECT id, subject FROM email_messages WHERE id = ?').get(m.id);
      if (!cur) continue;
      const subject = cur.subject || '(no subject)';
      // Links added since the snapshot: end them, as the system would.
      for (const l of db.prepare('SELECT id, client_id FROM email_message_clients WHERE message_id = ? AND id > ? AND removed_at IS NULL').all(m.id, snap.max_link_id)) {
        db.prepare('UPDATE email_message_clients SET removed_at = CURRENT_TIMESTAMP, removed_by = NULL WHERE id = ?').run(l.id);
        audit.log('client', l.client_id, 'email_unfiled', `Filing undone: "${subject}"`);
      }
      // Links that were current before and have been ended since: bring them back.
      for (const lid of m.links) {
        const l = db.prepare('SELECT client_id, removed_at FROM email_message_clients WHERE id = ?').get(lid);
        if (l?.removed_at) {
          db.prepare('UPDATE email_message_clients SET removed_at = NULL, removed_by = NULL WHERE id = ?').run(lid);
          audit.log('client', l.client_id, 'email_filed', `Filing undone, email back on this client: "${subject}"`);
        }
      }
      db.prepare('UPDATE email_messages SET status = ?, not_client_reason = ?, filed_at = ?, filed_by = ?, actioned_at = ?, actioned_by = ? WHERE id = ?')
        .run(m.status, m.not_client_reason, m.filed_at, m.filed_by, m.actioned_at ?? null, m.actioned_by ?? null, m.id);
      tags.setTags(m.id, m.tags, req.user.id);
      restored.push(m.id);
    }
    db.prepare('UPDATE email_filing_undo SET used_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);
  })();
  const unfiled = restored.filter(id => db.prepare("SELECT 1 FROM email_messages WHERE id = ? AND status = 'unfiled'").get(id));
  if (unfiled.length) linking.refreshSuggestions({ messageIds: unfiled });
  res.json({ ok: true, restored });
});

// Everyone on an email except the practice itself — after filing, other unfiled emails with the
// same people get their suggestions worked out again (they may now match on history).
function refreshForMessages(messageIds) {
  const addrs = new Set();
  for (const id of messageIds) {
    const m = db.prepare('SELECT * FROM email_messages WHERE id = ?').get(id);
    if (m) for (const a of linking.otherPartyAddresses(m)) addrs.add(a);
  }
  if (addrs.size) linking.refreshSuggestions({ addresses: [...addrs] });
}

// { client_ids, tag_ids, no_client } — see fileOne. tag_ids left out keeps the email's tags.
router.post('/messages/:id/file', auth, (req, res) => {
  const ids = validClientIds(req.body.client_ids);
  if (!ids) return res.status(400).json({ error: 'Unknown client' });
  const tagIds = req.body.tag_ids === undefined ? null : validTagIds(req.body.tag_ids);
  if (tagIds === null && req.body.tag_ids !== undefined) return res.status(400).json({ error: 'Unknown tag' });
  let undoId = null;
  const result = db.transaction(() => {
    const snapshot = snapshotForFiling([Number(req.params.id)]);
    const r = fileOne(Number(req.params.id), ids, req.user.id, { tagIds, noClient: !!req.body.no_client });
    if (r) { markActioned([Number(req.params.id)], req.user.id); undoId = saveUndo(req.user.id, snapshot); }
    return r;
  })();
  if (!result) return res.status(404).json({ error: 'Email not found' });
  refreshForMessages([Number(req.params.id)]);
  res.json({ ...loadMessage(req.params.id), also_filed: result.alsoFiled, undo_id: undoId, contact_offer: ids.length ? linking.contactOffer(Number(req.params.id), ids) : null });
});

// Several emails at once: file them all to the same clients (or as "No client"), and/or add tags
// to them all (added to what each already has).
router.post('/bulk', auth, (req, res) => {
  const messageIds = [...new Set((req.body.message_ids || []).map(Number).filter(Boolean))].slice(0, 500);
  if (!messageIds.length) return res.status(400).json({ error: 'No emails selected' });
  const ids = validClientIds(req.body.client_ids);
  const tagIds = validTagIds(req.body.tag_ids);
  if (!ids) return res.status(400).json({ error: 'Unknown client' });
  if (!tagIds) return res.status(400).json({ error: 'Unknown tag' });
  const noClient = !!req.body.no_client;
  const done = req.body.done === true;
  if (!ids.length && !noClient && !tagIds.length && !done) return res.status(400).json({ error: 'Choose a client, No client, a tag, or Done' });
  let undoId = null;
  db.transaction(() => {
    undoId = saveUndo(req.user.id, snapshotForFiling(messageIds));
    for (const id of messageIds) {
      if (ids.length || noClient) fileOne(id, ids, req.user.id, { noClient });
      if (ids.length || noClient || done) markActioned([id], req.user.id);
      if (tagIds.length) {
        const have = db.prepare('SELECT tag_id FROM email_message_tags WHERE message_id = ?').all(id).map(r => r.tag_id);
        tags.setTags(id, [...new Set([...have, ...tagIds])], req.user.id);
      }
    }
  })();
  refreshForMessages(messageIds);
  res.json({ ok: true, count: messageIds.length, undo_id: undoId });
});

// "Add as contact" after filing: the email's sender (or recipient) becomes a contact of each
// chosen client, and other unfiled emails from them pick up the new match.
router.post('/contacts', auth, (req, res) => {
  const ids = validClientIds(req.body.client_ids);
  if (!ids || !ids.length) return res.status(400).json({ error: 'Choose at least one client' });
  const { contact, error } = contacts.normalise(req.body);
  if (error) return res.status(400).json({ error });
  if (!contact.email) return res.status(400).json({ error: 'An email address is needed' });
  db.transaction(() => {
    for (const cid of ids) {
      const exists = db.prepare('SELECT 1 FROM client_contacts WHERE client_id = ? AND active = 1 AND LOWER(TRIM(email)) = LOWER(?)').get(cid, contact.email);
      if (exists) continue;
      contacts.insert(cid, contact);
      contacts.syncLegacyFields(cid);
      audit.log('client', cid, 'contact_added', `Added contact ${contacts.describe(contact)} (from an email)`);
    }
  })();
  const refreshed = linking.refreshSuggestions({ addresses: [contact.email] });
  res.status(201).json({ ok: true, refreshed });
});

// ─── Writing and sending ──────────────────────────────────────────────────────

// Files attached while writing an email. Stored until sent (and kept with the sent email).
router.post('/uploads', auth, upload.array('files'), async (req, res) => {
  try {
    const out = [];
    for (const f of req.files || []) {
      const key = `outgoing/${crypto.createHash('sha256').update(f.buffer).digest('hex')}`;
      await store.put(key, f.buffer, f.mimetype || 'application/octet-stream');
      const id = db.prepare('INSERT INTO email_uploads (filename, content_type, size, storage_key, created_by) VALUES (?, ?, ?, ?, ?)')
        .run(f.originalname, f.mimetype || null, f.size, key, req.user.id).lastInsertRowid;
      out.push({ id, filename: f.originalname, size: f.size, content_type: f.mimetype });
    }
    res.status(201).json(out);
  } catch (e) {
    console.error('Email upload failed:', e.message);
    res.status(500).json({ error: 'Could not upload the file' });
  }
});

// People to send to, for the To/Cc boxes: the chosen clients' contacts first, then anyone on file
// or who has emailed the practice.
router.get('/recipients', auth, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const clientIds = String(req.query.client_ids || '').split(',').map(Number).filter(Boolean);
  const out = new Map();
  const add = (address, name, label) => {
    const a = (address || '').trim().toLowerCase();
    if (!a || out.has(a)) return;
    if (q && !a.includes(q) && !(name || '').toLowerCase().includes(q)) return;
    out.set(a, { address: a, name: name || '', label });
  };
  if (clientIds.length) {
    const ph = clientIds.map(() => '?').join(',');
    for (const c of db.prepare(`SELECT cc.email, cc.name, cc.relationship, cc.role, c.first_name FROM client_contacts cc JOIN clients c ON c.id = cc.client_id
      WHERE cc.active = 1 AND cc.email IS NOT NULL AND cc.client_id IN (${ph}) ORDER BY cc.is_primary DESC`).all(...clientIds)) {
      add(c.email, c.name, `${c.first_name}'s ${c.relationship || c.role.replace('_', ' ')}`);
    }
    for (const c of db.prepare(`SELECT email, first_name, last_name FROM clients WHERE email IS NOT NULL AND email != '' AND id IN (${ph})`).all(...clientIds)) {
      add(c.email, `${c.first_name} ${c.last_name}`, 'Client');
    }
  }
  if (q.length >= 2) {
    const like = `%${q}%`;
    for (const c of db.prepare(`SELECT cc.email, cc.name, c.first_name FROM client_contacts cc JOIN clients c ON c.id = cc.client_id
      WHERE cc.active = 1 AND c.merged_into IS NULL AND cc.email IS NOT NULL AND (LOWER(cc.email) LIKE ? OR LOWER(cc.name) LIKE ?) LIMIT 15`).all(like, like)) add(c.email, c.name, `Contact of ${c.first_name}`);
    for (const c of db.prepare(`SELECT email, first_name, last_name FROM clients WHERE merged_into IS NULL AND email IS NOT NULL AND email != '' AND (LOWER(email) LIKE ? OR LOWER(first_name || ' ' || last_name) LIKE ?) LIMIT 10`).all(like, like)) add(c.email, `${c.first_name} ${c.last_name}`, 'Client');
    for (const f of db.prepare("SELECT email, name FROM funds_managers WHERE email IS NOT NULL AND email != '' AND (LOWER(email) LIKE ? OR LOWER(name) LIKE ?) LIMIT 10").all(like, like)) add(f.email, f.name, 'Funds manager');
    for (const p of db.prepare("SELECT email, first_name, last_name FROM practitioners WHERE email IS NOT NULL AND email != '' AND active = 1 AND (LOWER(email) LIKE ? OR LOWER(first_name || ' ' || last_name) LIKE ?) LIMIT 10").all(like, like)) add(p.email, `${p.first_name} ${p.last_name}`, 'Staff');
    for (const m of db.prepare(`SELECT from_address, from_name, MAX(received_at) last FROM email_messages WHERE direction = 'in' AND (LOWER(from_address) LIKE ? OR LOWER(from_name) LIKE ?)
      GROUP BY LOWER(from_address) ORDER BY last DESC LIMIT 10`).all(like, like)) add(m.from_address, m.from_name, 'Has emailed us');
  }
  res.json([...out.values()].slice(0, 20));
});

// The signed-in person's signature, added to the emails they write.
router.get('/signature', auth, (req, res) => {
  res.json({ html: db.prepare('SELECT email_signature FROM practitioners WHERE id = ?').get(req.user.id)?.email_signature || '' });
});
router.put('/signature', auth, (req, res) => {
  const html = String(req.body.html || '').slice(0, 20000);
  db.prepare('UPDATE practitioners SET email_signature = ? WHERE id = ?').run(html || null, req.user.id);
  res.json({ html });
});

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
function cleanRecipients(list) {
  return (Array.isArray(list) ? list : []).map(r => ({ address: String(r.address || '').trim().toLowerCase(), name: String(r.name || '').trim().slice(0, 100) }))
    .filter(r => r.address);
}

// Send (after the undo delay): { mode: new|reply|replyAll|forward, source_id, to, cc, bcc, subject,
// html, upload_ids, client_ids, no_client, tag_ids }. Must say which clients it's about, or "no client".
router.post('/send', auth, (req, res) => {
  let mailbox;
  try { mailbox = mailSend.sendingMailbox(); } catch (e) { return res.status(400).json({ error: e.message }); }
  const b = req.body;
  const mode = ['new', 'reply', 'replyAll', 'forward'].includes(b.mode) ? b.mode : 'new';
  const to = cleanRecipients(b.to), cc = cleanRecipients(b.cc), bcc = cleanRecipients(b.bcc);
  const bad = [...to, ...cc, ...bcc].find(r => !EMAIL_RE.test(r.address));
  if (bad) return res.status(400).json({ error: `"${bad.address}" isn't a valid email address` });
  if (!to.length) return res.status(400).json({ error: 'Add at least one recipient' });
  if (!String(b.subject || '').trim() && mode === 'new') return res.status(400).json({ error: 'Add a subject' });
  const clientIds = validClientIds(b.client_ids);
  if (!clientIds) return res.status(400).json({ error: 'Unknown client' });
  if (!clientIds.length && !b.no_client) return res.status(400).json({ error: 'Choose which client this email is about, or "No client"' });
  const tagIds = validTagIds(b.tag_ids);
  if (!tagIds) return res.status(400).json({ error: 'Unknown tag' });
  const uploadIds = [...new Set((b.upload_ids || []).map(Number).filter(Boolean))];
  if (uploadIds.length && db.prepare(`SELECT COUNT(*) n FROM email_uploads WHERE id IN (${uploadIds.map(() => '?').join(',')})`).get(...uploadIds).n !== uploadIds.length) {
    return res.status(400).json({ error: 'An attachment is missing — please attach it again' });
  }
  const source = b.source_id ? db.prepare('SELECT id FROM email_messages WHERE id = ?').get(b.source_id) : null;
  if (mode !== 'new' && !source) return res.status(400).json({ error: 'The email being replied to was not found' });
  const payload = {
    mode, source_id: source?.id || null, to, cc, bcc, subject: String(b.subject || '').slice(0, 300),
    html: String(b.html || ''), upload_ids: uploadIds, client_ids: clientIds, no_client: !clientIds.length, tag_ids: tagIds,
    // What happens to the task afterwards: waiting (follow up on a date), done, keep as to do, or none.
    task_choice: ['waiting', 'done', 'todo', 'none'].includes(b.task_choice?.status)
      ? { status: b.task_choice.status, follow_up_at: /^\d{4}-\d{2}-\d{2}$/.test(b.task_choice.follow_up_at || '') ? b.task_choice.follow_up_at : null }
      : null,
  };
  // Scheduled for a chosen time, or (normally) sent after the Undo delay.
  let sendAt, scheduled = 0;
  if (b.send_at) {
    const when = new Date(b.send_at);
    if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() + 60 * 1000) return res.status(400).json({ error: 'Pick a time at least a minute from now' });
    if (when.getTime() > Date.now() + 366 * 24 * 3600 * 1000) return res.status(400).json({ error: 'Pick a time within the next year' });
    sendAt = when.toISOString();
    scheduled = 1;
  } else {
    const delay = Math.max(0, Math.min(Number(b.delay_seconds ?? mailSend.UNDO_SECONDS), 60));
    sendAt = new Date(Date.now() + delay * 1000).toISOString();
    setTimeout(() => mailSend.processOutbox().catch(() => {}), delay * 1000 + 200);
  }
  // An edited scheduled email replaces the original — only if the original hasn't gone yet.
  const replaces = Number(b.replaces_outbox_id) || null;
  const id = db.transaction(() => {
    if (replaces && !db.prepare("UPDATE email_outbox SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").run(replaces).changes) {
      return null;
    }
    return db.prepare('INSERT INTO email_outbox (mailbox, payload, send_at, scheduled, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(mailbox, JSON.stringify(payload), sendAt, scheduled, req.user.id).lastInsertRowid;
  })();
  if (!id) return res.status(409).json({ error: 'The original scheduled email has already been sent (or cancelled), so this edit was not sent. Check Sent Items.' });
  res.status(201).json({ id, send_at: sendAt, scheduled: !!scheduled });
});

// Emails waiting, sending or failed — for the Undo bar and the "couldn't send" notice.
// The email as written, with its attachments' names — for reopening it to edit or resend.
function editablePayload(payloadJson) {
  const p = JSON.parse(payloadJson);
  const ids = p.upload_ids || [];
  p.uploads = ids.length ? db.prepare(`SELECT id, filename, size FROM email_uploads WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) : [];
  return p;
}

router.get('/outbox', auth, (req, res) => {
  const rows = db.prepare(`SELECT o.id, o.payload, o.send_at, o.status, o.error, o.created_by, o.sent_message_id, o.updated_at, o.scheduled,
      p.first_name || ' ' || p.last_name AS created_by_name
    FROM email_outbox o LEFT JOIN practitioners p ON p.id = o.created_by
    WHERE o.status IN ('pending', 'sending', 'failed') OR (o.status = 'sent' AND o.updated_at >= datetime('now', '-1 minute'))
    ORDER BY o.send_at, o.id LIMIT 200`).all();
  res.json(rows.map(r => {
    const p = JSON.parse(r.payload);
    const clientIds = p.client_ids || [];
    const clientNames = clientIds.length ? db.prepare(`SELECT first_name, last_name, active FROM clients WHERE id IN (${clientIds.map(() => '?').join(',')})`).all(...clientIds).map(clientName) : [];
    return { id: r.id, status: r.status, error: r.error, send_at: r.send_at, scheduled: !!r.scheduled, sent_message_id: r.sent_message_id,
      mine: r.created_by === req.user.id, created_by_name: r.created_by_name, clients: clientNames,
      subject: p.subject, to: p.to, mode: p.mode, source_id: p.source_id,
      payload: r.status === 'failed' || r.scheduled ? editablePayload(r.payload) : undefined };
  }));
});

// A scheduled email: send it now instead of at its time.
router.post('/outbox/:id/send-now', auth, (req, res) => {
  const changed = db.prepare("UPDATE email_outbox SET send_at = ?, scheduled = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'")
    .run(new Date().toISOString(), req.params.id).changes;
  if (!changed) return res.status(409).json({ error: 'This email is no longer waiting to be sent' });
  setTimeout(() => mailSend.processOutbox().catch(() => {}), 200);
  res.json({ ok: true });
});

// Undo: only while it hasn't started sending.
router.post('/outbox/:id/cancel', auth, (req, res) => {
  const changed = db.prepare("UPDATE email_outbox SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").run(req.params.id).changes;
  if (!changed) return res.status(409).json({ error: 'Too late — it has already been sent' });
  res.json({ ok: true, payload: editablePayload(db.prepare('SELECT payload FROM email_outbox WHERE id = ?').get(req.params.id).payload) });
});

// A failed email: try again now, or give up on it.
router.post('/outbox/:id/retry', auth, (req, res) => {
  const changed = db.prepare("UPDATE email_outbox SET status = 'pending', error = NULL, send_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'failed'")
    .run(new Date().toISOString(), req.params.id).changes;
  if (!changed) return res.status(409).json({ error: 'This email is not waiting to be retried' });
  setTimeout(() => mailSend.processOutbox().catch(() => {}), 200);
  res.json({ ok: true });
});
router.post('/outbox/:id/discard', auth, (req, res) => {
  const changed = db.prepare("UPDATE email_outbox SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'failed'").run(req.params.id).changes;
  if (!changed) return res.status(409).json({ error: 'This email is not in the failed list' });
  res.json({ ok: true });
});

module.exports = router;
