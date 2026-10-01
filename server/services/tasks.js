// Tasks: the team's to-do list. A task follows one piece of work — usually one email conversation —
// or is created by hand. Status: todo (on us), waiting (on someone else, until a follow-up date),
// done. Every change is recorded in task_events with who (or what) made it.
//
// From email (only mail received after task tracking started — not the past mail imported):
//   - an incoming email starts a task, or puts its conversation's task back to To do;
//   - a reply sent (from Outlook) puts the task to Waiting with a follow-up date — never Done;
//     from Therapy, the person sending chooses (see applySendChoice);
//   - a Waiting task whose follow-up date arrives comes back to To do.
// Newsletters/automated emails don't start tasks.
const db = require('../database');

const setting = (k, d = '') => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value ?? d;
const localDate = (d = new Date()) => {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
// n working days from today (weekends skipped), as YYYY-MM-DD.
function addWorkingDays(n = Number(setting('tasks_follow_up_days', '3')) || 3, from = new Date()) {
  const d = new Date(from);
  let added = 0;
  while (added < n) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) added++; }
  return localDate(d);
}
const cleanTitle = subject => (subject || '').replace(/^\s*((re|fw|fwd|aw|wg)\s*:\s*)+/i, '').trim() || '(no subject)';
const who = msg => msg.from_name || msg.from_address || 'someone';
const fmt = ymd => (ymd ? new Date(`${ymd}T12:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : '');

function event(taskId, kind, detail, { messageId = null, actorId = null } = {}) {
  db.prepare('INSERT INTO task_events (task_id, kind, detail, message_id, actor_id) VALUES (?, ?, ?, ?, ?)').run(taskId, kind, detail || null, messageId, actorId);
  db.prepare('UPDATE tasks SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(taskId);
}

function addClients(taskId, clientIds, actorId = null, { log = true } = {}) {
  const added = [];
  for (const cid of clientIds || []) {
    if (db.prepare('INSERT OR IGNORE INTO task_clients (task_id, client_id) VALUES (?, ?)').run(taskId, cid).changes) added.push(cid);
  }
  if (added.length && log) {
    const names = db.prepare(`SELECT first_name || ' ' || last_name n FROM clients WHERE id IN (${added.map(() => '?').join(',')})`).all(...added).map(r => r.n);
    event(taskId, 'clients', `Client added: ${names.join(', ')}`, { actorId });
  }
}

function create({ title, nextStep = null, status = 'todo', assignedTo = null, followUpAt = null, clientIds = [], source = 'manual', createdBy = null, messageIds = [], detail = null }) {
  const id = db.prepare(`INSERT INTO tasks (title, next_step, status, assigned_to, follow_up_at, source, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(String(title).slice(0, 200), nextStep, status, assignedTo, status === 'waiting' ? followUpAt : null, source, createdBy).lastInsertRowid;
  for (const mid of messageIds) db.prepare('UPDATE email_messages SET task_id = ? WHERE id = ?').run(id, mid);
  addClients(id, clientIds, createdBy, { log: false });
  event(id, 'created', detail || (source === 'email' ? 'Created from an email' : 'Created'), { actorId: createdBy, messageId: messageIds[0] || null });
  return id;
}

const STATUS_WORD = { todo: 'To do', waiting: 'Waiting', done: 'Done' };

// Change a task. patch: { title, next_step, status, assigned_to, follow_up_at }.
function update(id, patch, actorId = null, { detail = null, kind = null, messageId = null } = {}) {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!t) return null;
  const changes = [];
  if (patch.title !== undefined && String(patch.title).trim() && patch.title.trim() !== t.title) {
    db.prepare('UPDATE tasks SET title = ? WHERE id = ?').run(patch.title.trim().slice(0, 200), id); changes.push(`Title: "${patch.title.trim()}"`);
  }
  if (patch.next_step !== undefined && (patch.next_step || null) !== t.next_step) {
    db.prepare('UPDATE tasks SET next_step = ? WHERE id = ?').run(patch.next_step || null, id); changes.push(patch.next_step ? `Next step: ${patch.next_step}` : 'Next step cleared');
  }
  if (patch.assigned_to !== undefined && (patch.assigned_to || null) !== t.assigned_to) {
    db.prepare('UPDATE tasks SET assigned_to = ? WHERE id = ?').run(patch.assigned_to || null, id);
    const p = patch.assigned_to ? db.prepare("SELECT first_name || ' ' || last_name n FROM practitioners WHERE id = ?").get(patch.assigned_to) : null;
    event(id, 'assigned', p ? `Assigned to ${p.n}` : 'Unassigned', { actorId });
  }
  const status = patch.status || t.status;
  if (patch.status && patch.status !== t.status) {
    db.prepare(`UPDATE tasks SET status = ?, done_at = ${status === 'done' ? 'CURRENT_TIMESTAMP' : 'NULL'}, done_by = ? WHERE id = ?`)
      .run(status, status === 'done' ? actorId : null, id);
  }
  const followUp = status === 'waiting' ? (patch.follow_up_at !== undefined ? patch.follow_up_at : (t.follow_up_at || addWorkingDays())) : null;
  if (followUp !== t.follow_up_at) db.prepare('UPDATE tasks SET follow_up_at = ? WHERE id = ?').run(followUp, id);
  if (patch.status && patch.status !== t.status) {
    event(id, kind || 'status', detail || `${STATUS_WORD[status]}${status === 'waiting' && followUp ? ` — follow up ${fmt(followUp)}` : ''}`, { actorId, messageId });
  } else if (status === 'waiting' && followUp !== t.follow_up_at && patch.follow_up_at !== undefined) {
    event(id, kind || 'status', detail || `Follow up ${fmt(followUp)}`, { actorId, messageId });
  } else if (detail) {
    event(id, kind || 'note', detail, { actorId, messageId });
  }
  if (changes.length) event(id, 'edited', changes.join(' · '), { actorId });
  return id;
}

// Task tracking starts at a moment (set when the inbox is first turned into tasks): email received
// before then is history, not new work.
function trackingStarted(msg) {
  const start = setting('tasks_started_at');
  return start && (msg.received_at || '') >= start;
}

// The task of the conversation an email belongs to (most recent, open ones first).
function conversationTask(msg) {
  const refs = [msg.in_reply_to, ...(msg.references_header || '').split(/\s+/)].map(s => (s || '').trim()).filter(Boolean);
  const where = [];
  const params = [];
  if (msg.conversation_id) { where.push('conversation_id = ?'); params.push(msg.conversation_id); }
  if (refs.length) { where.push(`internet_message_id IN (${refs.map(() => '?').join(',')})`); params.push(...refs); }
  if (!where.length) return null;
  return db.prepare(`SELECT t.* FROM email_messages m JOIN tasks t ON t.id = m.task_id
    WHERE m.mailbox = ? AND m.id != ? AND (${where.join(' OR ')}) ORDER BY t.status = 'done', t.id DESC LIMIT 1`).get(msg.mailbox, msg.id, ...params);
}

const emailClients = messageId => db.prepare('SELECT client_id FROM email_message_clients WHERE message_id = ? AND removed_at IS NULL').all(messageId).map(r => r.client_id);

// A new email has been copied in (called by mailLinking after filing).
function onEmailIngested(messageId) {
  const msg = db.prepare('SELECT * FROM email_messages WHERE id = ?').get(messageId);
  if (!msg || msg.task_id || !trackingStarted(msg)) return;
  const task = conversationTask(msg);
  if (msg.direction === 'in') {
    if (task) {
      db.prepare('UPDATE email_messages SET task_id = ? WHERE id = ?').run(task.id, msg.id);
      addClients(task.id, emailClients(msg.id));
      if (task.status !== 'todo') update(task.id, { status: 'todo' }, null, { kind: 'email_in', detail: `New email from ${who(msg)} — back to To do`, messageId: msg.id });
      else event(task.id, 'email_in', `New email from ${who(msg)}`, { messageId: msg.id });
    } else if (!msg.auto_hint) {
      create({ title: cleanTitle(msg.subject), source: 'email', messageIds: [msg.id], clientIds: emailClients(msg.id), detail: `Email from ${who(msg)}` });
    }
    return;
  }
  // Sent by us (from Outlook, or from Therapy — where the sender's choice is applied afterwards).
  if (task) {
    db.prepare('UPDATE email_messages SET task_id = ? WHERE id = ?').run(task.id, msg.id);
    addClients(task.id, emailClients(msg.id));
    if (task.status === 'done') event(task.id, 'email_out', 'Email sent', { messageId: msg.id });
    else update(task.id, { status: 'waiting', follow_up_at: addWorkingDays() }, null, { kind: 'email_out', detail: `Reply sent — waiting for a response, follow up ${fmt(addWorkingDays())}`, messageId: msg.id });
  }
}

// Filing an email adds its clients to its task.
function onEmailFiled(messageId, clientIds, actorId = null) {
  const m = db.prepare('SELECT task_id FROM email_messages WHERE id = ?').get(messageId);
  if (m?.task_id && clientIds?.length) addClients(m.task_id, clientIds, actorId);
}

// After sending from Therapy: what the sender chose. choice: { status: 'waiting'|'done'|'todo'|'none', follow_up_at }.
function applySendChoice(sentMessageId, sourceMessageId, choice, actorId) {
  if (!choice || choice.status === 'none') return;
  const sent = db.prepare('SELECT * FROM email_messages WHERE id = ?').get(sentMessageId);
  let taskId = sent?.task_id || (sourceMessageId && db.prepare('SELECT task_id FROM email_messages WHERE id = ?').get(sourceMessageId)?.task_id);
  const follow = choice.status === 'waiting' ? (choice.follow_up_at || addWorkingDays()) : undefined;
  if (!taskId) {
    const ids = [sourceMessageId, sentMessageId].filter(Boolean);
    taskId = create({ title: cleanTitle(sent?.subject), source: 'email', status: choice.status, followUpAt: follow, createdBy: actorId,
      messageIds: ids, clientIds: sent ? emailClients(sent.id) : [], detail: 'Created when sending an email' });
    return taskId;
  }
  if (sent && !sent.task_id) db.prepare('UPDATE email_messages SET task_id = ? WHERE id = ?').run(taskId, sent.id);
  update(taskId, { status: choice.status, follow_up_at: follow }, actorId, {
    kind: 'email_out', messageId: sentMessageId,
    detail: choice.status === 'waiting' ? `Email sent — waiting for a response, follow up ${fmt(follow)}` : choice.status === 'done' ? 'Email sent — done' : 'Email sent — still To do',
  });
  return taskId;
}

// Moved out of the Outlook Inbox (or deleted there): optionally, its task is done — once none of the
// task's emails are left in the Inbox. Off unless settings.tasks_done_when_left_inbox = '1'.
function onLeftInbox(messageId) {
  if (setting('tasks_done_when_left_inbox') !== '1') return;
  const m = db.prepare('SELECT task_id FROM email_messages WHERE id = ?').get(messageId);
  if (!m?.task_id) return;
  const t = db.prepare('SELECT status FROM tasks WHERE id = ?').get(m.task_id);
  if (!t || t.status === 'done') return;
  const stillInInbox = db.prepare("SELECT 1 FROM email_messages WHERE task_id = ? AND mailbox_removed_at IS NULL AND graph_folder_name = 'Inbox'").get(m.task_id);
  if (!stillInInbox) update(m.task_id, { status: 'done' }, null, { detail: 'Done — handled in Outlook (moved out of the Inbox)' });
}

// Waiting tasks whose follow-up date has come: back to To do.
function dueFollowUps() {
  const today = localDate();
  for (const t of db.prepare("SELECT * FROM tasks WHERE status = 'waiting' AND follow_up_at IS NOT NULL AND follow_up_at <= ?").all(today)) {
    const lastOut = db.prepare("SELECT MAX(received_at) d FROM email_messages WHERE task_id = ? AND direction = 'out'").get(t.id)?.d;
    update(t.id, { status: 'todo' }, null, {
      kind: 'follow_up', detail: lastOut ? `No reply since ${new Date(lastOut).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} — follow up` : 'Follow-up date reached',
    });
  }
}

// One-time start: what's in the Outlook Inbox now is the current to-do list — one task per
// conversation. Mail copied in before this moment never creates tasks.
function seedFromInbox() {
  if (setting('tasks_started_at')) return 0;
  return db.transaction(() => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('tasks_started_at', ?)").run(new Date().toISOString());
    const rows = db.prepare(`SELECT * FROM email_messages WHERE direction = 'in' AND graph_folder_name = 'Inbox' AND mailbox_removed_at IS NULL
      AND task_id IS NULL AND auto_hint IS NULL ORDER BY received_at`).all();
    const byConversation = new Map();
    for (const m of rows) {
      const key = m.conversation_id || `m${m.id}`;
      if (!byConversation.has(key)) byConversation.set(key, []);
      byConversation.get(key).push(m);
    }
    for (const msgs of byConversation.values()) {
      const latest = msgs[msgs.length - 1];
      const thread = latest.conversation_id ? db.prepare('SELECT id FROM email_messages WHERE conversation_id = ? AND task_id IS NULL').all(latest.conversation_id).map(r => r.id) : [latest.id];
      const clients = [...new Set(thread.flatMap(emailClients))];
      create({ title: cleanTitle(latest.subject), source: 'email', messageIds: thread, clientIds: clients, detail: 'From the Outlook Inbox when tasks started' });
    }
    return byConversation.size;
  })();
}

module.exports = { create, update, addClients, event, onEmailIngested, onEmailFiled, applySendChoice, onLeftInbox, dueFollowUps, seedFromInbox, addWorkingDays, cleanTitle };
