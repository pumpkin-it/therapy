// Sending email from Therapy through the practice mailbox.
//
// Pressing Send queues the email in email_outbox with a short delay (so it can be undone); the
// worker below sends it via Graph: a reply/forward is created from the original (so it threads in
// Outlook), a new email as a fresh draft; attachments are added; then it's sent and lands in the
// mailbox's Sent Items. The sent email is copied into Therapy straight away and filed to the
// clients and tags chosen when writing it (the sync later recognises it and doesn't copy it again).
//
// On UAT every email goes ONLY to UAT_TEST_MAILBOX (fails closed if that isn't set), with the real
// recipients listed at the top — same rule as services/mailer.js graphSend.
const db = require('../database');
const { isUAT } = require('../lib/env');
const { graph } = require('./graphClient');
const store = require('./mailStore');
const { ingestEml } = require('./mailIngest');
const linking = require('./mailLinking');
const tags = require('./mailTags');
const mailSync = require('./mailSync');
const audit = require('./audit');

const UNDO_SECONDS = 10;
const MAX_ATTEMPTS = 3;
const SIMPLE_ATTACHMENT_LIMIT = 3 * 1024 * 1024; // larger files go up in chunks
const CHUNK = 320 * 1024 * 10;                    // 3.2 MB, a multiple of 320 KB as Graph requires

const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const recipients = list => (list || []).map(r => ({ emailAddress: { address: r.address, name: r.name || undefined } }));

function sendingMailbox() {
  const { mailbox } = mailSync.config();
  if (!mailbox) throw new Error("Email isn't connected — no practice mailbox is set up for sending");
  return mailbox;
}

// UAT: send only to the test inbox(es), showing who it would have gone to.
function uatRedirect(p) {
  if (!isUAT) return p;
  const testInboxes = (process.env.UAT_TEST_MAILBOX || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!testInboxes.length) throw new Error('UAT_TEST_MAILBOX not configured — refusing to send any email from UAT without a safe redirect target');
  const line = (label, list) => (list?.length ? `<div>${label} - ${esc(list.map(r => r.address).join(', '))}</div>` : '');
  return {
    ...p,
    to: testInboxes.map(address => ({ address })), cc: [], bcc: [],
    subject: `[UAT TEST] ${p.subject || ''}`,
    html: `<div style="background:#fff8dc;border:1px solid #d4a017;padding:10px;margin-bottom:14px;font-family:monospace;font-size:12px;">
      <strong>UAT TEST EMAIL — redirected from real recipients:</strong>${line('TO', p.to)}${line('CC', p.cc)}${line('BCC', p.bcc)}</div>${p.html || ''}`,
  };
}

async function addAttachment(mb, draftId, upload) {
  const buf = await store.get(upload.storage_key);
  if (buf.length <= SIMPLE_ATTACHMENT_LIMIT) {
    await graph(`/users/${mb}/messages/${draftId}/attachments`, {
      method: 'POST',
      body: { '@odata.type': '#microsoft.graph.fileAttachment', name: upload.filename, contentType: upload.content_type || 'application/octet-stream', contentBytes: buf.toString('base64') },
    });
    return;
  }
  const session = await graph(`/users/${mb}/messages/${draftId}/attachments/createUploadSession`, {
    method: 'POST', body: { AttachmentItem: { attachmentType: 'file', name: upload.filename, size: buf.length, contentType: upload.content_type || 'application/octet-stream' } },
  });
  for (let start = 0; start < buf.length; start += CHUNK) {
    const end = Math.min(start + CHUNK, buf.length);
    // The upload URL carries its own authorisation — no Graph token on these requests.
    const res = await fetch(session.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Length': String(end - start), 'Content-Range': `bytes ${start}-${end - 1}/${buf.length}` },
      body: buf.subarray(start, end),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`Attachment upload failed (${res.status}) for ${upload.filename}`);
  }
}

// Sends one outbox item. Returns { messageId } of the sent copy in Therapy (null if it was sent
// but couldn't be copied in — the sync files it later). Errors carry .stage: 'prepare' (nothing
// sent; the half-made draft is removed), 'send' (unknown whether it went).
async function deliver(item) {
  const payload = uatRedirect(JSON.parse(item.payload));
  const mb = encodeURIComponent(item.mailbox);
  const source = payload.source_id ? db.prepare('SELECT * FROM email_messages WHERE id = ?').get(payload.source_id) : null;
  const canThread = source?.graph_id && !source.mailbox_removed_at && source.mailbox === item.mailbox;

  let draft, raw, internetMessageId;
  try {
    // 1. Draft: a reply/forward of the original when it's still in the mailbox, else a new email.
    if (payload.mode !== 'new' && canThread) {
      const action = { reply: 'createReply', replyAll: 'createReplyAll', forward: 'createForward' }[payload.mode];
      draft = await graph(`/users/${mb}/messages/${encodeURIComponent(source.graph_id)}/${action}`, { method: 'POST', body: {} });
      // Graph puts the quoted original in the draft body — keep it under what was written.
      const quoted = draft.body?.content || '';
      await graph(`/users/${mb}/messages/${draft.id}`, {
        method: 'PATCH',
        body: {
          subject: payload.subject,
          toRecipients: recipients(payload.to), ccRecipients: recipients(payload.cc), bccRecipients: recipients(payload.bcc),
          body: { contentType: 'HTML', content: `${payload.html || ''}${quoted ? `<br>${quoted}` : ''}` },
        },
      });
    } else {
      draft = await graph(`/users/${mb}/messages`, {
        method: 'POST',
        body: {
          subject: payload.subject,
          toRecipients: recipients(payload.to), ccRecipients: recipients(payload.cc), bccRecipients: recipients(payload.bcc),
          body: { contentType: 'HTML', content: payload.html || '' },
        },
      });
    }
    // 2. Attachments.
    for (const uploadId of payload.upload_ids || []) {
      const upload = db.prepare('SELECT * FROM email_uploads WHERE id = ?').get(uploadId);
      if (upload) await addAttachment(mb, draft.id, upload);
    }
    // 3. A copy of the email as it will be sent, for Therapy.
    ({ internetMessageId } = await graph(`/users/${mb}/messages/${draft.id}?$select=internetMessageId`));
    raw = await graph(`/users/${mb}/messages/${draft.id}/$value`, { raw: true });
    db.prepare('UPDATE email_outbox SET internet_message_id = ? WHERE id = ?').run(internetMessageId || null, item.id);
  } catch (e) {
    if (draft?.id) await graph(`/users/${mb}/messages/${draft.id}`, { method: 'DELETE' }).catch(() => {});
    e.stage = 'prepare';
    throw e;
  }

  // 4. Send.
  try {
    await graph(`/users/${mb}/messages/${draft.id}/send`, { method: 'POST' });
  } catch (e) {
    e.stage = e.uncertain ? 'send' : 'prepare';
    if (!e.uncertain) await graph(`/users/${mb}/messages/${draft.id}`, { method: 'DELETE' }).catch(() => {});
    throw e;
  }

  // 5. Copy it into Therapy and file it to the chosen clients and tags. It has gone either way;
  // if this part fails the sync copies it in from Sent Items and files it then.
  try {
    const { id } = await ingestEml(item.mailbox, raw, { internetMessageId, isSentFolder: true, folderName: 'Sent Items', isRead: true });
    db.transaction(() => {
      const clientIds = (payload.client_ids || []).map(Number);
      if (clientIds.length) linking.setLinks(id, clientIds, { userId: item.created_by, method: 'outbound' });
      else if (payload.no_client) linking.markNotClient(id, item.created_by);
      if (payload.tag_ids?.length) tags.setTags(id, payload.tag_ids, item.created_by);
      if (payload.task_choice) require('./tasks').applySendChoice(id, payload.source_id, payload.task_choice, item.created_by);
    })();
    return { messageId: id };
  } catch (e) {
    console.error(`[mail-send] outbox ${item.id} sent, but not copied into Therapy yet: ${e.message}`);
    return { messageId: null };
  }
}

// Due outbox items, one at a time. An item left 'sending' by a crash is never retried
// automatically (it may already have gone) — it's marked failed for someone to check.
let working = false;
async function processOutbox() {
  if (working) return;
  working = true;
  try {
    for (;;) {
      const item = db.prepare("SELECT * FROM email_outbox WHERE status = 'pending' AND send_at <= ? ORDER BY send_at, id LIMIT 1").get(new Date().toISOString());
      if (!item) break;
      const claimed = db.prepare("UPDATE email_outbox SET status = 'sending', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").run(item.id).changes;
      if (!claimed) continue; // undone at the last moment
      try {
        const { messageId } = await deliver(item);
        db.prepare("UPDATE email_outbox SET status = 'sent', sent_message_id = ?, error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(messageId, item.id);
        const p = JSON.parse(item.payload);
        for (const cid of p.client_ids || []) audit.log('client', Number(cid), 'email_sent', `Email sent: "${p.subject || '(no subject)'}"`);
      } catch (e) {
        // Throttled before anything was sent: try again in a minute (a few times).
        const retry = e.stage === 'prepare' && e.status === 429 && item.attempts + 1 < MAX_ATTEMPTS;
        const message = e.stage === 'send'
          ? `Sending may or may not have finished (${e.message}). Check the mailbox's Sent Items before trying again.`
          : `Not sent: ${e.message}`;
        console.error(`[mail-send] outbox ${item.id}: ${e.message}`);
        db.prepare(`UPDATE email_outbox SET status = ?, error = ?, send_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(retry ? 'pending' : 'failed', message.slice(0, 1000), retry ? new Date(Date.now() + 60000).toISOString() : item.send_at, item.id);
      }
    }
  } finally { working = false; }
}

function recoverInterrupted() {
  db.prepare(`UPDATE email_outbox SET status = 'failed', error = 'The server restarted while this email was being sent. Check the mailbox''s Sent Items before trying again.', updated_at = CURRENT_TIMESTAMP
    WHERE status = 'sending'`).run();
}

module.exports = { UNDO_SECONDS, sendingMailbox, processOutbox, recoverInterrupted, uatRedirect };
