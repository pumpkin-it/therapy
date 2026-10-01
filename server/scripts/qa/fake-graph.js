// QA only: a stand-in for Microsoft Graph so sending email can be tested on a local copy without
// anything leaving the machine. Implements just what services/mailSend.js uses: drafts (new,
// reply, reply-all, forward), editing them, attachments (small and chunked), reading a draft's
// Message-ID and raw copy, sending and deleting. Each "sent" email is printed to the console.
//
//   node server/scripts/qa/fake-graph.js            (listens on 4597)
//
// Point the QA server at it with GRAPH_BASE_URL=http://localhost:4597/v1.0 and answer the token
// request locally (see the regression checklist, "How to run this", option B).
const http = require('http');
const path = require('path');
const MailComposer = require(path.join(__dirname, '../../node_modules/nodemailer/lib/mail-composer'));

const PORT = Number(process.env.FAKE_GRAPH_PORT || 4597);
const build = o => new Promise((res, rej) => new MailComposer(o).compile().build((e, m) => (e ? rej(e) : res(m))));
const drafts = {};
let n = 0;
const addr = list => (list || []).map(r => r.emailAddress.address).join(', ');

http.createServer(async (req, res) => {
  let body = Buffer.alloc(0);
  for await (const c of req) body = Buffer.concat([body, c]);
  const json = () => { try { return JSON.parse(body.toString() || '{}'); } catch { return {}; } };
  const reply = (code, b) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(b === undefined ? '' : JSON.stringify(b)); };
  const p = new URL(req.url, 'http://x').pathname.replace('/v1.0', '');
  let m;
  if (req.method === 'PUT' && (m = p.match(/^\/upload\/(\w+)$/))) return reply(200, {});
  if (req.method === 'POST' && /^\/users\/[^/]+\/messages$/.test(p)) {
    const id = `D${++n}`; drafts[id] = { ...json(), kind: 'new', atts: [] }; return reply(201, { id, body: { content: '' } });
  }
  if (req.method === 'POST' && (m = p.match(/^\/users\/[^/]+\/messages\/([^/]+)\/(createReply|createReplyAll|createForward)$/))) {
    const id = `D${++n}`; drafts[id] = { kind: m[2], of: decodeURIComponent(m[1]), atts: [] };
    return reply(201, { id, body: { content: '<hr><div>(quoted original email)</div>' } });
  }
  if ((m = p.match(/^\/users\/[^/]+\/messages\/(D\d+)$/))) {
    if (req.method === 'PATCH') { Object.assign(drafts[m[1]], json()); return reply(200, {}); }
    if (req.method === 'DELETE') { delete drafts[m[1]]; return reply(204); }
    if (req.method === 'GET') return reply(200, { internetMessageId: `<${m[1]}.${Date.now()}@fake-graph.local>` });
  }
  if (req.method === 'POST' && (m = p.match(/^\/users\/[^/]+\/messages\/(D\d+)\/attachments$/))) { drafts[m[1]].atts.push(json().name); return reply(201, {}); }
  if (req.method === 'POST' && (m = p.match(/^\/users\/[^/]+\/messages\/(D\d+)\/attachments\/createUploadSession$/))) {
    drafts[m[1]].atts.push(json().AttachmentItem?.name); return reply(201, { uploadUrl: `http://localhost:${PORT}/upload/${m[1]}` });
  }
  if (req.method === 'GET' && (m = p.match(/^\/users\/([^/]+)\/messages\/(D\d+)\/\$value$/))) {
    const d = drafts[m[2]];
    const raw = await build({ from: decodeURIComponent(m[1]), to: addr(d.toRecipients), cc: addr(d.ccRecipients), subject: d.subject,
      html: d.body?.content || '', messageId: `<${m[2]}@fake-graph.local>` });
    res.writeHead(200); return res.end(raw);
  }
  if (req.method === 'POST' && (m = p.match(/^\/users\/[^/]+\/messages\/(D\d+)\/send$/))) {
    const d = drafts[m[1]];
    console.log(`[fake-graph] SENT (${d.kind}) to: ${addr(d.toRecipients)}${d.ccRecipients?.length ? ` cc: ${addr(d.ccRecipients)}` : ''} — "${d.subject}"${d.atts.length ? ` [attachments: ${d.atts.join(', ')}]` : ''}`);
    return reply(202);
  }
  reply(404, { error: { code: 'NotImplementedInFake', message: `${req.method} ${p}` } });
}).listen(PORT, () => console.log(`[fake-graph] listening on ${PORT}`));
