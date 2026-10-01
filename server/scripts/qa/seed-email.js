// QA only: puts sample emails into a local QA database so the Email, Tasks and Communications
// screens can be tested without a mailbox. Run it through the same wrapper that points
// better-sqlite3 at qa.db (and MAIL_LOCAL_DIR at a scratch folder) — never against server/pm.db.
//
// It creates clients "ZZ QA Katie Testchild" and "ZZ QA Tom Sample", "ZZ QA Man Na Org"
// with contacts, then emails covering each filing case:
//   - from a parent on gmail (auto-filed to Katie),
//   - from a support coordinator shared by both clients naming both (both suggested and ticked),
//   - from an organisation inbox naming nobody (not auto-filed),
//   - a client named with a run-together name and a nickname,
//   - an invoice with an "Invoice …pdf" attachment (Invoice / payment tag suggested),
//   - a newsletter (Newsletter / marketing tag, no task),
//   - a thread: an email and our reply (task Waiting) then their reply (task back to To do).
// Then it starts tasks from the "Inbox", as the real sync does once the Inbox has been copied in.
const path = require('path');
const MailComposer = require(path.join(__dirname, '../../node_modules/nodemailer/lib/mail-composer'));
const build = o => new Promise((res, rej) => new MailComposer(o).compile().build((e, m) => (e ? rej(e) : res(m))));

(async () => {
  const db = require('../../database');
  if (db.name && db.name.endsWith(`${path.sep}server${path.sep}pm.db`)) throw new Error('Refusing to seed the real server/pm.db — run through the QA wrapper');
  const { ingestEml } = require('../../services/mailIngest');
  const tasks = require('../../services/tasks');
  const MB = process.env.QA_MAILBOX || 'ahp-qa@example.org';
  const set = (k, v) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);
  set('mail_sync_mailbox', MB); set('mail_sync_enabled', '0');
  set('graph_tenant_id', 'qa'); set('graph_client_id', 'qa'); set('graph_client_secret', 'qa'); set('graph_mailbox', MB);
  const client = (f, l) => db.prepare('INSERT INTO clients (first_name, last_name) VALUES (?, ?)').run(f, l).lastInsertRowid;
  const katie = client('ZZ QA Katie', 'Testchild');
  const tom = client('ZZ QA Tom', 'Sample');
  const tian = client('ZZ QA TianYun (Jupiter)', 'Li');
  const contact = (cid, role, name, email, primary = 0) => db.prepare('INSERT INTO client_contacts (client_id, role, name, email, is_primary) VALUES (?, ?, ?, ?, ?)').run(cid, role, name, email, primary);
  contact(katie, 'family', 'Mary Testchild', 'qa.mary.testchild@gmail.com', 1);
  contact(katie, 'support_coordinator', 'Sally Coord', 'sally@qa-coord.example');
  contact(tom, 'support_coordinator', 'Sally Coord', 'sally@qa-coord.example', 1);

  let i = 0;
  const now = Date.now();
  const mail = async (o, g = {}) => {
    i++;
    const raw = await build({ messageId: `<qa-seed-${i}@example>`, to: MB, ...o });
    return (await ingestEml(MB, raw, { id: `QA-SEED-${i}`, folderName: 'Inbox', receivedDateTime: new Date(now - (100 - i) * 60000).toISOString(), ...g })).id;
  };
  await mail({ from: 'Mary Testchild <qa.mary.testchild@gmail.com>', subject: 'Tuesday session', text: 'Can we move to 3pm please?' }, { conversationId: 'QA-C1' });
  await mail({ from: 'Sally Coord <sally@qa-coord.example>', subject: 'Plan reviews - ZZ QA Katie Testchild and ZZ QA Tom Sample', text: 'Could you send progress reports for each?' }, { conversationId: 'QA-C2' });
  await mail({ from: 'Intake Team <intake@qa-provider.example>', subject: 'Quick question', text: 'Do you have capacity this month?' }, { conversationId: 'QA-C3' });
  await mail({ from: 'Intake Team <intake@qa-provider.example>', subject: 'ZZ QA Tian Yun Li - hospitalisation', text: 'Jupiter was admitted on Monday.' }, { conversationId: 'QA-C4' });
  await mail({ from: 'Accounts <accounts@qa-plan.example>', subject: 'Invoice INV-QA-1 for ZZ QA Tom Sample', text: 'Attached.',
    attachments: [{ filename: 'Invoice INV-QA-1.pdf', content: Buffer.from('%PDF-1.4 qa invoice') }] }, { conversationId: 'QA-C5' });
  await mail({ from: 'News <news@qa-shop.example>', subject: 'QA newsletter', text: 'Sale on therapy putty', headers: { 'List-Unsubscribe': '<mailto:unsub@qa-shop.example>' } }, { conversationId: 'QA-C6' });
  await mail({ from: 'Sally Coord <sally@qa-coord.example>', subject: 'Referral for a new client', text: 'Do you have capacity for a new client?' }, { conversationId: 'QA-C7' });

  // Tasks start now, from the Inbox (as the sync does) — then a conversation continues.
  console.log('tasks started:', tasks.seedFromInbox());
  await mail({ from: MB, to: 'sally@qa-coord.example', subject: 'RE: Referral for a new client', text: 'Yes — could you send their details?' },
    { conversationId: 'QA-C7', folderName: 'Sent Items', isSentFolder: true, receivedDateTime: new Date(Date.now() + 1000).toISOString() });
  await mail({ from: 'Sally Coord <sally@qa-coord.example>', subject: 'Re: Referral for a new client', text: 'Details attached. Which services do you offer?' },
    { conversationId: 'QA-C7', receivedDateTime: new Date(Date.now() + 2000).toISOString() });
  console.log(`seeded ${i} emails for ZZ QA clients ${katie}, ${tom}, ${tian}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
