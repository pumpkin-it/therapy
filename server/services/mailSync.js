// Copies every email from the practice mailbox into Therapy, using Microsoft Graph delta queries
// per mail folder. The first pass over a folder copies everything already there (the import of
// past mail); after that each run only fetches what changed. Where it has got to is saved after
// every page, so a restart or failure resumes rather than starting again.
//
// This only READS the mailbox. Moving filed mail or removing old mail is a separate, later step.
//
// Which mailbox: in production, settings mail_sync_mailbox + mail_sync_enabled = '1'. On UAT it's
// ONLY the UAT_MAIL_SYNC_MAILBOX environment variable — never the settings, because UAT's
// database is a copy of production's and would otherwise point UAT at the live mailbox.
const db = require('../database');
const { isUAT } = require('../lib/env');
const { getGraphToken } = require('./mailer');
const { ingestEml } = require('./mailIngest');
const tasks = require('./tasks');

const GRAPH = () => process.env.GRAPH_BASE_URL || 'https://graph.microsoft.com/v1.0';
const MAX_ATTEMPTS = 3;            // per email, across runs, before it's skipped and listed
const RUN_BUDGET_MS = 4 * 60 * 1000;
// Not synced: drafts, deleted, junk, outbox and Outlook's own housekeeping folders.
const SKIP_WELL_KNOWN = ['drafts', 'deleteditems', 'junkemail', 'outbox', 'conversationhistory', 'syncissues', 'scheduled'];

function config() {
  if (isUAT) {
    const mailbox = (process.env.UAT_MAIL_SYNC_MAILBOX || '').trim();
    return { mailbox, enabled: !!mailbox };
  }
  const get = k => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value || '';
  const mailbox = get('mail_sync_mailbox').trim();
  return { mailbox, enabled: !!mailbox && get('mail_sync_enabled') === '1' };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// One Graph request with retries on throttling (429) and brief outages (5xx, network).
async function graph(url, { raw = false } = {}) {
  const full = url.startsWith('http') ? url : `${GRAPH()}${url}`;
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    let res;
    try {
      res = await fetch(full, {
        headers: {
          Authorization: `Bearer ${await getGraphToken()}`,
          // Immutable ids: an email keeps its id when someone moves it between folders.
          Prefer: 'IdType="ImmutableId", odata.maxpagesize=50',
        },
        signal: AbortSignal.timeout(120000),
      });
    } catch (e) {
      lastErr = e;
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (res.ok) return raw ? Buffer.from(await res.arrayBuffer()) : res.json();
    const body = await res.text().catch(() => '');
    const err = new Error(`Graph ${res.status}: ${body.slice(0, 300)}`);
    err.status = res.status;
    if (res.status === 429 || res.status >= 500) {
      lastErr = err;
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 120) * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    throw err;
  }
  throw lastErr;
}

// Every folder worth syncing, with its path ("Inbox/Katie Smith").
async function listFolders(mailbox) {
  const mb = encodeURIComponent(mailbox);
  const skip = new Set();
  let sentId = null;
  for (const wk of [...SKIP_WELL_KNOWN, 'sentitems']) {
    try {
      const f = await graph(`/users/${mb}/mailFolders/${wk}?$select=id`);
      if (wk === 'sentitems') sentId = f.id; else skip.add(f.id);
    } catch (e) { if (e.status !== 404 && e.status !== 400) throw e; }
  }
  const folders = [];
  const walk = async (url, parentPath) => {
    for (let next = url; next;) {
      const page = await graph(next);
      for (const f of page.value || []) {
        if (skip.has(f.id)) continue;
        const path = parentPath ? `${parentPath}/${f.displayName}` : f.displayName;
        folders.push({ id: f.id, path, isSent: f.id === sentId });
        if (f.childFolderCount > 0) await walk(`/users/${mb}/mailFolders/${f.id}/childFolders?$select=id,displayName,childFolderCount&$top=100`, path);
      }
      next = page['@odata.nextLink'];
    }
  };
  await walk(`/users/${mb}/mailFolders?$select=id,displayName,childFolderCount&$top=100`, '');
  return folders;
}

function recordFailure(mailbox, folder, graphId, subject, error) {
  db.prepare(`
    INSERT INTO email_sync_failures (mailbox, folder, graph_id, subject, error) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (mailbox, graph_id) DO UPDATE SET attempts = attempts + 1, error = excluded.error, last_failed_at = CURRENT_TIMESTAMP
  `).run(mailbox, folder, graphId, subject || null, String(error).slice(0, 1000));
  const row = db.prepare('SELECT attempts FROM email_sync_failures WHERE mailbox = ? AND graph_id = ?').get(mailbox, graphId);
  if (row.attempts >= MAX_ATTEMPTS) {
    db.prepare('UPDATE email_sync_failures SET skipped = 1 WHERE mailbox = ? AND graph_id = ?').run(mailbox, graphId);
    return true; // give up on it for now, carry on with the rest
  }
  return false;
}

async function copyMessage(mailbox, folder, m) {
  const known = db.prepare('SELECT id, graph_folder FROM email_messages WHERE mailbox = ? AND graph_id = ?').get(mailbox, m.id);
  if (known) {
    // Already copied: just note read state and which folder it's in now.
    const before = db.prepare('SELECT graph_folder_name FROM email_messages WHERE id = ?').get(known.id);
    db.prepare('UPDATE email_messages SET is_read = COALESCE(?, is_read), graph_folder = ?, graph_folder_name = ?, mailbox_removed_at = NULL WHERE id = ?')
      .run(m.isRead == null ? null : (m.isRead ? 1 : 0), folder.id, folder.path, known.id);
    if (before?.graph_folder_name === 'Inbox' && folder.path !== 'Inbox') tasks.onLeftInbox(known.id);
    return;
  }
  const skipped = db.prepare('SELECT 1 FROM email_sync_failures WHERE mailbox = ? AND graph_id = ? AND skipped = 1 AND resolved_at IS NULL').get(mailbox, m.id);
  if (skipped) return;
  const raw = await graph(`/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(m.id)}/$value`, { raw: true });
  await ingestEml(mailbox, raw, {
    id: m.id, folderId: folder.id, folderName: folder.path, isRead: m.isRead, conversationId: m.conversationId,
    receivedDateTime: m.receivedDateTime, isSentFolder: folder.isSent,
  });
  db.prepare('UPDATE email_sync_failures SET resolved_at = CURRENT_TIMESTAMP WHERE mailbox = ? AND graph_id = ? AND resolved_at IS NULL').run(mailbox, m.id);
}

// Returns true when the folder is fully caught up, false when the time budget ran out first.
async function syncFolder(mailbox, folder, deadline) {
  db.prepare(`
    INSERT INTO email_sync_state (mailbox, folder, folder_name) VALUES (?, ?, ?)
    ON CONFLICT (mailbox, folder) DO UPDATE SET folder_name = excluded.folder_name
  `).run(mailbox, folder.id, folder.path);
  const start = `/users/${encodeURIComponent(mailbox)}/mailFolders/${folder.id}/messages/delta?$select=id,isRead,conversationId,receivedDateTime,subject`;
  const saveState = (fields) => {
    const cols = Object.keys(fields);
    db.prepare(`UPDATE email_sync_state SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE mailbox = ? AND folder = ?`)
      .run(...cols.map(c => fields[c]), mailbox, folder.id);
  };
  saveState({ last_run_at: new Date().toISOString() });

  let state = db.prepare('SELECT * FROM email_sync_state WHERE mailbox = ? AND folder = ?').get(mailbox, folder.id);
  let url = state.next_link || state.delta_link || start;
  let restarted = false;
  while (url) {
    if (Date.now() > deadline) return false;
    let page;
    try {
      page = await graph(url);
    } catch (e) {
      // 410 Gone: Graph has expired our place in the folder. Start the pass again — emails
      // already copied are recognised and not copied twice.
      if (e.status === 410 && !restarted) {
        restarted = true;
        saveState({ next_link: null, delta_link: null });
        url = start;
        continue;
      }
      throw e;
    }
    for (const m of page.value || []) {
      if (m['@removed']) {
        // Gone from this folder. If it's now in another folder that folder's pass will say so.
        const gone = db.prepare('SELECT id FROM email_messages WHERE mailbox = ? AND graph_id = ? AND graph_folder = ?').get(mailbox, m.id, folder.id);
        db.prepare("UPDATE email_messages SET mailbox_removed_at = CURRENT_TIMESTAMP WHERE mailbox = ? AND graph_id = ? AND graph_folder = ?")
          .run(mailbox, m.id, folder.id);
        if (gone && folder.path === 'Inbox') tasks.onLeftInbox(gone.id);
        continue;
      }
      try {
        await copyMessage(mailbox, folder, m);
      } catch (e) {
        console.error(`[mail-sync] ${mailbox} ${folder.path}: could not copy "${m.subject || m.id}": ${e.message}`);
        // Stop here so the page is retried next run; after a few tries skip the email instead.
        if (!recordFailure(mailbox, folder.id, m.id, m.subject, e.message)) throw e;
      }
    }
    if (page['@odata.nextLink']) {
      url = page['@odata.nextLink'];
      saveState({ next_link: url });
    } else {
      const done = { next_link: null, delta_link: page['@odata.deltaLink'] || null, last_success_at: new Date().toISOString(), last_error: null };
      if (!state.initial_done_at) done.initial_done_at = new Date().toISOString();
      saveState(done);
      url = null;
    }
  }
  return true;
}

let running = false;

// Tasks start from the Outlook Inbox as it is once it has been fully copied in (not before — on a
// first import that would find nothing).
function maybeStartTasks(mailbox) {
  const inbox = db.prepare("SELECT initial_done_at FROM email_sync_state WHERE mailbox = ? AND folder_name = 'Inbox'").get(mailbox);
  if (inbox?.initial_done_at) {
    const n = tasks.seedFromInbox();
    if (n) console.log(`[tasks] started: ${n} tasks from the Outlook Inbox`);
  }
}

async function runSync() {
  const { mailbox, enabled } = config();
  if (!enabled || running) return { skipped: true };
  running = true;
  const deadline = Date.now() + RUN_BUDGET_MS;
  const summary = { mailbox, folders: 0, complete: true, errors: [] };
  try {
    const folders = await listFolders(mailbox);
    summary.folders = folders.length;
    for (const folder of folders) {
      try {
        if (!await syncFolder(mailbox, folder, deadline)) { summary.complete = false; break; }
      } catch (e) {
        summary.errors.push(`${folder.path}: ${e.message}`);
        db.prepare('UPDATE email_sync_state SET last_error = ? WHERE mailbox = ? AND folder = ?').run(e.message.slice(0, 1000), mailbox, folder.id);
      }
    }
  } catch (e) {
    summary.errors.push(e.message);
    console.error('[mail-sync] run failed:', e.message);
  } finally {
    running = false;
  }
  try { maybeStartTasks(mailbox); } catch (e) { console.error('[tasks] start failed:', e.message); }
  return summary;
}

function status() {
  const { mailbox, enabled } = config();
  const count = (sql, ...p) => db.prepare(sql).get(...p).n;
  return {
    mailbox, enabled,
    folders: mailbox ? db.prepare('SELECT folder_name, initial_done_at, last_run_at, last_success_at, last_error, next_link IS NOT NULL AS in_progress FROM email_sync_state WHERE mailbox = ? ORDER BY folder_name').all(mailbox) : [],
    messages: mailbox ? count('SELECT COUNT(*) n FROM email_messages WHERE mailbox = ?', mailbox) : 0,
    unfiled: mailbox ? count("SELECT COUNT(*) n FROM email_messages WHERE mailbox = ? AND status = 'unfiled'", mailbox) : 0,
    failures: mailbox ? db.prepare('SELECT graph_id, subject, error, attempts, skipped, last_failed_at FROM email_sync_failures WHERE mailbox = ? AND resolved_at IS NULL ORDER BY last_failed_at DESC').all(mailbox) : [],
  };
}

module.exports = { runSync, status, config, listFolders, syncFolder };
