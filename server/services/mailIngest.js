// Turns one raw email (.eml bytes) into an email_messages row: the original, the cleaned-up HTML
// and each attachment go to mail storage first, then the row is written and filed
// (services/mailLinking.js). Safe to call twice for the same email — the second call only
// refreshes where it sits in the mailbox.
const crypto = require('crypto');
const { simpleParser } = require('mailparser');
const sanitizeHtml = require('sanitize-html');
const { convert: htmlToText } = require('html-to-text');
const db = require('../database');
const store = require('./mailStore');
const { applyInitialLinks } = require('./mailLinking');

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const addrList = a => (a ? (Array.isArray(a) ? a : [a]).flatMap(x => x.value || []) : [])
  .map(v => ({ name: v.name || '', address: (v.address || '').trim() }))
  .filter(v => v.address);
const iso = d => (d instanceof Date && !isNaN(d) ? d.toISOString() : (d ? new Date(d).toISOString() : null));

// Email HTML is shown to staff, so scripts, forms, event handlers and anything else that could
// run or submit is stripped. Inline images keep their cid: links (swapped for attachment URLs
// when shown); remote images are kept but only load when the page chooses to show them.
function cleanHtml(html) {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'span', 'font', 'center', 'u', 's', 'del', 'ins', 'small', 'big', 'sup', 'sub', 'hr']),
    allowedAttributes: {
      '*': ['style', 'align', 'valign', 'width', 'height', 'bgcolor', 'color', 'dir', 'lang', 'title'],
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height', 'style'],
      font: ['face', 'size', 'color'],
      table: ['border', 'cellpadding', 'cellspacing', 'width', 'bgcolor', 'style', 'align'],
      td: ['colspan', 'rowspan', 'width', 'height', 'bgcolor', 'style', 'align', 'valign', 'nowrap'],
      th: ['colspan', 'rowspan', 'width', 'height', 'bgcolor', 'style', 'align', 'valign', 'nowrap'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel', 'cid'],
    allowedSchemesByTag: { img: ['http', 'https', 'cid', 'data'] },
    allowProtocolRelative: false,
    transformTags: { a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }) },
  });
}

// graph: { id, folderId, folderName, isRead, conversationId, receivedDateTime, isSentFolder }
async function ingestEml(mailbox, raw, graph = {}) {
  const parsed = await simpleParser(raw, { keepCidLinks: true });
  const internetMessageId = (parsed.messageId || '').trim() || (graph.internetMessageId || '').trim() || null;
  const dedupKey = internetMessageId || `graph:${graph.id}`;

  const existing = db.prepare('SELECT id FROM email_messages WHERE mailbox = ? AND dedup_key = ?').get(mailbox, dedupKey);
  if (existing) {
    db.prepare(`
      UPDATE email_messages SET graph_id = COALESCE(?, graph_id), graph_folder = COALESCE(?, graph_folder),
        graph_folder_name = COALESCE(?, graph_folder_name), is_read = COALESCE(?, is_read), mailbox_removed_at = NULL
      WHERE id = ?
    `).run(graph.id || null, graph.folderId || null, graph.folderName || null, graph.isRead == null ? null : (graph.isRead ? 1 : 0), existing.id);
    return { id: existing.id, created: false };
  }

  const emlHash = sha256(raw);
  const date = parsed.date || new Date();
  const emlKey = `eml/${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${emlHash}.eml`;
  await store.put(emlKey, raw, 'message/rfc822');

  let htmlKey = null;
  if (parsed.html) {
    const html = cleanHtml(parsed.html);
    htmlKey = `html/${sha256(Buffer.from(html))}.html`;
    await store.put(htmlKey, Buffer.from(html), 'text/html; charset=utf-8');
  }

  const attachments = [];
  for (const a of parsed.attachments || []) {
    const hash = sha256(a.content);
    const key = `att/${hash}`;
    await store.put(key, a.content, a.contentType || 'application/octet-stream');
    attachments.push({
      filename: a.filename || null,
      content_type: a.contentType || null,
      size: a.size ?? a.content.length,
      content_id: a.contentId ? a.contentId.replace(/^<|>$/g, '') : null,
      is_inline: a.contentDisposition === 'inline' || a.related ? 1 : 0,
      storage_key: key,
      sha256: hash,
    });
  }

  const from = addrList(parsed.from)[0] || {};
  const outgoing = !!graph.isSentFolder || (from.address || '').toLowerCase() === mailbox.toLowerCase();
  // Plain text for search, previews and (later) the AI. Some HTML-only emails come through with
  // no text at all, so it's made from the HTML then; picture/link addresses in [brackets] that
  // the conversion leaves behind are dropped.
  let text = (parsed.text || '').trim()
    || (parsed.html ? htmlToText(parsed.html, { wordwrap: false, selectors: [{ selector: 'img', format: 'skip' }, { selector: 'a', options: { ignoreHref: true } }] }) : '');
  text = text.replace(/\r\n/g, '\n').replace(/\s*\[(?:https?|cid|mailto):[^\]\s]*\]/g, '').trim();
  const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 200);
  const refs = parsed.references ? (Array.isArray(parsed.references) ? parsed.references : [parsed.references]).join(' ') : null;

  let id;
  try { id = db.transaction(() => {
    const res = db.prepare(`
      INSERT INTO email_messages (mailbox, dedup_key, graph_id, graph_folder, graph_folder_name, internet_message_id, conversation_id,
        in_reply_to, references_header, direction, from_address, from_name, to_json, cc_json, bcc_json, reply_to_json,
        subject, snippet, body_text, body_html_key, sent_at, received_at, has_attachments, eml_key, eml_size, eml_sha256, is_read)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      mailbox, dedupKey, graph.id || null, graph.folderId || null, graph.folderName || null, internetMessageId, graph.conversationId || null,
      (parsed.inReplyTo || '').trim() || null, refs, outgoing ? 'out' : 'in', from.address || null, from.name || null,
      JSON.stringify(addrList(parsed.to)), JSON.stringify(addrList(parsed.cc)), JSON.stringify(addrList(parsed.bcc)), JSON.stringify(addrList(parsed.replyTo)),
      parsed.subject || null, snippet, text, htmlKey, iso(parsed.date), iso(graph.receivedDateTime) || iso(parsed.date) || new Date().toISOString(),
      attachments.some(a => !a.is_inline) ? 1 : 0, emlKey, raw.length, emlHash, graph.isRead || outgoing ? 1 : 0,
    );
    const messageId = res.lastInsertRowid;
    const insAtt = db.prepare(`
      INSERT INTO email_attachments (message_id, filename, content_type, size, content_id, is_inline, storage_key, sha256)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const a of attachments) insAtt.run(messageId, a.filename, a.content_type, a.size, a.content_id, a.is_inline, a.storage_key, a.sha256);
    applyInitialLinks(messageId, { headers: parsed.headers });
    return messageId;
  })(); } catch (e) {
    // The same email copied in at the same moment by another run: keep the one already there.
    if (e.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw e;
    return { id: db.prepare('SELECT id FROM email_messages WHERE mailbox = ? AND dedup_key = ?').get(mailbox, dedupKey).id, created: false };
  }
  return { id, created: true };
}

module.exports = { ingestEml, cleanHtml };
