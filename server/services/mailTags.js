// Email tags: what an email is about, independent of which clients it's filed to.
//
// Suggestions come from words in the subject (strong) or the email's own text (weaker — quoted
// earlier emails are ignored), attachment names, the newsletter check, a tag's own name in the
// subject (for tags staff added), and the tags this person's earlier emails were given. Strong
// suggestions start selected when filing; the rest are offered with one click.
const db = require('../database');

const lower = s => (s || '').trim().toLowerCase();

// Words that point at the built-in tags (matched as whole words, case-insensitive).
const KEYWORDS = {
  invoice: ['invoice', 'invoices', 'inv', 'payment', 'payments', 'paid', 'unpaid', 'remittance', 'receipt', 'overdue', 'statement',
    'amount due', 'balance owing', 'reimbursement', 'refund', 'myob', 'plan manager claim', 'claim'],
  referral: ['referral', 'referrals', 'refer', 'referring', 'new client', 'intake', 'waitlist', 'wait list', 'waiting list', 'enquiry', 'inquiry',
    'capacity to take', 'availability for a new'],
  appointment: ['appointment', 'appointments', 'reschedule', 'rescheduling', 'cancel', 'cancellation', 'cancelled', 'booking', 'book in',
    'next session', 'session time', 'running late', 'postpone', 'confirm the time'],
  report: ['report', 'reports', 'progress report', 'assessment report', 'end of plan report', 'summary report', 'draft report'],
  equipment: ['quote', 'quotation', 'equipment', 'hire', 'trial', 'wheelchair', 'assistive technology', 'at request', 'home modification',
    'modifications', 'scooter', 'walker', 'commode', 'shower chair', 'hoist'],
  funding: ['plan review', 'ndis plan', 'funding', 'budget', 'service agreement', 'plan reassessment', 'change of circumstances',
    'plan dates', 'plan approved', 'capacity building'],
};
const keywordRes = Object.fromEntries(Object.entries(KEYWORDS).map(([key, words]) => [key,
  new RegExp(`(?<![\\p{L}\\p{N}])(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')).join('|')})(?![\\p{L}\\p{N}])`, 'iu')]));

// The email's own words: stop at the first quoted earlier email.
function ownText(body) {
  const text = (body || '').slice(0, 20000);
  const cut = text.search(/\n\s*(-{2,}\s*Original Message|From:\s.+\n\s*(Sent|Date):|On .{5,80} wrote:)/i);
  return (cut > 0 ? text.slice(0, cut) : text).split('\n').filter(l => !/^\s*>/.test(l)).join('\n').slice(0, 5000);
}

function listTags({ activeOnly = true } = {}) {
  return db.prepare(`SELECT id, key, name, color, active FROM email_tags ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort_order, name COLLATE NOCASE`).all();
}

// addresses: the other party's addresses (see mailLinking.otherPartyAddresses).
function computeTagSuggestions(msg, addresses) {
  const tags = listTags();
  const byKey = Object.fromEntries(tags.filter(t => t.key).map(t => [t.key, t]));
  const out = [];
  const subject = msg.subject || '';
  const body = ownText(msg.body_text);
  for (const [key, re] of Object.entries(keywordRes)) {
    const tag = byKey[key];
    if (!tag) continue;
    const s = re.exec(subject);
    if (s) { out.push({ tag_id: tag.id, reason: 'subject', detail: s[1], strong: 1 }); continue; }
    const b = re.exec(body);
    if (b) out.push({ tag_id: tag.id, reason: 'body', detail: b[1], strong: 0 });
  }
  // Tags staff added: their name in the subject.
  for (const t of tags.filter(t => !t.key)) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${t.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu');
    if (re.test(subject)) out.push({ tag_id: t.id, reason: 'subject', detail: t.name, strong: 1 });
  }
  if (byKey.invoice) {
    const att = db.prepare("SELECT filename FROM email_attachments WHERE message_id = ? AND is_inline = 0 AND (LOWER(filename) LIKE '%invoice%' OR LOWER(filename) LIKE '%remittance%' OR LOWER(filename) LIKE '%receipt%' OR LOWER(filename) LIKE '%statement%')").get(msg.id);
    if (att) out.push({ tag_id: byKey.invoice.id, reason: 'attachment', detail: att.filename, strong: 1 });
  }
  if (byKey.equipment) {
    const att = db.prepare("SELECT filename FROM email_attachments WHERE message_id = ? AND is_inline = 0 AND LOWER(filename) LIKE '%quote%'").get(msg.id);
    if (att) out.push({ tag_id: byKey.equipment.id, reason: 'attachment', detail: att.filename, strong: 1 });
  }
  if (byKey.marketing && msg.auto_hint) out.push({ tag_id: byKey.marketing.id, reason: 'newsletter', detail: null, strong: 1 });
  // What this person's earlier emails were tagged: strong once it's happened twice.
  for (const addr of addresses) {
    const like = `%"address":"${addr.replace(/[%_"\\]/g, '')}"%`;
    for (const r of db.prepare(`
      SELECT t.tag_id, COUNT(DISTINCT m.id) n FROM email_messages m JOIN email_message_tags t ON t.message_id = m.id
      JOIN email_tags g ON g.id = t.tag_id AND g.active = 1
      WHERE m.id != ? AND m.status != 'unfiled' AND (LOWER(m.from_address) = ? OR LOWER(m.to_json) LIKE ? OR LOWER(m.cc_json) LIKE ?)
      GROUP BY t.tag_id
    `).all(msg.id, addr, like, like)) {
      out.push({ tag_id: r.tag_id, reason: 'history', detail: String(r.n), strong: r.n >= 2 ? 1 : 0 });
    }
  }
  return out;
}

function writeTagSuggestions(messageId, list) {
  db.prepare('DELETE FROM email_tag_suggestions WHERE message_id = ?').run(messageId);
  const add = db.prepare('INSERT OR IGNORE INTO email_tag_suggestions (message_id, tag_id, reason, detail, strong) VALUES (?, ?, ?, ?, ?)');
  for (const s of list) add.run(messageId, s.tag_id, s.reason, s.detail, s.strong);
}

// Replace an email's tags with exactly tagIds.
function setTags(messageId, tagIds, userId = null) {
  const want = new Set(tagIds.map(Number));
  const have = new Set(db.prepare('SELECT tag_id FROM email_message_tags WHERE message_id = ?').all(messageId).map(r => r.tag_id));
  for (const id of have) if (!want.has(id)) db.prepare('DELETE FROM email_message_tags WHERE message_id = ? AND tag_id = ?').run(messageId, id);
  const add = db.prepare('INSERT OR IGNORE INTO email_message_tags (message_id, tag_id, added_by) VALUES (?, ?, ?)');
  for (const id of want) if (!have.has(id)) add.run(messageId, id, userId);
}

// Tags and tag suggestions for a set of emails, keyed by message id.
function tagsFor(ids) {
  const out = new Map(ids.map(id => [id, { tags: [], tag_suggestions: [] }]));
  if (!ids.length) return out;
  const ph = ids.map(() => '?').join(',');
  for (const r of db.prepare(`SELECT mt.message_id, t.id, t.name, t.color FROM email_message_tags mt JOIN email_tags t ON t.id = mt.tag_id
    WHERE mt.message_id IN (${ph}) ORDER BY t.sort_order, t.name`).all(...ids)) {
    out.get(r.message_id).tags.push({ id: r.id, name: r.name, color: r.color });
  }
  for (const r of db.prepare(`SELECT s.message_id, s.reason, s.detail, s.strong, t.id, t.name, t.color FROM email_tag_suggestions s
    JOIN email_tags t ON t.id = s.tag_id AND t.active = 1 WHERE s.message_id IN (${ph}) ORDER BY t.sort_order`).all(...ids)) {
    const list = out.get(r.message_id).tag_suggestions;
    let e = list.find(x => x.id === r.id);
    if (!e) list.push(e = { id: r.id, name: r.name, color: r.color, strong: false, reasons: [] });
    e.strong = e.strong || !!r.strong;
    e.reasons.push({ reason: r.reason, detail: r.detail });
  }
  return out;
}

module.exports = { listTags, computeTagSuggestions, writeTagSuggestions, setTags, tagsFor, ownText };
