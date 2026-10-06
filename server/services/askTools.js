// The read-only lookups behind "Ask" (services/ask.js) and its command-line twin
// (scripts/ask/ask.js): find clients, a client's history, search everything on file, and read
// one record in full. The only thing written is the text store: text taken out of PDFs (client
// files, session-note attachments, email attachments, and PDFs inside old-system backup zips) is
// kept by services/documentText.js so each document is only read once.
const db = require('../database');

const docs = require('./documentText');
const { strip, isZip, fileText, noteFileText, attachmentText, zipEntries, zipEntryText } = docs;

const day = s => (s ? String(s).slice(0, 10) : '');
const ref = id => `C${String(id).padStart(4, '0')}`;
const clientName = c => `${c.first_name} ${c.last_name}`.trim();

// One document out of a backup zip, for opening it from an Ask answer.
async function zipEntryFile(fileId, index) {
  const f = db.prepare('SELECT * FROM client_files WHERE id = ?').get(fileId);
  if (!f || !isZip(f)) return null;
  const name = (await zipEntries(f))[index];
  if (!name) return null;
  const zip = await docs.loadZip(f);
  return { name: name.split('/').pop(), buffer: await zip.file(name).async('nodebuffer') };
}

// ---- forms and reports ----
function formText(r) {
  const t = db.prepare('SELECT name, schema_json FROM form_templates WHERE id = ?').get(r.form_template_id) || {};
  const labels = {};
  const walk = o => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (o && typeof o === 'object') {
      if (o.id && (o.label || o.title)) labels[o.id] = o.label || o.title;
      Object.values(o).forEach(walk);
    }
  };
  try { walk(JSON.parse(t.schema_json || '{}')); } catch {}
  let answers = {};
  try { answers = JSON.parse(r.answers_json || '{}'); } catch {}
  const lines = Object.entries(answers)
    .filter(([, v]) => v !== '' && v != null && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${labels[k] || k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  return { name: t.name, text: lines.join('\n') };
}
function reportText(r) {
  const v = db.prepare('SELECT content, version, committed_at FROM report_versions WHERE billable_report_id = ? ORDER BY version DESC LIMIT 1').get(r.id);
  if (v) return { text: strip(v.content), version: v.version, at: v.committed_at };
  const d = db.prepare('SELECT content, updated_at FROM report_drafts WHERE billable_report_id = ?').get(r.id);
  return { text: strip(d?.content), version: 'draft', at: d?.updated_at };
}

// ---- matching ----
const termsOf = q => [...new Set(String(q).toLowerCase().split(/[^\p{L}\p{N}.]+/u).filter(w => w.length > 1))];
function snippet(text, terms, width = 220) {
  const low = text.toLowerCase();
  const hits = terms.map(t => low.indexOf(t)).filter(i => i >= 0).sort((a, b) => a - b);
  if (!hits.length) return null;
  const parts = [];
  let last = -Infinity;
  for (const i of hits) {
    if (i < last + width) continue;
    parts.push(text.slice(Math.max(0, i - width / 2), i + width).replace(/\s+/g, ' '));
    last = i;
    if (parts.length >= 3) break;
  }
  return parts.join(' … ');
}
const score = (text, terms) => { const low = text.toLowerCase(); return terms.filter(t => low.includes(t)).length; };
// Whole-word match on a client's names, so "Shing" doesn't match "fishing".
function nameMatcher(c) {
  const names = [...termsOf(`${c.first_name} ${c.last_name}`.replace(/[()]/g, ' ')), `${c.first_name} ${c.last_name}`.toLowerCase()].filter(n => n.length >= 4);
  const res = names.map(n => new RegExp(`(^|[^\\p{L}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s-]+/g, '[\\s-]*')}([^\\p{L}]|$)`, 'iu'));
  return text => res.some(r => r.test(text));
}

// ---- tools ----
function findClients(query) {
  const words = termsOf(query);
  const norm = s => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const rows = db.prepare('SELECT id, first_name, last_name, active, merged_into, date_of_birth FROM clients').all();
  const found = rows.map(c => {
    const full = `${c.first_name} ${c.last_name}`.toLowerCase();
    return { s: words.filter(w => full.includes(w) || norm(full).includes(norm(w))).length, c };
  }).filter(x => x.s > 0).sort((a, b) => b.s - a.s || b.c.active - a.c.active).slice(0, 10);
  return found.map(({ c }) => ({
    client_id: c.id, ref: ref(c.id), name: clientName(c), active: !!c.active, dob: c.date_of_birth || null,
    ...(c.merged_into ? { merged_into: c.merged_into } : {}),
  }));
}

function clientEmails(clientId) {
  return db.prepare(`SELECT m.id, m.direction, m.from_name, m.from_address, m.subject, m.conversation_id, COALESCE(m.received_at, m.sent_at) AS at
    FROM email_messages m JOIN email_message_clients l ON l.message_id = m.id AND l.removed_at IS NULL WHERE l.client_id = ? ORDER BY at DESC`).all(clientId);
}

// Long histories: by default only the last 12 months are listed, with a count of older records,
// so a client with years of history costs about the same to look at as a new one. `from` / `to`
// (YYYY-MM-DD) widen or move the window.
const monthsAgo = n => { const d = new Date(); d.setMonth(d.getMonth() - n); return d.toISOString().slice(0, 10); };
const inWindow = (at, from, to) => (!from || day(at) >= from) && (!to || day(at) <= to);

async function clientTimeline(clientId, { canEmail }, { from = null, to = null } = {}) {
  const c = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
  if (!c) return { error: `No client with id ${clientId}` };
  const ev = [];
  for (const a of db.prepare(`SELECT a.id, a.start_time, a.status, a.title, a.notes, a.location, l.name AS loc, p.first_name || ' ' || p.last_name AS prac,
      (SELECT group_concat(COALESCE(s.name, ai.description), '; ') FROM appointment_items ai LEFT JOIN services s ON s.id = ai.service_id WHERE ai.appointment_id = a.id) AS services
      FROM appointments a LEFT JOIN locations l ON l.id = a.location_id LEFT JOIN practitioners p ON p.id = a.practitioner_id WHERE a.client_id = ?`).all(clientId)) {
    ev.push({ at: a.start_time, kind: 'appointment', id: a.id, text: [a.status, a.title, a.services, a.loc || a.location, a.prac, a.notes && strip(a.notes).slice(0, 120)].filter(Boolean).join(' | ') });
  }
  for (const n of db.prepare('SELECT id, created_at, appointment_id, note FROM session_notes WHERE client_id = ? AND COALESCE(archived,0) = 0').all(clientId)) {
    ev.push({ at: n.created_at, kind: 'note', id: n.id, text: `${n.appointment_id ? `appointment ${n.appointment_id}: ` : ''}${strip(n.note).slice(0, 140)}` });
  }
  for (const f of db.prepare('SELECT f.*, d.name AS folder FROM client_files f LEFT JOIN client_file_folders d ON d.id = f.folder_id WHERE f.client_id = ?').all(clientId)) {
    const label = [f.folder, f.label, f.original_name].filter(Boolean).join(' / ');
    if (isZip(f)) {
      const names = await zipEntries(f);
      ev.push({ at: f.created_at, kind: 'file', id: f.id, text: `${label} — backup with ${names.length} documents (read them as zip_entry ${f.id}:<number>): ${names.map((n, i) => `${i}=${n.split('/').slice(1).join('/')}`).filter(s => !/payments\/|invoices\//.test(s)).join('; ').slice(0, 1500)}` });
    } else ev.push({ at: f.created_at, kind: 'file', id: f.id, text: label });
  }
  if (canEmail) for (const m of clientEmails(clientId)) ev.push({ at: m.at, kind: 'email', id: m.id, text: `${m.direction === 'out' ? 'sent' : `from ${m.from_name || m.from_address}`}: ${m.subject}` });
  for (const r of db.prepare('SELECT * FROM form_responses WHERE client_id = ?').all(clientId)) {
    ev.push({ at: r.submitted_at || r.created_at, kind: 'form', id: r.id, text: `${formText(r).name} (${r.status})` });
  }
  for (const r of db.prepare('SELECT id, title, status, created_at FROM billable_reports WHERE client_id = ? AND deleted_at IS NULL').all(clientId)) {
    ev.push({ at: r.created_at, kind: 'report', id: r.id, text: `${r.title} (${r.status})` });
  }
  if (canEmail) {
    for (const t of db.prepare('SELECT t.id, t.title, t.status, t.next_step, t.updated_at FROM tasks t JOIN task_clients tc ON tc.task_id = t.id WHERE tc.client_id = ?').all(clientId)) {
      ev.push({ at: t.updated_at, kind: 'task', id: t.id, text: `${t.status}: ${t.title}${t.next_step ? ` — next: ${t.next_step}` : ''}` });
    }
  }
  ev.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const start = from || (to ? null : monthsAgo(12));
  const shown = ev.filter(e => inWindow(e.at, start, to));
  const older = ev.filter(e => start && day(e.at) < start);
  const window = { from: start, to: to || null, shown: shown.length, of_total: ev.length,
    ...(older.length ? { older_records: older.length, older_span: `${day(older[older.length - 1].at)} to ${day(older[0].at)}`, note: 'Older records are not listed; call client_history again with an earlier "from" date if the answer may be older.' } : {}) };
  return {
    window,
    client: { client_id: c.id, ref: ref(c.id), name: clientName(c), active: !!c.active, merged_into: c.merged_into || null, address: c.address, date_of_birth: c.date_of_birth, background: c.diagnosis, alert: c.alert, notes: c.notes },
    records: shown.map(e => `${day(e.at)} ${e.kind} ${e.id}: ${e.text}`),
  };
}

async function searchRecords(query, clientId, { canEmail }, { from = null, to = null } = {}) {
  const terms = termsOf(query);
  if (!terms.length) return { error: 'Give some words to search for' };
  const cid = clientId ? Number(clientId) : null;
  const hits = [];
  const add = (kind, id, at, text, extra = {}) => {
    if (!text || !inWindow(at, from, to)) return;
    const s = score(text, terms);
    if (s) hits.push({ s, kind, id, date: day(at), ...extra, match: snippet(text, terms) });
  };
  const where = cid ? ' WHERE client_id = ?' : '';
  const args = cid ? [cid] : [];

  for (const n of db.prepare(`SELECT id, client_id, created_at, note FROM session_notes${where}`).all(...args)) add('note', n.id, n.created_at, strip(n.note), { client_id: n.client_id });
  for (const a of db.prepare(`SELECT id, client_id, start_time, title, notes FROM appointments${where}`).all(...args)) add('appointment', a.id, a.start_time, `${a.title || ''}\n${strip(a.notes)}`, { client_id: a.client_id });
  for (const r of db.prepare(`SELECT * FROM form_responses${where}`).all(...args)) { const f = formText(r); add('form', r.id, r.submitted_at || r.created_at, `${f.name}\n${f.text}`, { client_id: r.client_id, title: f.name }); }
  for (const r of db.prepare(`SELECT id, client_id, title, created_at FROM billable_reports WHERE deleted_at IS NULL${cid ? ' AND client_id = ?' : ''}`).all(...args)) {
    const t = reportText(r); add('report', r.id, t.at || r.created_at, `${r.title}\n${t.text}`, { client_id: r.client_id, title: r.title });
  }
  for (const f of db.prepare(`SELECT * FROM client_files${where}`).all(...args)) {
    if (isZip(f)) {
      const names = await zipEntries(f);
      for (let i = 0; i < names.length; i++) {
        if (/\/(payments|invoices)\//.test(names[i])) continue;
        const { name, text } = await zipEntryText(f, i);
        add('zip_entry', `${f.id}:${i}`, f.created_at, `${name}\n${text || ''}`, { client_id: f.client_id, title: name });
      }
      continue;
    }
    const text = await fileText(f);
    add('file', f.id, f.created_at, `${f.original_name} ${f.label || ''}\n${text || ''}`, { client_id: f.client_id, title: f.original_name, ...(text == null ? { note: 'only the file name could be searched' } : {}) });
  }
  for (const f of db.prepare(`SELECT nf.*, n.client_id, n.created_at AS note_at FROM session_note_files nf JOIN session_notes n ON n.id = nf.session_note_id${cid ? ' WHERE n.client_id = ?' : ''}`).all(...args)) {
    add('note_file', f.id, f.note_at, `${f.original_name}\n${(await noteFileText(f)) || ''}`, { client_id: f.client_id, title: f.original_name });
  }

  if (canEmail) {
    // For one client: emails filed to them, plus unfiled emails that name them.
    const ids = new Set(cid ? clientEmails(cid).map(m => m.id) : []);
    try {
      const fts = terms.map(t => `"${t.replace(/"/g, '')}"`).join(' OR ');
      for (const r of db.prepare('SELECT rowid FROM email_fts WHERE email_fts MATCH ? LIMIT 400').all(fts)) ids.add(r.rowid);
    } catch {}
    const c = cid && db.prepare('SELECT first_name, last_name FROM clients WHERE id = ?').get(cid);
    const mentions = c ? nameMatcher(c) : () => true;
    const em = db.prepare('SELECT id, direction, from_name, from_address, subject, body_text, conversation_id, COALESCE(received_at, sent_at) AS at FROM email_messages WHERE id = ?');
    const links = db.prepare('SELECT client_id FROM email_message_clients WHERE message_id = ? AND removed_at IS NULL');
    const atts = db.prepare('SELECT * FROM email_attachments WHERE message_id = ? AND COALESCE(is_inline,0) = 0');
    const seenThread = new Map();
    for (const id of ids) {
      const m = em.get(id);
      if (!m) continue;
      const linked = links.all(id).map(l => l.client_id);
      if (cid && !linked.includes(cid) && (linked.length || !mentions(`${m.subject}\n${m.body_text || ''}`))) continue;
      const before = hits.length;
      add('email', m.id, m.at, `${m.subject}\n${m.body_text || ''}`, { client_ids: linked, from: m.from_name || m.from_address, title: m.subject, thread: m.conversation_id });
      // Replies quote the whole thread: keep only the newest matching email of each conversation.
      if (hits.length > before && m.conversation_id) {
        const prev = seenThread.get(m.conversation_id);
        if (prev && prev.date >= hits[hits.length - 1].date) hits.pop();
        else { if (prev) hits.splice(hits.indexOf(prev), 1); seenThread.set(m.conversation_id, hits[hits.length - 1]); }
      }
      for (const a of atts.all(id)) {
        if (!docs.isPdf(a.filename, a.content_type)) continue;
        add('attachment', a.id, m.at, `${a.filename}\n${(await attachmentText(a)) || ''}`, { email_id: m.id, client_ids: linked, title: a.filename });
      }
    }
    for (const h of hits) delete h.thread;
  }
  // The same attachment is often on several emails of a thread: keep one of each.
  const seenName = new Set();
  const unique = hits.sort((a, b) => b.s - a.s || String(b.date).localeCompare(String(a.date))).filter(h => {
    if (h.kind !== 'attachment') return true;
    const k = `${h.title}|${h.match}`;
    if (seenName.has(k)) return false;
    seenName.add(k);
    return true;
  });
  return { searched_for: terms, ...(from || to ? { date_range: { from, to } } : {}), total_matches: unique.length, results: unique.slice(0, 20).map(({ s, ...h }) => ({ ...h, words_matched: s })) };
}

// ---- reading part of a long document ----
// Most of what Ask costs is the text it reads. A long document is shown in pages: with look_for,
// only the pages that mention those words; with pages, the pages asked for; otherwise the start.
// PDFs keep their own pages ("[page 3]"); other long text is split into parts of about 3,000
// characters. Text up to SHORT characters is always shown whole.
const SHORT = 6000;
const FOCUS_CHARS = 8000;
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'was', 'were', 'are', 'has', 'have', 'had', 'not', 'any', 'his', 'her', 'their', 'what', 'when', 'which', 'who', 'how', 'did', 'does', 'client']);
function splitPages(text) {
  if (/^\[page \d+\]/m.test(text)) {
    return text.split(/^(?=\[page \d+\])/m).filter(p => p.trim()).map(p => ({ n: Number(p.match(/^\[page (\d+)\]/)?.[1]) || 0, text: p }));
  }
  const out = [];
  let rest = text;
  while (rest.length) {
    let end = rest.length <= 3000 ? rest.length : rest.lastIndexOf('\n', 3000);
    if (end < 1500) end = Math.min(3000, rest.length);
    out.push({ n: out.length + 1, text: `[part ${out.length + 1}]\n${rest.slice(0, end).trim()}` });
    rest = rest.slice(end);
  }
  return out;
}
const pageList = ns => ns.join(', ');
function parsePages(spec, max) {
  const want = new Set();
  for (const bit of String(spec).split(',')) {
    const [a, b] = bit.split('-').map(x => Number(x.trim()));
    if (!a) continue;
    for (let i = a; i <= Math.min(b || a, a + 50, max); i++) want.add(i);
  }
  return want;
}
function focus(text, { lookFor = null, pages = null, maxChars = 12000 } = {}) {
  if (!text || text.length <= SHORT) return text;
  const all = splitPages(text);
  const unit = /^\[page /.test(all[0]?.text || '') ? 'page' : 'part';
  const total = all.length;
  const take = (chosen, budget) => {
    const out = [];
    let used = 0;
    for (const p of chosen) {
      if (used && used + p.text.length > budget) break;
      out.push(p.text.length > budget ? `${p.text.slice(0, budget)}\n… [rest of this ${unit} not shown]` : p.text);
      used += p.text.length;
    }
    return { text: out.join('\n'), n: out.length };
  };
  if (pages) {
    const want = parsePages(pages, total);
    const chosen = all.filter(p => want.has(p.n));
    if (!chosen.length) return `[This document has ${total} ${unit}s; ${unit} ${pages} doesn't exist.]`;
    const t = take(chosen, maxChars);
    return `[${unit}s ${pageList(chosen.slice(0, t.n).map(p => p.n))} of ${total}]\n${t.text}`;
  }
  if (lookFor) {
    const terms = termsOf(lookFor).filter(t => !STOP.has(t)).map(t => (t.length > 4 && t.endsWith('s') ? t.slice(0, -1) : t));
    const scored = all.map(p => {
      const low = p.text.toLowerCase();
      const distinct = terms.filter(t => low.includes(t)).length;
      const count = terms.reduce((c, t) => c + low.split(t).length - 1, 0);
      return { ...p, distinct, count };
    }).filter(p => p.distinct);
    if (!scored.length) {
      const t = take(all, 3000);
      return `[None of this document's ${total} ${unit}s mention: ${terms.join(', ')}. Showing the start; read other ${unit}s with pages if needed.]\n${t.text}`;
    }
    scored.sort((a, b) => b.distinct - a.distinct || b.count - a.count || a.n - b.n);
    const t = take(scored, FOCUS_CHARS);
    const shown = scored.slice(0, t.n);
    const shownText = [...shown].sort((a, b) => a.n - b.n);
    const others = scored.slice(t.n).map(p => p.n).sort((a, b) => a - b);
    return `[Showing ${unit}s ${pageList(shownText.map(p => p.n))} of ${total} — the ones mentioning: ${terms.join(', ')}.${others.length ? ` ${unit[0].toUpperCase() + unit.slice(1)}s ${pageList(others)} also mention them.` : ''} Read other ${unit}s with pages if needed.]\n${shownText.map(p => p.text).join('\n')}`;
  }
  const t = take(all, maxChars);
  return `[${unit}s 1–${t.n} of ${total}${t.n < total ? `; read others with pages, or give look_for to see only the ${unit}s that mention what you need` : ''}]\n${t.text}`;
}

async function readRecord(kind, id, { canEmail, maxChars = 12000, lookFor = null, pages = null }) {
  const cut = t => focus(t, { lookFor, pages, maxChars });
  const n = Number(id);
  if (kind === 'note') { const r = db.prepare('SELECT * FROM session_notes WHERE id = ?').get(n); return r && { kind, id: r.id, client_id: r.client_id, appointment_id: r.appointment_id, written: r.created_at, text: cut(strip(r.note)) }; }
  if (kind === 'appointment') {
    const a = db.prepare(`SELECT a.*, l.name AS location_name, p.first_name || ' ' || p.last_name AS practitioner FROM appointments a LEFT JOIN locations l ON l.id = a.location_id LEFT JOIN practitioners p ON p.id = a.practitioner_id WHERE a.id = ?`).get(n);
    if (!a) return null;
    return {
      kind, id: a.id, client_id: a.client_id, title: a.title, start: a.start_time, end: a.end_time, status: a.status, practitioner: a.practitioner,
      location: a.location_name || a.location || a.location_other, notes: strip(a.notes),
      services: db.prepare('SELECT COALESCE(s.name, ai.description) AS service, ai.quantity, ai.item_notes FROM appointment_items ai LEFT JOIN services s ON s.id = ai.service_id WHERE ai.appointment_id = ?').all(n),
      session_notes: db.prepare('SELECT id, note FROM session_notes WHERE appointment_id = ?').all(n).map(x => ({ id: x.id, text: cut(strip(x.note)) })),
    };
  }
  if (kind === 'file') {
    const f = db.prepare('SELECT * FROM client_files WHERE id = ?').get(n);
    if (!f) return null;
    if (isZip(f)) return { kind, id: f.id, client_id: f.client_id, name: f.original_name, documents: (await zipEntries(f)).map((x, i) => `${i}: ${x}`) };
    return { kind, id: f.id, client_id: f.client_id, name: f.original_name, label: f.label, uploaded: f.created_at, text: cut(await fileText(f)) ?? '(This file type can\'t be read yet — only PDFs and text files.)' };
  }
  if (kind === 'zip_entry') {
    const [fid, idx] = String(id).split(':').map(Number);
    const f = db.prepare('SELECT * FROM client_files WHERE id = ?').get(fid);
    if (!f || !isZip(f)) return null;
    const { name, text } = await zipEntryText(f, idx);
    return name && { kind, id: `${fid}:${idx}`, client_id: f.client_id, backup: f.original_name, name, text: cut(text) ?? '(This document type can\'t be read yet.)' };
  }
  if (kind === 'note_file') { const f = db.prepare('SELECT nf.*, n.client_id FROM session_note_files nf JOIN session_notes n ON n.id = nf.session_note_id WHERE nf.id = ?').get(n); return f && { kind, id: f.id, client_id: f.client_id, note_id: f.session_note_id, name: f.original_name, text: cut(await noteFileText(f)) }; }
  if (kind === 'form') { const r = db.prepare('SELECT * FROM form_responses WHERE id = ?').get(n); if (!r) return null; const f = formText(r); return { kind, id: r.id, client_id: r.client_id, form: f.name, status: r.status, submitted: r.submitted_at, answers: cut(f.text) }; }
  if (kind === 'report') { const r = db.prepare('SELECT * FROM billable_reports WHERE id = ?').get(n); if (!r) return null; const t = reportText(r); return { kind, id: r.id, client_id: r.client_id, title: r.title, status: r.status, version: t.version, date: t.at, text: cut(t.text) }; }
  if (kind === 'email' || kind === 'attachment') {
    if (!canEmail) return { error: "You don't have access to email." };
    if (kind === 'attachment') { const a = db.prepare('SELECT * FROM email_attachments WHERE id = ?').get(n); return a && { kind, id: a.id, email_id: a.message_id, name: a.filename, text: cut(await attachmentText(a)) ?? '(This file type can\'t be read yet.)' }; }
    const m = db.prepare('SELECT id, direction, from_name, from_address, to_json, cc_json, subject, body_text, received_at, sent_at, conversation_id FROM email_messages WHERE id = ?').get(n);
    if (!m) return null;
    const addrs = j => { try { return JSON.parse(j || '[]').map(x => x.name ? `${x.name} <${x.address}>` : x.address).join(', '); } catch { return ''; } };
    return {
      kind, id: m.id, direction: m.direction, from: `${m.from_name || ''} <${m.from_address}>`.trim(), to: addrs(m.to_json), cc: addrs(m.cc_json) || undefined,
      subject: m.subject, date: m.received_at || m.sent_at, text: cut(m.body_text),
      client_ids: db.prepare('SELECT client_id FROM email_message_clients WHERE message_id = ? AND removed_at IS NULL').all(n).map(x => x.client_id),
      attachments: db.prepare('SELECT id, filename FROM email_attachments WHERE message_id = ? AND COALESCE(is_inline,0) = 0').all(n),
      other_emails_in_thread: db.prepare('SELECT id, direction, subject, COALESCE(received_at, sent_at) AS date FROM email_messages WHERE conversation_id = ? AND id != ? ORDER BY date').all(m.conversation_id, n),
    };
  }
  if (kind === 'task') {
    if (!canEmail) return { error: "You don't have access to tasks." };
    const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(n);
    return t && { kind, id: t.id, title: t.title, status: t.status, next_step: t.next_step, follow_up: t.follow_up_at, created: t.created_at,
      history: db.prepare('SELECT created_at, kind, detail FROM task_events WHERE task_id = ? ORDER BY id').all(n).map(e => `${day(e.created_at)} ${e.kind}${e.detail ? `: ${e.detail}` : ''}`) };
  }
  return { error: `Unknown kind "${kind}"` };
}

// A source's document name (files, zip documents, note attachments, email attachments).
function nameOf(kind, id) {
  const [a, b] = String(id).split(':').map(Number);
  if (kind === 'file') return db.prepare('SELECT original_name FROM client_files WHERE id = ?').get(a)?.original_name || null;
  if (kind === 'note_file') return db.prepare('SELECT original_name FROM session_note_files WHERE id = ?').get(a)?.original_name || null;
  if (kind === 'attachment') return db.prepare('SELECT filename FROM email_attachments WHERE id = ?').get(a)?.filename || null;
  if (kind === 'zip_entry') {
    let list = [];
    try { list = JSON.parse(db.prepare('SELECT text FROM document_texts WHERE key = ?').get(`zip-${a}-list`)?.text || '[]'); } catch {}
    return list[b]?.split('/').pop() || null;
  }
  return null;
}

// Which client a record belongs to, for linking a source in an answer back to its page.
function clientOf(kind, id) {
  const n = Number(String(id).split(':')[0]);
  const q = {
    note: 'SELECT client_id FROM session_notes WHERE id = ?', appointment: 'SELECT client_id FROM appointments WHERE id = ?',
    file: 'SELECT client_id FROM client_files WHERE id = ?', zip_entry: 'SELECT client_id FROM client_files WHERE id = ?',
    form: 'SELECT client_id FROM form_responses WHERE id = ?', report: 'SELECT client_id FROM billable_reports WHERE id = ?',
    note_file: 'SELECT n.client_id FROM session_note_files nf JOIN session_notes n ON n.id = nf.session_note_id WHERE nf.id = ?',
  }[kind];
  return q ? db.prepare(q).get(n)?.client_id || null : null;
}

module.exports = { focus, findClients, clientTimeline, searchRecords, readRecord, clientOf, nameOf, zipEntryFile };
