// Text taken out of documents, read once and kept in document_texts: client files, session-note
// files, email attachments, and the documents inside old-system backup zips. Ask reads from here,
// and later AI features (fact extraction, filing) will too.
//
// A document is read the first time something needs it, and the background queue also reads every
// document that hasn't been read yet (sweep(), every few minutes), so new uploads and email
// attachments are usually ready before anyone asks about them.
//
// Keys: 'file-<client_files.id>', 'notefile-<session_note_files.id>', 'att-<email_attachments.id>',
// 'zip-<client_files.id>-list' (the zip's document names, JSON) and 'zip-<id>-<index>'.
const path = require('path');
const fs = require('fs');
const db = require('../database');

const UPLOADS = process.env.ASK_UPLOADS || path.join(__dirname, '../../uploads');

const strip = html => String(html || '')
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<\/(p|div|li|h\d|tr)>|<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

let mupdf;
async function pdfText(buf) {
  mupdf = mupdf || await import('mupdf');
  const doc = mupdf.Document.openDocument(buf, 'application/pdf');
  const pages = [];
  for (let i = 0; i < doc.countPages(); i++) pages.push(doc.loadPage(i).toStructuredText('preserve-whitespace').asText());
  return pages.map((t, i) => `[page ${i + 1}]\n${t.trim()}`).join('\n');
}
const isPdf = (name, mime) => /\.pdf$/i.test(name || '') || mime === 'application/pdf';
const isText = (name, mime) => /\.(txt|csv|md|html?)$/i.test(name || '') || /^text\//.test(mime || '');
const readable = (name, mime) => isPdf(name, mime) || isText(name, mime);
async function bufferText(buf, name, mime) {
  if (isPdf(name, mime)) return pdfText(buf);
  if (isText(name, mime)) return strip(buf.toString('utf8'));
  return null; // images, Word, Excel: not read yet
}
const isZip = f => /\.zip$/i.test(f.original_name || '');

const getRow = db.prepare('SELECT status, text FROM document_texts WHERE key = ?');
const putRow = db.prepare(`INSERT INTO document_texts (key, status, text, chars, error, extracted_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(key) DO UPDATE SET status = excluded.status, text = excluded.text, chars = excluded.chars, error = excluded.error, extracted_at = excluded.extracted_at`);

// The stored text for `key`, reading it with load() the first time. null = nothing readable.
// A failed read is stored as 'error' and tried again by the next sweep.
async function textFor(key, load, { retryErrors = false } = {}) {
  const row = getRow.get(key);
  if (row && !(retryErrors && row.status === 'error')) return row.status === 'ok' ? row.text : null;
  let text = null, error = null;
  try { text = await load(); } catch (e) { error = String(e.message || e).slice(0, 500); }
  putRow.run(key, error ? 'error' : text ? 'ok' : 'none', text || null, text ? text.length : 0, error);
  return text || null;
}

const uploadText = (key, f, o) => textFor(key, () => bufferText(fs.readFileSync(path.join(UPLOADS, f.filename)), f.original_name, f.mime_type), o);
const fileText = (f, o) => uploadText(`file-${f.id}`, f, o);
const noteFileText = (f, o) => uploadText(`notefile-${f.id}`, f, o);
const attachmentText = (a, o) => textFor(`att-${a.id}`, async () => bufferText(await require('./mailStore').get(a.storage_key), a.filename, a.content_type), o);

// Old-system backups (e.g. "Splose Back Up Data.zip") hold earlier notes and reports as PDFs.
// Entries are numbered in name order so "zip_entry 158:12" always means the same document.
const loadZip = async f => require('jszip').loadAsync(fs.readFileSync(path.join(UPLOADS, f.filename)));
async function zipEntries(f, zip = null) {
  const list = await textFor(`zip-${f.id}-list`, async () => {
    const z = zip || await loadZip(f);
    return JSON.stringify(Object.values(z.files).filter(e => !e.dir).map(e => e.name).sort());
  });
  try { return JSON.parse(list || '[]'); } catch { return []; }
}
async function zipEntryText(f, index, zip = null, o) {
  const names = await zipEntries(f, zip);
  const name = names[index];
  if (!name) return { name: null, text: null };
  const text = await textFor(`zip-${f.id}-${index}`, async () => {
    if (!readable(name)) return null;
    const z = zip || await loadZip(f);
    return bufferText(await z.file(name).async('nodebuffer'), name);
  }, o);
  return { name, text };
}

// ---- reading everything not yet read (background queue) ----
// The documents still to read, each as a job for the queue. Unreadable types (images, Word) are
// skipped without a job.
function unread() {
  const has = db.prepare("SELECT 1 FROM document_texts WHERE key = ? AND (status != 'error' OR extracted_at > datetime('now', '-1 day'))"); // failed reads are retried daily
  const todo = [];
  for (const f of db.prepare('SELECT id, original_name, mime_type FROM client_files').all()) {
    if (isZip(f)) { if (!has.get(`zip-${f.id}-done`)) todo.push({ type: 'zip', id: f.id }); }
    else if (readable(f.original_name, f.mime_type) && !has.get(`file-${f.id}`)) todo.push({ type: 'file', id: f.id });
  }
  for (const f of db.prepare('SELECT id, original_name, mime_type FROM session_note_files').all()) {
    if (readable(f.original_name, f.mime_type) && !has.get(`notefile-${f.id}`)) todo.push({ type: 'notefile', id: f.id });
  }
  for (const a of db.prepare('SELECT id, filename, content_type FROM email_attachments WHERE COALESCE(is_inline, 0) = 0').all()) {
    if (readable(a.filename, a.content_type) && !has.get(`att-${a.id}`)) todo.push({ type: 'att', id: a.id });
  }
  return todo;
}

// Read one document (or every document in one backup zip). Runs as a background job.
async function extract({ type, id }) {
  const o = { retryErrors: true };
  if (type === 'file') { const f = db.prepare('SELECT * FROM client_files WHERE id = ?').get(id); return f ? { chars: (await fileText(f, o))?.length || 0 } : { gone: true }; }
  if (type === 'notefile') { const f = db.prepare('SELECT * FROM session_note_files WHERE id = ?').get(id); return f ? { chars: (await noteFileText(f, o))?.length || 0 } : { gone: true }; }
  if (type === 'att') { const a = db.prepare('SELECT * FROM email_attachments WHERE id = ?').get(id); return a ? { chars: (await attachmentText(a, o))?.length || 0 } : { gone: true }; }
  if (type === 'zip') {
    const f = db.prepare('SELECT * FROM client_files WHERE id = ?').get(id);
    if (!f) return { gone: true };
    const zip = await loadZip(f);
    const names = await zipEntries(f, zip);
    let read = 0;
    for (let i = 0; i < names.length; i++) {
      if ((await zipEntryText(f, i, zip, o)).text) read++;
      await new Promise(r => setImmediate(r)); // let requests in between documents
    }
    putRow.run(`zip-${f.id}-done`, 'ok', null, 0, null);
    return { documents: names.length, read };
  }
  throw new Error(`Unknown document type ${type}`);
}

function stats() {
  const rows = db.prepare("SELECT status, COUNT(*) AS n, COALESCE(SUM(chars), 0) AS chars FROM document_texts WHERE key NOT LIKE 'zip-%-list' AND key NOT LIKE 'zip-%-done' GROUP BY status").all();
  const by = Object.fromEntries(rows.map(r => [r.status, r]));
  return { read: by.ok?.n || 0, unreadable: by.none?.n || 0, failed: by.error?.n || 0, chars: by.ok?.chars || 0 };
}

module.exports = { strip, bufferText, isPdf, isZip, readable, textFor, fileText, noteFileText, attachmentText, zipEntries, zipEntryText, loadZip, unread, extract, stats };
