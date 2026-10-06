// "Ask": answers questions about clients from Therapy's own records. Claude (on Amazon Bedrock,
// in Australia) is given read-only search tools (services/askTools.js) and decides which records
// to look at; every fact in its answer cites the record it came from, e.g. [note 124].
//
// Model calls go through the AI gateway (services/ai/gateway.js), which logs each call's tokens
// and cost in ai_usage (feature 'ask') and caps spending per calendar month (setting
// ask_monthly_limit_usd). Conversations are kept per person in ask_conversations
// so follow-up questions can build on earlier ones.
const db = require('../database');
const audit = require('./audit');
const tools = require('./askTools');
const ai = require('./ai/gateway');
const { MODELS } = require('./ai/models');

const DEFAULT_MODEL = 'au.anthropic.claude-sonnet-5';
const MAX_ROUNDS = 15;
const TOOL_RESULT_CHARS = 40000;

const setting = (k, d) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value ?? d;

function config() {
  const model = MODELS[setting('ask_model')] ? setting('ask_model') : DEFAULT_MODEL;
  const limit = Number(setting('ask_monthly_limit_usd', '20')) || 0;
  const spent = ai.spentThisMonth('ask');
  return { model, model_label: MODELS[model].label, models: Object.entries(MODELS).map(([id, m]) => ({ id, label: m.label })), limit_usd: limit, spent_usd: Math.round(spent * 100) / 100 };
}

const KINDS = ['note', 'appointment', 'file', 'zip_entry', 'note_file', 'form', 'report', 'email', 'attachment', 'task'];

const SYSTEM = `You answer questions from the staff of an allied health practice (occupational therapy and physiotherapy) about their clients, using only the practice's own records in Therapy, its practice-management system. You reach the records only through the tools provided.

How to work:
- Find the client first (find_clients), unless the question already gives a client_id. People are often called by a nickname, a first name only, or with spelling variations ("Jupiter" is "TianYun (Jupiter) Li"); a person can have an older inactive duplicate record, so check every matching record.
- client_history lists the last 12 months by default and says how many older records exist; if the answer may be older (e.g. something from a previous year), call it again with an earlier "from" date.
- Use client_history to see what is on file, then search_records with a few different wordings, and read_record to read the documents that look relevant. Give read_record look_for with the words you're after (e.g. "step height back door"): long documents then show only the pages that mention them, which is quicker and cheaper. If those pages don't settle it, read other pages with pages. Answers usually sit inside reports, quotes, letters and emails rather than in titles, so read the documents before answering.
- Old-system backups (zip files) contain earlier notes and reports; read their documents with read_record kind "zip_entry".
- Records often use different words from the question: before concluding something isn't recorded, also search the clinical and related terms (e.g. "hearing test" → audiology, audiologist, hearing aid; "wheelchair" → mobility aid, AT; "ramp" → access, home modification, step).
- Staff use everyday words; records use clinical ones. Treat them as the same thing and answer from the closest matching record, saying how the record describes it (e.g. asked about a "hearing test", answer with the "annual audiologist review" the report recommends). Only say "not recorded" when nothing close is on file.
- Before saying a detail (a date, frequency, amount, measurement) isn't recorded, read the most relevant document with read_record (with look_for, and other pages if needed) — search snippets are short and often miss it.
- Keep searching until you can answer what was asked, or have checked the likely places — don't stop at the first partial match, but don't gather background that wasn't asked for either.

How to answer:
- Start with a one- or two-sentence answer to the question. Then add only the detail needed to answer what was asked — leave out dates, history and background unless asked for (staff can ask a follow-up). State the answer once: no separate "Summary" line, and no closing sentence that repeats it.
- Aim for about 120 words; go longer only when the question asks for a list of several items. Plain sentences, a short list only when listing items.
- If something isn't recorded, say so and mention where you looked in one short phrase (e.g. "checked his OT notes, letters and recent emails") — not a list of every record. Don't ask staff to confirm the client or rephrase unless the name genuinely matches more than one person, and don't end with an offer or question (e.g. "would you like me to search more broadly?").
- When the answer was found, don't add a sentence about what you checked.
- Every fact must be followed by the record it came from, in square brackets, written exactly as kind and id: [note 124], [appointment 528], [file 191], [zip_entry 158:3], [note_file 7], [form 12], [report 4], [email 507], [attachment 2202], [task 16]. Several sources: [file 191] [email 507].
- Only state what the records say. Don't add your own reasoning about consequences, risks or likely outcomes; if the question asks for something the records don't cover (e.g. what happens if an appointment is missed), say it isn't stated in the records rather than inferring it.
- Say clearly what the records show and what they don't. Describe things by the stage the records show: "recommended", "quoted", "ordered", "delivered" — never call a quote an order, or a recommendation something the client got, unless a record says so; then say there's no record of the later stage.
- When asked what was recommended, answer from the assessment, report or recommendation letter that made the recommendation (e.g. "non-slip paint, contrast stair edges and a new handrail"), not the line items of a quote; mention a quote only as the stage it reached.
- A quote is still a quote even if it's headed "order", "urgent order" or similar, or lists lead times. Call something ordered only when a record shows the order was placed (a purchase order, an order confirmation, an invoice, or an email saying it was ordered or approved), and delivered only when a record says it arrived. Don't say the client "got", "went ahead with" or "is getting" items without such a record.
- Don't write notes to yourself while searching. Your final message is shown to staff as the answer, so it must start with the answer itself — never with a comment on the record you just read (e.g. "This letter doesn't mention…", "This answers it"). If the answer isn't in the records, say it wasn't found and where you looked; never guess or fill gaps with general knowledge.
- Write dates as "3 September 2026". Use Australian spelling.
- You can only read records. If asked to change, send or book something, explain that you can't do that yet.`;

const TOOLS = [
  {
    name: 'find_clients',
    description: 'Find clients by name. Matches parts of names, nicknames in brackets and run-together names. Returns client_id, reference (C0039), name, whether active, and date of birth.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Name or part of a name, e.g. "Jupiter" or "Nai Shing"' } }, required: ['query'], additionalProperties: false },
  },
  {
    name: 'client_history',
    description: "A client's details and what's on file for them, newest first: appointments, session notes, files (with the documents inside backup zips), emails, forms, reports and tasks, each with its kind and id for read_record. Lists the last 12 months unless from/to are given, and says how many older records there are.",
    input_schema: { type: 'object', properties: { client_id: { type: 'integer' }, from: { type: ['string', 'null'], description: 'YYYY-MM-DD, or null' }, to: { type: ['string', 'null'], description: 'YYYY-MM-DD, or null' } }, required: ['client_id'], additionalProperties: false },
  },
  {
    name: 'search_records',
    description: "Search the text of session notes, appointments, files (including PDF contents and documents inside backup zips), forms, reports, emails and email attachments. Returns up to 20 matches with a snippet of the matching text, best matches first and newer before older. Give client_id to search one client's records (plus unfiled emails that name them); give null to search everything. Optionally limit to a date range with from/to.",
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Words to look for, e.g. "equipment trial" or "step height back door"' }, client_id: { type: ['integer', 'null'] }, from: { type: ['string', 'null'], description: 'YYYY-MM-DD, or null' }, to: { type: ['string', 'null'], description: 'YYYY-MM-DD, or null' } },
      required: ['query', 'client_id'], additionalProperties: false,
    },
  },
  {
    name: 'read_record',
    description: 'Read one record: a note, document text, email (with its thread and attachments), form answers, report, appointment or task. Short records come back whole. Long documents come back in pages: give look_for to get only the pages that mention those words (recommended), pages to read particular pages, or neither for the start.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: KINDS },
        id: { type: 'string', description: 'The id as shown, e.g. "191" or "158:3" for a zip_entry' },
        look_for: { type: ['string', 'null'], description: 'Words you need from it, e.g. "step height back door", or null' },
        pages: { type: ['string', 'null'], description: 'Pages (or parts) to read, e.g. "3" or "2-4", or null' },
      },
      required: ['kind', 'id'], additionalProperties: false,
    },
  },
];

// Tool inputs stream in as they're written, so check them before running anything.
function checkInput(name, input) {
  const i = input && typeof input === 'object' ? input : null;
  if (!i) return 'input must be an object';
  if (name === 'find_clients') return typeof i.query === 'string' && i.query.trim() ? null : 'query is required';
  const dateOk = d => d === undefined || d === null || /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (!dateOk(i.from) || !dateOk(i.to)) return 'from and to must be dates written YYYY-MM-DD, or null';
  if (name === 'client_history') return Number.isInteger(i.client_id) ? null : 'client_id must be a whole number';
  if (name === 'search_records') return typeof i.query === 'string' && i.query.trim() && (i.client_id === null || i.client_id === undefined || Number.isInteger(i.client_id)) ? null : 'query is required and client_id must be a number or null';
  if (name === 'read_record') {
    if (!KINDS.includes(i.kind) || !/^\d+(:\d+)?$/.test(String(i.id))) return 'kind must be one of the listed kinds and id a number (or file:number for zip_entry)';
    if (i.pages != null && !/^\s*\d+(\s*[-,]\s*\d+)*\s*$/.test(String(i.pages))) return 'pages must look like "3", "2-4" or "2, 5", or be null';
    return null;
  }
  return `unknown tool ${name}`;
}

async function runTool(name, input, opts) {
  if (name === 'find_clients') return tools.findClients(input.query);
  const range = { from: input.from || null, to: input.to || null };
  if (name === 'client_history') return tools.clientTimeline(input.client_id, opts, range);
  if (name === 'search_records') return tools.searchRecords(input.query, input.client_id ?? null, opts, range);
  if (name === 'read_record') return (await tools.readRecord(input.kind, input.id, { ...opts, lookFor: input.look_for || null, pages: input.pages || null })) || { error: `No ${input.kind} with id ${input.id}` };
  return { error: `Unknown tool ${name}` };
}

function describeTool(name, input) {
  if (name === 'find_clients') return `Looking up "${input.query}"`;
  if (name === 'client_history') return input.from ? `Reading the client's history from ${input.from}` : 'Reading the client\'s history';
  if (name === 'search_records') return `Searching for "${input.query}"`;
  if (name === 'read_record') return `Reading ${input.kind.replace('_', ' ')} ${input.id}`;
  return name;
}


// A cited record must exist; the AI occasionally mixes up a kind (e.g. "report 46" for file 46).
const EXISTS_SQL = {
  note: 'SELECT 1 FROM session_notes WHERE id = ?', appointment: 'SELECT 1 FROM appointments WHERE id = ?', file: 'SELECT 1 FROM client_files WHERE id = ?',
  zip_entry: 'SELECT 1 FROM client_files WHERE id = ?', note_file: 'SELECT 1 FROM session_note_files WHERE id = ?', form: 'SELECT 1 FROM form_responses WHERE id = ?',
  report: 'SELECT 1 FROM billable_reports WHERE id = ? AND deleted_at IS NULL', email: 'SELECT 1 FROM email_messages WHERE id = ?',
  attachment: 'SELECT 1 FROM email_attachments WHERE id = ?', task: 'SELECT 1 FROM tasks WHERE id = ?',
};
const citationExists = (kind, id) => !!db.prepare(EXISTS_SQL[kind]).get(Number(String(id).split(':')[0]));
const CITE = /\[(note|appointment|file|zip_entry|note_file|form|report|email|attachment|task) (\d+(?::\d+)?)\]/g;
// Remove citations to records that don't exist (and the space before them).
const dropBadCitations = text => String(text).replace(new RegExp(` ?${CITE.source}`, 'g'), (m, kind, id) => (citationExists(kind, id) ? m : ''));

// Sources cited in an answer, with the client each belongs to so the page can link to it.
function sourcesIn(text) {
  const seen = new Map();
  for (const m of String(text).matchAll(/\[(note|appointment|file|zip_entry|note_file|form|report|email|attachment|task) (\d+(?::\d+)?)\]/g)) {
    const key = `${m[1]} ${m[2]}`;
    if (seen.has(key)) continue;
    const source = { kind: m[1], id: m[2], client_id: tools.clientOf(m[1], m[2]) };
    if (m[1] === 'attachment') source.email_id = db.prepare('SELECT message_id FROM email_attachments WHERE id = ?').get(Number(m[2]))?.message_id || null;
    const name = tools.nameOf(m[1], m[2]);
    if (name) source.name = name;
    seen.set(key, source);
  }
  return [...seen.values()];
}

// ---- filing conversations to clients ----
// The clients a set of answer sources belong to: a record's own client, the clients an email is
// filed to, and a task's clients.
function clientsOfSources(sources) {
  const ids = new Set();
  for (const s of sources) {
    if (s.client_id) ids.add(Number(s.client_id));
    const emailId = s.kind === 'email' ? Number(s.id) : s.kind === 'attachment' ? s.email_id : null;
    if (emailId) for (const r of db.prepare('SELECT client_id FROM email_message_clients WHERE message_id = ? AND removed_at IS NULL').all(emailId)) ids.add(r.client_id);
    if (s.kind === 'task') for (const r of db.prepare('SELECT client_id FROM task_clients WHERE task_id = ?').all(Number(s.id))) ids.add(r.client_id);
  }
  return [...ids];
}

// Clients a conversation looked up specifically (their history, or a search limited to them) —
// what it was about, even when the answer found nothing to cite. Reads the tool calls in either
// provider's message format.
function clientsLookedUp(messages) {
  const ids = new Set();
  for (const m of messages) {
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      const call = b.type === 'tool_use' ? b : b.toolUse ? { name: b.toolUse.name, input: b.toolUse.input } : null;
      if (call && ['client_history', 'search_records'].includes(call.name) && Number.isInteger(call.input?.client_id)) ids.add(call.input.client_id);
    }
  }
  return [...ids];
}

const filedClients = conversationId => db.prepare(`SELECT c.id, c.first_name || ' ' || c.last_name AS name, c.active, l.method FROM ask_conversation_clients l
  JOIN clients c ON c.id = l.client_id WHERE l.conversation_id = ? AND l.removed_at IS NULL ORDER BY c.first_name, c.last_name`).all(conversationId);

// File a conversation to clients (skipping ones it's already filed to, and — for automatic filing —
// ones a person took it off). Each new filing goes in the client's history. Inactive (past)
// clients are filed like any other, with the same rule as email suggestions: when an active
// client with the same name is also involved, the inactive duplicate is left out.
const sameName = c => `${c.first_name} ${c.last_name}`.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
function fileToClients(conversationId, clientIds, method, userId) {
  const conv = db.prepare('SELECT title FROM ask_conversations WHERE id = ?').get(conversationId);
  const involved = [...db.prepare('SELECT client_id FROM ask_conversation_clients WHERE conversation_id = ? AND removed_at IS NULL').all(conversationId).map(r => r.client_id), ...clientIds]
    .map(id => db.prepare('SELECT id, first_name, last_name, active FROM clients WHERE id = ?').get(id)).filter(Boolean);
  const activeNames = new Set(involved.filter(c => c.active).map(sameName));
  const added = [];
  for (const cid of clientIds) {
    const client = db.prepare('SELECT id, first_name, last_name, merged_into, active FROM clients WHERE id = ?').get(cid);
    if (!client) continue;
    if (method !== 'manual' && !client.merged_into && !client.active && activeNames.has(sameName(client))) continue;
    const target = client.merged_into || client.id;
    if (db.prepare('SELECT 1 FROM ask_conversation_clients WHERE conversation_id = ? AND client_id = ? AND removed_at IS NULL').get(conversationId, target)) continue;
    if (method !== 'manual' && db.prepare('SELECT 1 FROM ask_conversation_clients WHERE conversation_id = ? AND client_id = ? AND removed_by IS NOT NULL').get(conversationId, target)) continue;
    db.prepare('INSERT INTO ask_conversation_clients (conversation_id, client_id, method, added_by) VALUES (?, ?, ?, ?)').run(conversationId, target, method, userId);
    audit.log('client', target, 'ask_conversation_filed', `Ask conversation filed: "${conv?.title || ''}"`);
    added.push(target);
  }
  return added;
}

function unfileFromClient(conversationId, clientId, userId) {
  const r = db.prepare("UPDATE ask_conversation_clients SET removed_at = CURRENT_TIMESTAMP, removed_by = ? WHERE conversation_id = ? AND client_id = ? AND removed_at IS NULL").run(userId, conversationId, clientId);
  if (r.changes) {
    const conv = db.prepare('SELECT title FROM ask_conversations WHERE id = ?').get(conversationId);
    audit.log('client', clientId, 'ask_conversation_removed', `Ask conversation removed from this client: "${conv?.title || ''}"`);
  }
  return r.changes > 0;
}

class AskError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

// Answer one question (optionally continuing a conversation), reporting progress through
// The model sometimes starts its answer with a comment on the record it just read ("This letter
// doesn't mention a back door step — …") or ends a not-found answer by asking staff to confirm the
// client. Both are against its instructions; remove them so the answer starts with the answer.
const LEADING_NOTE = /^(?:this|that|these|the above)\s+(?:letter|document|email|note|record|report|file|quote|one|thread|page|pdf|mentions?|doesn't|does not|answers?|confirms?|shows?|gives?|is about|concerns?|only)\b[^.!?\n]*[.!?]\s*/i;
const TRAILING_ASK = /\s*(?:If (?:a|an|the|this|that|any)\b[^.?\n]*(?:clarify|confirm|check|exists elsewhere|is recorded elsewhere|elsewhere)[^.?\n]*[.?]|(?:Could|Can|Would) you (?:please )?(?:confirm|clarify|check)[^?\n]*\?|Please (?:confirm|clarify)[^.?\n]*[.?])\s*$/i;
// A first sentence that talks about "this note" / "this letter" is about the record just read.
const RECORD_WORDS = '(?:note|letter|document|email|record|report|file|quote|thread|page|pdf|attachment)';
const LEADING_THIS = new RegExp(`^[^.!?\\n]*\\b(?:in|from|of)?\\s*(?:this|that)\\s+${RECORD_WORDS}\\b[^.!?\\n]*[.!?]\\s*`, 'i');
function tidyAnswer(text) {
  let t = String(text || '').trim();
  // Only a "this note" sentence saying what's NOT there is dropped; one that gives the answer
  // ("According to this report, the trial was on 3 September") is kept.
  const negativeThis = x => { const m = x.match(LEADING_THIS); return !!m && /\b(?:no|not|doesn't|does not|isn't|only|without|nothing)\b/i.test(m[0]); };
  for (let i = 0; i < 2 && (LEADING_NOTE.test(t) || negativeThis(t)); i++) {
    const rest = t.replace(LEADING_NOTE.test(t) ? LEADING_NOTE : LEADING_THIS, '').trim();
    if (rest.length < 25) break;
    t = rest.replace(/^[—–-]\s*/, '');
    t = t.charAt(0).toUpperCase() + t.slice(1);
  }
  // An answer never ends by questioning staff ("would you like me to search more broadly?") or
  // suggesting they meant someone else; drop up to two such closing sentences.
  let trimmed = t.replace(TRAILING_ASK, '').trim();
  const lastSentence = /(?:^|(?<=[.!?\]])\s+)([^.!?]*(?:[.!?](?![^\s]))?)\s*$/;
  for (let i = 0; i < 2; i++) {
    const m = trimmed.match(lastSentence);
    const last = m ? m[1].trim() : '';
    if (!last) break;
    const isQuestion = last.endsWith('?');
    const meantElse = /\b(?:different|another|other) (?:client|record|person|name)\b|\byou(?:'re| are| may be| might be) thinking of\b/i.test(last);
    if (!isQuestion && !meantElse) break;
    const rest = trimmed.slice(0, trimmed.length - m[0].length).trim();
    if (rest.length < 40) break;
    trimmed = rest;
  }
  return trimmed.length >= 40 ? trimmed : t;
}

// onEvent: { type: 'status', text } while searching, { type: 'text', text } as the answer is
// written, { type: 'restart' } when the model goes back to searching after writing some text.
// `modelId` overrides the Settings choice (used to compare models side by side); a follow-up
// always continues with the model the conversation started on.
// `effort` overrides the Settings choice (Claude only: how hard it thinks and searches). Low is
// the default: on the 2026-10-02 test it was as accurate as medium and ~23% cheaper.
async function ask({ user, question, conversationId, clientId, canEmail, modelId, effort }, onEvent = () => {}) {
  const q = String(question || '').trim();
  if (!q) throw new AskError('Type a question');
  const cfg = config();
  try { ai.checkBudget('ask', 'Ask'); } catch (e) { throw new AskError(e.message, 402); }
  let convo = null;
  if (conversationId) {
    convo = db.prepare('SELECT * FROM ask_conversations WHERE id = ? AND user_id = ?').get(conversationId, user.id);
    if (!convo) throw new AskError('That conversation was not found', 404);
    if (convo.status === 'answering') throw new AskError('Still answering the last question in this conversation — wait for it, or start a new question.', 409);
  }
  const useModel = (convo?.model && MODELS[convo.model]) ? convo.model : (modelId && MODELS[modelId] ? modelId : cfg.model);
  const model = MODELS[useModel];
  const provider = ai.formatFor(useModel);
  const EFFORTS = ['low', 'medium', 'high'];
  const useEffort = EFFORTS.includes(effort) ? effort : EFFORTS.includes(setting('ask_effort')) ? setting('ask_effort') : 'low';
  const messages = convo ? JSON.parse(convo.messages_json) : [];
  const turns = convo ? JSON.parse(convo.turns_json) : [];
  const scopeId = convo ? convo.client_id : (clientId ? Number(clientId) : null);
  const scope = scopeId && db.prepare('SELECT id, first_name, last_name FROM clients WHERE id = ?').get(scopeId);
  const today = new Date().toLocaleDateString('en-AU', { timeZone: 'Australia/Melbourne', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const intro = messages.length ? '' : `Today is ${today}.${scope ? ` This conversation is about ${scope.first_name} ${scope.last_name} (client_id ${scope.id}).` : ''}\n\n`;
  messages.push(provider.user(`${intro}${q}`));

  // The conversation (and the question, marked as being answered) is saved straight away, so it
  // shows in the list as "Answering…" and the person can move on — or ask other questions —
  // while this one is worked out. The answer replaces the pending turn when it's done.
  const askedAt = new Date().toISOString();
  const pendingTurn = { question: q, asked_at: askedAt, pending: true };
  let id = convo?.id;
  if (id) {
    db.prepare("UPDATE ask_conversations SET turns_json = ?, status = 'answering', updated_at = datetime('now') WHERE id = ?").run(JSON.stringify([...turns, pendingTurn]), id);
  } else {
    id = db.prepare("INSERT INTO ask_conversations (user_id, client_id, model, title, messages_json, turns_json, status) VALUES (?, ?, ?, ?, '[]', ?, 'answering')")
      .run(user.id, scope ? scope.id : null, useModel, q.slice(0, 120), JSON.stringify([pendingTurn])).lastInsertRowid;
    if (scope) fileToClients(id, [scope.id], 'started', user.id);
  }
  onEvent({ type: 'started', conversation_id: id, asked_at: askedAt });

  const opts = { canEmail };
  let cost = 0;
  let answer = '';

  try {
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let wrote = false;
    const turn = await ai.turn({
      feature: 'ask', model: useModel, system: SYSTEM, tools: TOOLS, messages, effort: useEffort,
      onText: delta => { wrote = true; onEvent({ type: 'text', text: delta }); },
      userId: user.id, ref: { type: 'ask_conversation', id }, skipBudget: true,
    });
    cost += turn.cost_usd;

    if (turn.stop === 'refusal') { answer = 'The AI declined to answer this question. Try rewording it.'; break; }
    if (turn.stop === 'max_tokens' && turn.toolUses.length) { answer = 'The answer got too long to finish. Try a narrower question.'; break; }
    if (!turn.toolUses.length) { answer = turn.text; break; }

    if (wrote) onEvent({ type: 'restart' });
    const results = [];
    for (const t of turn.toolUses) {
      const problem = checkInput(t.name, t.input);
      if (problem) { results.push({ id: t.id, error: true, content: `Invalid input: ${problem}` }); continue; }
      onEvent({ type: 'status', text: describeTool(t.name, t.input) });
      let out;
      try { out = JSON.stringify(await runTool(t.name, t.input, opts)); } catch (e) { out = JSON.stringify({ error: `The lookup failed: ${e.message}` }); }
      if (out.length > TOOL_RESULT_CHARS) out = `${out.slice(0, TOOL_RESULT_CHARS)}… [cut short — read individual records for the rest]`;
      results.push({ id: t.id, content: out });
    }
    messages.push(provider.results(results));
    if (round === MAX_ROUNDS - 1) answer = 'I looked through a lot of records without settling on an answer. Try a more specific question.';
  }
  } catch (e) {
    // Record that this question failed (the gateway has already logged the calls that happened).
    db.transaction(() => {
      const failed = { question: q, asked_at: askedAt, answer: 'This question could not be answered (Ask had a problem). Please ask it again.', failed: true, sources: [], at: new Date().toISOString() };
      db.prepare("UPDATE ask_conversations SET turns_json = ?, status = 'done', updated_at = datetime('now') WHERE id = ?").run(JSON.stringify([...turns, failed]), id);
    })();
    throw e;
  }

  answer = dropBadCitations(tidyAnswer(answer));
  const sources = sourcesIn(answer);
  const now = new Date().toISOString();
  turns.push({ question: q, asked_at: askedAt, answer, sources, cost_usd: Math.round(cost * 10000) / 10000, at: now });
  db.transaction(() => {
    db.prepare("UPDATE ask_conversations SET messages_json = ?, turns_json = ?, status = 'done', updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(messages), JSON.stringify(turns), id);
    // File it to the clients its answer drew on.
    fileToClients(id, clientsOfSources(sources), 'cited', user.id);
    fileToClients(id, clientsLookedUp(messages), 'looked_up', user.id);
  })();
  return { conversation_id: id, answer, sources, model: model.label, cost_usd: Math.round(cost * 10000) / 10000 };
}

module.exports = { tidyAnswer, ask, config, MODELS, AskError, sourcesIn, dropBadCitations, filedClients, fileToClients, unfileFromClient, clientsOfSources, clientsLookedUp };
