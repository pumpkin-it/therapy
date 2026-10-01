// Filing emails against clients.
//
// A new email is filed automatically only by the thread rule: a reply in a conversation whose
// earlier emails are filed to exactly one client goes to that client. Everything else stays
// Unfiled with suggested clients, from:
//   - the other party's address: a client's own email, a client contact, a self-managed funding
//     email, a funds manager;
//   - history: clients this address's earlier emails were filed to;
//   - the client's full name appearing in the subject or body, or just their first name when that
//     client is already linked to the email some other way (or no other client has that name);
//   - the Outlook folder the email sits in (a folder named after a client).
// Staff confirm those by hand. The practice's own addresses and staff logins are never matched.
const db = require('../database');
const tags = require('./mailTags');
const tasks = require('./tasks');

const lower = s => (s || '').trim().toLowerCase();
const parseList = json => { try { return JSON.parse(json || '[]') || []; } catch { return []; } };
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Personal webmail — used to guess a new contact's role (family rather than an organisation).
const PUBLIC_DOMAINS = new Set(['gmail.com', 'hotmail.com', 'outlook.com', 'live.com', 'live.com.au', 'yahoo.com', 'yahoo.com.au',
  'icloud.com', 'me.com', 'bigpond.com', 'bigpond.net.au', 'optusnet.com.au', 'hotmail.com.au', 'outlook.com.au', 'msn.com', 'protonmail.com']);

// The practice's own addresses (the mailbox, the sending and practice addresses in settings) and
// staff logins. Exact addresses only — other people at the same domain are outside parties.
function makeIsInternal(mailbox) {
  const setting = k => lower(db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value || '');
  const own = new Set([lower(mailbox), setting('graph_mailbox'), setting('practice_email')].filter(Boolean));
  for (const r of db.prepare("SELECT LOWER(email) e FROM practitioners WHERE email IS NOT NULL AND email != ''").all()) own.add(r.e);
  return addr => { const a = lower(addr); return !a || own.has(a); };
}

// Earlier emails in the same conversation: same Outlook conversation, or referenced by
// In-Reply-To / References.
function threadSiblings(msg) {
  const refs = [msg.in_reply_to, ...(msg.references_header || '').split(/\s+/)].map(s => (s || '').trim()).filter(Boolean);
  const where = [];
  const params = [];
  if (msg.conversation_id) { where.push('conversation_id = ?'); params.push(msg.conversation_id); }
  if (refs.length) { where.push(`internet_message_id IN (${refs.map(() => '?').join(',')})`); params.push(...refs); }
  if (!where.length) return [];
  return db.prepare(`SELECT id, status FROM email_messages WHERE mailbox = ? AND id != ? AND (${where.join(' OR ')})`)
    .all(msg.mailbox, msg.id, ...params);
}

function linkedClientIds(messageIds) {
  if (!messageIds.length) return [];
  return db.prepare(`
    SELECT DISTINCT client_id FROM email_message_clients
    WHERE removed_at IS NULL AND message_id IN (${messageIds.map(() => '?').join(',')})
  `).all(...messageIds).map(r => r.client_id);
}

// Addresses of the people on the other side: the sender for incoming mail, the recipients for
// mail we sent — never the practice's own addresses.
function otherPartyAddresses(msg, isInternal = makeIsInternal(msg.mailbox)) {
  const list = msg.direction === 'out'
    ? [...parseList(msg.to_json), ...parseList(msg.cc_json), ...parseList(msg.bcc_json)].map(r => r.address)
    : [msg.from_address, ...parseList(msg.reply_to_json).map(r => r.address)];
  return [...new Set(list.map(lower).filter(a => a && !isInternal(a)))];
}

// Real clients: not test data, and not a duplicate that was merged into another client.
const REAL_CLIENT = '(c.is_test_data IS NULL OR c.is_test_data = 0) AND c.merged_into IS NULL';

function addressSuggestions(addresses) {
  const out = [];
  for (const addr of addresses) {
    for (const r of db.prepare(`SELECT c.id FROM clients c WHERE ${REAL_CLIENT} AND LOWER(TRIM(c.email)) = ?`).all(addr)) {
      out.push({ client_id: r.id, reason: 'client_email', detail: addr });
    }
    for (const r of db.prepare(`
      SELECT cc.client_id, cc.name, cc.relationship FROM client_contacts cc JOIN clients c ON c.id = cc.client_id
      WHERE ${REAL_CLIENT} AND cc.active = 1 AND LOWER(TRIM(cc.email)) = ?
    `).all(addr)) {
      out.push({ client_id: r.client_id, reason: 'contact', detail: r.relationship ? `${r.name} (${r.relationship})` : r.name });
    }
    for (const r of db.prepare(`
      SELECT DISTINCT fp.client_id FROM funding_periods fp JOIN clients c ON c.id = fp.client_id
      WHERE ${REAL_CLIENT} AND LOWER(TRIM(fp.self_managed_email)) = ?
    `).all(addr)) {
      out.push({ client_id: r.client_id, reason: 'client_email', detail: `${addr} (self-managed funding)` });
    }
    // A funds/plan manager usually manages many clients: suggest the ones whose funding with
    // them is current or ended within the last year.
    for (const r of db.prepare(`
      SELECT DISTINCT fp.client_id, fm.name FROM funds_managers fm
      JOIN funding_periods fp ON fp.funds_manager_id = fm.id
      JOIN clients c ON c.id = fp.client_id
      WHERE ${REAL_CLIENT} AND LOWER(TRIM(fm.email)) = ?
        AND (fp.end_date IS NULL OR fp.end_date = '' OR DATE(fp.end_date) >= DATE('now', '-1 year'))
    `).all(addr)) {
      out.push({ client_id: r.client_id, reason: 'funds_manager', detail: r.name });
    }
  }
  return out;
}

// Clients that earlier emails with this address were filed to by people — how often, most first.
// Automatic filings don't count (the system mustn't learn from its own guesses).
function historySuggestions(addresses, excludeMessageId) {
  const counts = new Map();
  for (const addr of addresses) {
    const like = `%"address":"${addr.replace(/[%_"\\]/g, '')}"%`;
    for (const r of db.prepare(`
      SELECT l.client_id, COUNT(DISTINCT m.id) n FROM email_messages m
      JOIN email_message_clients l ON l.message_id = m.id AND l.removed_at IS NULL AND l.method != 'auto'
      JOIN clients c ON c.id = l.client_id
      WHERE ${REAL_CLIENT} AND m.id != ? AND m.status = 'filed'
        AND (LOWER(m.from_address) = ? OR LOWER(m.to_json) LIKE ? OR LOWER(m.cc_json) LIKE ?)
      GROUP BY l.client_id
    `).all(excludeMessageId, addr, like, like)) {
      counts.set(r.client_id, (counts.get(r.client_id) || 0) + r.n);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([client_id, n]) => ({ client_id, reason: 'history', detail: String(n) }));
}

// A client named in full ("Katie Smith", "Smith, Katie") in the subject or body.
// First names that are also everyday words: only matched for a client already linked to the email.
const COMMON_WORD_NAMES = new Set(['will', 'may', 'grace', 'hope', 'joy', 'faith', 'bill', 'mark', 'rose', 'jack', 'art', 'sunny',
  'summer', 'april', 'june', 'august', 'dawn', 'eve', 'faye', 'honey', 'ivy', 'lily', 'max', 'miles', 'pat', 'penny', 'ray', 'rich',
  'rob', 'sandy', 'skye', 'sue', 'ted', 'terry', 'violet', 'win', 'wren', 'autumn', 'amber', 'ruby', 'pearl', 'river', 'storm']);
let nameCache = { at: 0, list: [] };
// How a stored name is written in emails: parts may be run together, spaced or hyphenated
// ("TianYun" = "Tian Yun", "ManNa" = "Man Na", "Yong-Sheng" = "Yong Sheng"); a nickname in brackets
// ("TianYun (Jupiter)") counts as a first name too, and so does the first given name alone
// ("Alexander Kaizeng" → "Alexander").
const nameParts = s => s.split(/[\s-]+/).flatMap(w => w.split(/(?<=\p{Ll})(?=\p{Lu})/u)).filter(Boolean);
const flexName = s => nameParts(s).map(escapeRe).join('[\\s-]*');
const stripBrackets = s => (s || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
const bracketNames = s => [...(s || '').matchAll(/\(([^)]+)\)/g)].map(m => m[1].trim()).filter(Boolean);
const nameKey = s => lower(s).replace(/[\s-]+/g, '');
function clientNamePatterns() {
  if (Date.now() - nameCache.at < 60 * 1000) return nameCache.list;
  const rows = db.prepare(`SELECT c.id, c.first_name, c.last_name FROM clients c WHERE ${REAL_CLIENT}`).all();
  // First names to look for: the whole given name ("Man Na", "TianYun"), its first word when that's a
  // real name on its own ("Alexander" of "Alexander Kaizeng" — not "Man" of "Man Na"), and any nickname.
  const firstNamesOf = c => {
    const given = stripBrackets(c.first_name);
    const words = given.split(' ');
    const firstWord = words.length > 1 && words[0].length >= 4 ? words[0] : null;
    return [...new Set([given, firstWord, ...bracketNames(c.first_name)].filter(f => f && f.length >= 2))];
  };
  const tokenCount = new Map();
  for (const c of rows) for (const f of firstNamesOf(c)) tokenCount.set(nameKey(f), (tokenCount.get(nameKey(f)) || 0) + 1);
  const list = [];
  for (const c of rows) {
    const given = stripBrackets(c.first_name), last = stripBrackets(c.last_name);
    if (given.length < 2 && !bracketNames(c.first_name).length) continue;
    const firsts = firstNamesOf(c);
    const fullFirsts = [...new Set([given, ...firsts].filter(f => f && f.length >= 2))].map(flexName);
    const L = last.length >= 2 ? flexName(last) : null;
    const alts = L ? fullFirsts.flatMap(F => [`${F}\\s+${L}`, `${L},?\\s+${F}`]) : [];
    const firstAlts = firsts.filter(f => f.length >= 3).map(flexName);
    list.push({
      id: c.id,
      full: alts.length ? new RegExp(`(?<![\\p{L}\\p{N}])(${alts.join('|')})(?![\\p{L}\\p{N}])`, 'iu') : null,
      // A first name as a capitalised word ("Katie", not "katie" inside a sentence about something else).
      first: firstAlts.length ? new RegExp(`(?<![\\p{L}\\p{N}])(${firstAlts.join('|')})(?![\\p{L}\\p{N}])`, 'u') : null,
      uniqueFirst: firsts.some(f => tokenCount.get(nameKey(f)) === 1 && !COMMON_WORD_NAMES.has(lower(f))),
      isUnique: token => tokenCount.get(nameKey(token)) === 1 && !COMMON_WORD_NAMES.has(lower(token)),
    });
  }
  nameCache = { at: Date.now(), list };
  return list;
}
// linkedIds: clients already suggested for this email some other way (contact, history, folder…).
function nameSuggestions(msg, linkedIds = new Set()) {
  const text = `${msg.subject || ''}\n${(msg.body_text || '').slice(0, 20000)}`;
  const out = [];
  for (const p of clientNamePatterns()) {
    const m = p.full && p.full.exec(text);
    if (m) { out.push({ client_id: p.id, reason: 'name', detail: m[1].replace(/\s+/g, ' ') }); continue; }
    if (p.first && (linkedIds.has(p.id) || p.uniqueFirst)) {
      const f = p.first.exec(text);
      if (f && (linkedIds.has(p.id) || p.isUnique(f[1]))) out.push({ client_id: p.id, reason: 'first_name', detail: f[1] });
    }
  }
  return out;
}

// A client whose name matches the Outlook folder the email sits in ("Inbox/Katie Smith",
// "Clients/Smith, Katie").
function folderSuggestions(folderPath) {
  const leaf = lower((folderPath || '').split('/').pop()).replace(/\s+/g, ' ');
  if (!leaf || ['inbox', 'sent items', 'archive'].includes(leaf)) return [];
  return db.prepare(`
    SELECT c.id FROM clients c WHERE ${REAL_CLIENT} AND (
      LOWER(TRIM(c.first_name) || ' ' || TRIM(c.last_name)) = ? OR LOWER(TRIM(c.last_name) || ', ' || TRIM(c.first_name)) = ?
      OR LOWER(TRIM(c.last_name) || ' ' || TRIM(c.first_name)) = ?)
  `).all(leaf, leaf, leaf).map(r => ({ client_id: r.id, reason: 'folder', detail: folderPath }));
}

// Automated or bulk mail (newsletters, notifications): shown as a hint to mark it
// "Newsletter / marketing". Headers are only known when the email is first copied in.
const AUTOMATED_SENDER = /(^|[._-])(no-?reply|do-?not-?reply|newsletters?|news|mailer|mailer-daemon|notifications?|notify|marketing|bounces?|updates?|campaigns?)([._-]|@)/i;
function automatedHint(msg, headers) {
  if (headers) {
    // mailparser gathers List-Unsubscribe, List-Id etc. under 'list'.
    if (headers.has('list') || headers.has('list-unsubscribe') || headers.has('list-id')) return 'marketing';
    const precedence = lower(String(headers.get('precedence') || ''));
    if (['bulk', 'list', 'junk'].includes(precedence)) return 'marketing';
    const auto = lower(String(headers.get('auto-submitted') || ''));
    if (auto && auto !== 'no') return 'automated';
  }
  if (msg.direction === 'in' && AUTOMATED_SENDER.test(lower(msg.from_address))) return 'automated';
  return null;
}

const insertLink = () => db.prepare(`
  INSERT INTO email_message_clients (message_id, client_id, method, note, linked_by) VALUES (?, ?, ?, ?, ?)
`);

// (Re)work out the suggestions for one unfiled email. Thread suggestions are recomputed too.
function computeSuggestions(msg, isInternal) {
  const threadClients = linkedClientIds(threadSiblings(msg).map(s => s.id));
  const addresses = otherPartyAddresses(msg, isInternal);
  const linked = [
    ...threadClients.map(client_id => ({ client_id, reason: 'thread', detail: null })),
    ...addressSuggestions(addresses),
    ...historySuggestions(addresses, msg.id),
    ...folderSuggestions(msg.graph_folder_name),
  ];
  return {
    threadClients,
    list: [...linked, ...nameSuggestions(msg, new Set(linked.map(s => s.client_id)))],
    tagList: tags.computeTagSuggestions(msg, addresses),
  };
}

function writeSuggestions(messageId, list) {
  db.prepare('DELETE FROM email_link_suggestions WHERE message_id = ?').run(messageId);
  const add = db.prepare('INSERT OR IGNORE INTO email_link_suggestions (message_id, client_id, reason, detail) VALUES (?, ?, ?, ?)');
  for (const s of list) add.run(messageId, s.client_id, s.reason, s.detail);
}

// Runs once when an email is first copied in (inside the caller's transaction): file it if it can
// be (sent from Therapy, same conversation, or a certain match), else suggest — then its task.
function applyInitialLinks(messageId, { headers } = {}) {
  fileOnArrival(messageId, { headers });
  tasks.onEmailIngested(messageId);
  // Sent from Therapy but only copied in now: apply what the sender chose for its task.
  const sent = db.prepare('SELECT o.payload, o.created_by FROM email_outbox o JOIN email_messages m ON m.internet_message_id = o.internet_message_id WHERE m.id = ? AND o.sent_message_id = m.id').get(messageId);
  if (sent) {
    const p = JSON.parse(sent.payload);
    if (p.task_choice) tasks.applySendChoice(messageId, p.source_id, p.task_choice, sent.created_by);
  }
}

function fileOnArrival(messageId, { headers } = {}) {
  const msg = db.prepare('SELECT * FROM email_messages WHERE id = ?').get(messageId);
  if (!msg || msg.status !== 'unfiled') return;
  const hint = automatedHint(msg, headers);
  if (hint) { db.prepare('UPDATE email_messages SET auto_hint = ? WHERE id = ?').run(hint, msg.id); msg.auto_hint = hint; }
  // Sent from Therapy but not filed at the time (see services/mailSend.js): file it as chosen then.
  const sent = msg.internet_message_id && db.prepare("SELECT * FROM email_outbox WHERE internet_message_id = ? AND status = 'sent' AND sent_message_id IS NULL").get(msg.internet_message_id);
  if (sent) {
    const p = JSON.parse(sent.payload);
    const clientIds = (p.client_ids || []).map(Number);
    if (clientIds.length) setLinks(msg.id, clientIds, { userId: sent.created_by, method: 'outbound' });
    else if (p.no_client) markNotClient(msg.id, sent.created_by);
    if (p.tag_ids?.length) tags.setTags(msg.id, p.tag_ids, sent.created_by);
    db.prepare('UPDATE email_outbox SET sent_message_id = ? WHERE id = ?').run(msg.id, sent.id);
    if (clientIds.length || p.no_client) return;
  }
  const { threadClients, list, tagList } = computeSuggestions(msg, makeIsInternal(msg.mailbox));
  tags.writeTagSuggestions(msg.id, tagList);
  if (threadClients.length === 1) {
    insertLink().run(msg.id, threadClients[0], 'thread', null, null);
    db.prepare("UPDATE email_messages SET status = 'filed', filed_at = CURRENT_TIMESTAMP WHERE id = ?").run(msg.id);
    return;
  }
  writeSuggestions(msg.id, list);
  autoFile(msg.id, list);
}

// Filing without asking when the client is certain (settings.email_auto_file, on by default).
// Shown as "Auto-filed".
//   - The sender's address belongs to one client (their own email, a contact, or people have filed
//     its emails to that client at least twice) and no other client is named → that client.
//   - The address is shared — linked to two or more clients, e.g. an organisation's inbox; learnt
//     from people filing its emails to different clients — then only when exactly one client is
//     named in full in the email → that client.
function certainClient(list, addresses = []) {
  const linked = new Set(list.filter(s => s.reason === 'contact' || s.reason === 'client_email' || s.reason === 'history').map(s => s.client_id));
  const strong = new Set(list.filter(s => s.reason === 'contact' || s.reason === 'client_email' || (s.reason === 'history' && Number(s.detail) >= 2)).map(s => s.client_id));
  const fullNamed = new Set(list.filter(s => s.reason === 'name').map(s => s.client_id));
  const named = new Set(list.filter(s => s.reason === 'name' || s.reason === 'first_name').map(s => s.client_id));
  let cid = null;
  if (linked.size >= 2) {
    if (fullNamed.size === 1) [cid] = fullNamed;
  } else if (strong.size === 1) {
    [cid] = strong;
    if ([...named].some(id => id !== cid)) cid = null;
    // An organisation's address (not personal webmail) must name the client: a provider or support
    // coordinator usually writes about several people, even before that's been learnt.
    else if (!named.has(cid) && !(addresses.length && addresses.every(a => PUBLIC_DOMAINS.has(a.split('@')[1])))) cid = null;
  }
  if (!cid) return null;
  const c = db.prepare('SELECT active, merged_into FROM clients WHERE id = ?').get(cid);
  return c && c.active && !c.merged_into ? cid : null;
}
function autoFile(messageId, list) {
  if ((db.prepare("SELECT value FROM settings WHERE key = 'email_auto_file'").get()?.value || '1') !== '1') return false;
  // Never second-guess a person: an email someone has unfiled before stays theirs to file.
  if (db.prepare('SELECT 1 FROM email_message_clients WHERE message_id = ? AND removed_at IS NOT NULL AND removed_by IS NOT NULL').get(messageId)) return false;
  if (db.prepare("SELECT 1 FROM email_messages WHERE id = ? AND status != 'unfiled'").get(messageId)) return false;
  const msg = db.prepare('SELECT * FROM email_messages WHERE id = ?').get(messageId);
  const cid = certainClient(list, otherPartyAddresses(msg));
  if (!cid) return false;
  setLinks(messageId, [cid], { method: 'auto' });
  return true;
}

// Recompute suggestions — for every email, or for unfiled emails involving given addresses
// (after someone files an email or adds a contact, other emails from that person improve).
function refreshSuggestions({ addresses = null, messageIds = null } = {}) {
  let rows;
  if (messageIds) {
    if (!messageIds.length) return 0;
    rows = db.prepare(`SELECT * FROM email_messages WHERE status = 'unfiled' AND id IN (${messageIds.map(() => '?').join(',')})`).all(...messageIds);
  } else if (addresses) {
    const addrs = [...new Set(addresses.map(lower).filter(Boolean))];
    if (!addrs.length) return 0;
    const where = addrs.map(() => '(LOWER(from_address) = ? OR LOWER(to_json) LIKE ? OR LOWER(cc_json) LIKE ?)').join(' OR ');
    const params = addrs.flatMap(a => [a, `%"address":"${a.replace(/[%_"\\]/g, '')}"%`, `%"address":"${a.replace(/[%_"\\]/g, '')}"%`]);
    rows = db.prepare(`SELECT * FROM email_messages WHERE status = 'unfiled' AND (${where})`).all(...params);
  } else {
    // Everything (after a rule change): filed emails too, so their tag suggestions exist.
    rows = db.prepare('SELECT * FROM email_messages').all();
  }
  const checkers = new Map();
  for (const msg of rows) {
    if (!checkers.has(msg.mailbox)) checkers.set(msg.mailbox, makeIsInternal(msg.mailbox));
    if (!msg.auto_hint) {
      const hint = automatedHint(msg, null);
      if (hint) { db.prepare('UPDATE email_messages SET auto_hint = ? WHERE id = ?').run(hint, msg.id); msg.auto_hint = hint; }
    }
    const { list, tagList } = computeSuggestions(msg, checkers.get(msg.mailbox));
    writeSuggestions(msg.id, list);
    tags.writeTagSuggestions(msg.id, tagList);
    if (msg.status === 'unfiled') autoFile(msg.id, list);
  }
  return rows.length;
}

// After someone files an email, earlier-arrived Unfiled emails in the same conversation get the
// thread rule too (during the first import a whole conversation arrives before any of it is
// filed). Returns the ids that were filed.
function fileUnfiledSiblings(messageId) {
  const msg = db.prepare('SELECT * FROM email_messages WHERE id = ?').get(messageId);
  if (!msg) return [];
  const filed = [];
  for (const s of threadSiblings(msg).filter(s => s.status === 'unfiled')) {
    const sib = db.prepare('SELECT * FROM email_messages WHERE id = ?').get(s.id);
    const clients = linkedClientIds(threadSiblings(sib).map(x => x.id));
    if (clients.length === 1) {
      insertLink().run(sib.id, clients[0], 'thread', null, null);
      db.prepare("UPDATE email_messages SET status = 'filed', filed_at = CURRENT_TIMESTAMP WHERE id = ?").run(sib.id);
      filed.push(sib.id);
    } else {
      const add = db.prepare('INSERT OR IGNORE INTO email_link_suggestions (message_id, client_id, reason, detail) VALUES (?, ?, ?, ?)');
      for (const cid of clients) add.run(sib.id, cid, 'thread', null);
    }
  }
  return filed;
}

// File an email against one or more clients (replacing any previous links), or mark it as not
// client-related. Returns { added, removed } client ids for the audit log.
function setLinks(messageId, clientIds, { userId = null, method = 'manual', note = null } = {}) {
  const want = new Set(clientIds.map(Number));
  const current = db.prepare('SELECT id, client_id FROM email_message_clients WHERE message_id = ? AND removed_at IS NULL').all(messageId);
  const have = new Set(current.map(r => r.client_id));
  const removed = current.filter(r => !want.has(r.client_id));
  const added = [...want].filter(id => !have.has(id));
  for (const r of removed) {
    db.prepare('UPDATE email_message_clients SET removed_at = CURRENT_TIMESTAMP, removed_by = ? WHERE id = ?').run(userId, r.id);
  }
  const ins = insertLink();
  for (const cid of added) ins.run(messageId, cid, method, note, userId);
  if (want.size) {
    db.prepare("UPDATE email_messages SET status = 'filed', not_client_reason = NULL, filed_at = CURRENT_TIMESTAMP, filed_by = ? WHERE id = ?").run(userId, messageId);
    tasks.onEmailFiled(messageId, added, userId);
  } else {
    db.prepare("UPDATE email_messages SET status = 'unfiled', filed_at = NULL, filed_by = NULL WHERE id = ?").run(messageId);
    refreshSuggestions({ messageIds: [messageId] });
  }
  return { added, removed: removed.map(r => r.client_id) };
}

// Filed as not about any client ("No client"); its tags say what it is instead.
function markNotClient(messageId, userId = null) {
  const current = db.prepare('SELECT id FROM email_message_clients WHERE message_id = ? AND removed_at IS NULL').all(messageId);
  for (const r of current) {
    db.prepare('UPDATE email_message_clients SET removed_at = CURRENT_TIMESTAMP, removed_by = ? WHERE id = ?').run(userId, r.id);
  }
  db.prepare("UPDATE email_messages SET status = 'not_client', not_client_reason = NULL, filed_at = CURRENT_TIMESTAMP, filed_by = ? WHERE id = ?")
    .run(userId, messageId);
}

// After filing to clients: the other party, when they aren't yet on file for those clients, so
// the page can offer "Add Sally Coord as a contact for Katie?". Only for a single outside person.
function contactOffer(messageId, clientIds) {
  const msg = db.prepare('SELECT * FROM email_messages WHERE id = ?').get(messageId);
  if (!msg || !clientIds.length) return null;
  const isInternal = makeIsInternal(msg.mailbox);
  let person;
  if (msg.direction === 'in') person = { address: msg.from_address, name: msg.from_name };
  else {
    const to = [...parseList(msg.to_json), ...parseList(msg.cc_json)].filter(p => !isInternal(p.address));
    if (to.length !== 1) return null;
    person = to[0];
  }
  const addr = lower(person?.address);
  if (!addr || isInternal(addr) || AUTOMATED_SENDER.test(addr) || msg.auto_hint) return null;
  const known = new Set([
    ...db.prepare('SELECT client_id FROM client_contacts WHERE active = 1 AND LOWER(TRIM(email)) = ?').all(addr).map(r => r.client_id),
    ...db.prepare('SELECT id AS client_id FROM clients WHERE LOWER(TRIM(email)) = ?').all(addr).map(r => r.client_id),
  ]);
  const missing = clientIds.filter(id => !known.has(Number(id)));
  if (!missing.length) return null;
  const domain = addr.split('@')[1];
  const roleGuess = /(\.edu\.au|\.edu|school|college)$/.test(domain) || /school|college/.test(domain) ? 'school'
    : PUBLIC_DOMAINS.has(domain) ? 'family' : 'support_coordinator';
  const clients = db.prepare(`SELECT id, first_name, last_name FROM clients WHERE id IN (${missing.map(() => '?').join(',')})`).all(...missing)
    .map(c => ({ id: c.id, name: `${c.first_name} ${c.last_name}` }));
  return { email: addr, name: (person.name || '').trim(), organisation_hint: PUBLIC_DOMAINS.has(domain) ? '' : domain, role: roleGuess, clients };
}

module.exports = {
  applyInitialLinks, certainClient, autoFile, refreshSuggestions, fileUnfiledSiblings, setLinks, markNotClient, otherPartyAddresses,
  contactOffer, makeIsInternal,
};
