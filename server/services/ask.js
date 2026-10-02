// "Ask": answers questions about clients from Therapy's own records. Claude (on Amazon Bedrock,
// in Australia) is given read-only search tools (services/askTools.js) and decides which records
// to look at; every fact in its answer cites the record it came from, e.g. [note 124].
//
// Spending is capped per calendar month (setting ask_monthly_limit_usd); every model call's
// token use and cost is kept in ask_usage. Conversations are kept per person in ask_conversations
// so follow-up questions can build on earlier ones.
const { AnthropicBedrock } = require('@anthropic-ai/bedrock-sdk');
const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');
const db = require('../database');
const audit = require('./audit');
const tools = require('./askTools');

// Models that keep data in Australia: Claude through Bedrock's AU inference profiles (Sydney and
// Melbourne), and Amazon Nova Pro in Sydney itself (Bedrock's Converse API). Prices are US$ per
// million tokens in those regions (Claude's include AWS's 10% regional premium).
const MODELS = {
  'au.anthropic.claude-sonnet-5': { label: 'Claude Sonnet 5', provider: 'claude', in: 2.2, out: 11, cacheWrite: 2.75, cacheRead: 0.22, eager: true },
  'au.anthropic.claude-opus-5-5': { label: 'Claude Opus 5.5', provider: 'claude', in: 4.4, out: 22, cacheWrite: 5.5, cacheRead: 0.22, eager: true },
  'au.anthropic.claude-haiku-4-5-20251001-v1:0': { label: 'Claude Haiku 4.5', provider: 'claude', in: 1.1, out: 5.5, cacheWrite: 1.375, cacheRead: 0.11, eager: false },
  'amazon.nova-pro-v1:0': { label: 'Amazon Nova Pro', provider: 'converse', in: 0.84, out: 3.36, cacheWrite: 0, cacheRead: 0.21, maxTokens: 5000 },
  // Open models served by Bedrock in Sydney (in-region), for comparison against Claude.
  'deepseek.v3.2': { label: 'DeepSeek V3.2', provider: 'converse', in: 0.64, out: 1.91, cacheWrite: 0, cacheRead: 0, maxTokens: 8000 },
  'qwen.qwen3-235b-a22b-2507-v1:0': { label: 'Qwen 3 235B', provider: 'converse', in: 0.2266, out: 0.9064, cacheWrite: 0, cacheRead: 0, maxTokens: 8000 },
  'moonshotai.kimi-k2.5': { label: 'Kimi K2.5', provider: 'converse', in: 0.62, out: 3.09, cacheWrite: 0, cacheRead: 0, maxTokens: 8000 },
  'zai.glm-5': { label: 'GLM 5', provider: 'converse', in: 1.03, out: 3.3, cacheWrite: 0, cacheRead: 0, maxTokens: 8000 },
};
const DEFAULT_MODEL = 'au.anthropic.claude-sonnet-5';
const MAX_ROUNDS = 15;
const TOOL_RESULT_CHARS = 40000;

const REGION = process.env.ASK_AWS_REGION || 'ap-southeast-2';
let claudeClient, converseClient;
const claude = () => (claudeClient = claudeClient || new AnthropicBedrock({ awsRegion: REGION }));
const bedrockRuntime = () => (converseClient = converseClient || new BedrockRuntimeClient({ region: REGION }));
const setting = (k, d) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value ?? d;

function config() {
  const model = MODELS[setting('ask_model')] ? setting('ask_model') : DEFAULT_MODEL;
  const limit = Number(setting('ask_monthly_limit_usd', '20')) || 0;
  const monthStart = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Melbourne' }));
  const since = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}-01`;
  const spent = db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM ask_usage WHERE created_at >= datetime(?, '-11 hours')").get(since).c;
  return { model, model_label: MODELS[model].label, models: Object.entries(MODELS).map(([id, m]) => ({ id, label: m.label })), limit_usd: limit, spent_usd: Math.round(spent * 100) / 100 };
}

const KINDS = ['note', 'appointment', 'file', 'zip_entry', 'note_file', 'form', 'report', 'email', 'attachment', 'task'];

const SYSTEM = `You answer questions from the staff of an allied health practice (occupational therapy and physiotherapy) about their clients, using only the practice's own records in Therapy, its practice-management system. You reach the records only through the tools provided.

How to work:
- Find the client first (find_clients), unless the question already gives a client_id. People are often called by a nickname, a first name only, or with spelling variations ("Jupiter" is "TianYun (Jupiter) Li"); a person can have an older inactive duplicate record, so check every matching record.
- client_history lists the last 12 months by default and says how many older records exist; if the answer may be older (e.g. something from a previous year), call it again with an earlier "from" date.
- Use client_history to see what is on file, then search_records with a few different wordings, and read_record to read the documents that look relevant in full. Answers usually sit inside reports, quotes, letters and emails rather than in titles, so read the documents before answering.
- Old-system backups (zip files) contain earlier notes and reports; read their documents with read_record kind "zip_entry".
- Keep searching until you can answer what was asked, or have checked the likely places — don't stop at the first partial match, but don't gather background that wasn't asked for either.

How to answer:
- Start with a one- or two-sentence answer to the question. Then add only the detail needed to answer what was asked — leave out dates, history and background unless asked for (staff can ask a follow-up). State the answer once: no separate "Summary" line, and no closing sentence that repeats it.
- Aim for about 120 words; go longer only when the question asks for a list of several items. Plain sentences, a short list only when listing items.
- If something isn't recorded, say so and mention where you looked in one short phrase (e.g. "checked his OT notes, letters and recent emails") — not a list of every record. Don't ask staff to confirm the client or rephrase unless the name genuinely matches more than one person.
- When the answer was found, don't add a sentence about what you checked.
- Every fact must be followed by the record it came from, in square brackets, written exactly as kind and id: [note 124], [appointment 528], [file 191], [zip_entry 158:3], [note_file 7], [form 12], [report 4], [email 507], [attachment 2202], [task 16]. Several sources: [file 191] [email 507].
- Say clearly what the records show and what they don't. Describe things by the stage the records show: "recommended", "quoted", "ordered", "delivered" — never call a quote an order, or a recommendation something the client got, unless a record says so; then say there's no record of the later stage.
- Don't write notes to yourself while searching. Your final message is shown to staff as the answer, so it must start with the answer itself. If the answer isn't in the records, say it wasn't found and where you looked; never guess or fill gaps with general knowledge.
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
    description: 'Read one record in full: the whole note, document text, email (with its thread and attachments), form answers, report, appointment or task.',
    input_schema: {
      type: 'object',
      properties: { kind: { type: 'string', enum: KINDS }, id: { type: 'string', description: 'The id as shown, e.g. "191" or "158:3" for a zip_entry' } },
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
  if (name === 'read_record') return KINDS.includes(i.kind) && /^\d+(:\d+)?$/.test(String(i.id)) ? null : 'kind must be one of the listed kinds and id a number (or file:number for zip_entry)';
  return `unknown tool ${name}`;
}

async function runTool(name, input, opts) {
  if (name === 'find_clients') return tools.findClients(input.query);
  const range = { from: input.from || null, to: input.to || null };
  if (name === 'client_history') return tools.clientTimeline(input.client_id, opts, range);
  if (name === 'search_records') return tools.searchRecords(input.query, input.client_id ?? null, opts, range);
  if (name === 'read_record') return (await tools.readRecord(input.kind, input.id, opts)) || { error: `No ${input.kind} with id ${input.id}` };
  return { error: `Unknown tool ${name}` };
}

function describeTool(name, input) {
  if (name === 'find_clients') return `Looking up "${input.query}"`;
  if (name === 'client_history') return input.from ? `Reading the client's history from ${input.from}` : 'Reading the client\'s history';
  if (name === 'search_records') return `Searching for "${input.query}"`;
  if (name === 'read_record') return `Reading ${input.kind.replace('_', ' ')} ${input.id}`;
  return name;
}

const costOf = (u, m) => (u.input * m.in + u.output * m.out + u.cacheWrite * m.cacheWrite + u.cacheRead * m.cacheRead) / 1e6;

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

// One model turn, in each provider's own message format. Both return the text written, the tool
// calls asked for as { id, name, input }, why it stopped, and token use; and both add the turn
// (and later the tool results) to `messages` in the shape that provider expects back.
// Each round re-sends the whole conversation so far. A cache breakpoint on the newest message
// lets the next round read everything before it from Bedrock's prompt cache at a tenth of the
// input price. Added to a copy for this request only, so at most one message breakpoint is ever
// sent (plus the system prompt's and the tools'); the stored conversation is left as it was.
function withCacheBreakpoint(messages) {
  if (!messages.length) return messages;
  const last = messages[messages.length - 1];
  const blocks = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : last.content;
  const marked = blocks.map((b, i) => (i === blocks.length - 1 ? { ...b, cache_control: { type: 'ephemeral' } } : b));
  return [...messages.slice(0, -1), { ...last, content: marked }];
}

const claudeTurns = {
  user: text => ({ role: 'user', content: text }),
  async turn(modelId, model, messages, onText, opts = {}) {
    const tools = TOOLS.map((t, i) => ({ ...t, ...(model.eager ? { eager_input_streaming: true } : {}), ...(i === TOOLS.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}) }));
    const stream = claude().messages.stream({
      model: modelId,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: opts.effort },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools,
      messages: withCacheBreakpoint(messages),
    });
    stream.on('text', onText);
    const msg = await stream.finalMessage();
    messages.push({ role: 'assistant', content: msg.content });
    const u = msg.usage || {};
    return {
      text: msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n\n').trim(),
      toolUses: msg.content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, input: b.input })),
      stop: msg.stop_reason === 'refusal' ? 'refusal' : msg.stop_reason === 'max_tokens' ? 'max_tokens' : 'ok',
      usage: { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0, cacheRead: u.cache_read_input_tokens || 0 },
    };
  },
  results: rs => ({ role: 'user', content: rs.map(r => ({ type: 'tool_result', tool_use_id: r.id, content: r.content, ...(r.error ? { is_error: true } : {}) })) }),
};

// Converse tool schemas (Nova and the open models): no "null" type unions, so an omitted
// client_id means "everyone".
const novaSchema = schema => {
  const props = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, Array.isArray(v.type) ? { ...v, type: v.type.find(t => t !== 'null') } : v]));
  const required = schema.required.filter(k => !Array.isArray(schema.properties[k].type));
  return { type: 'object', properties: props, required };
};
const converseTurns = {
  user: text => ({ role: 'user', content: [{ text }] }),
  async turn(modelId, model, messages) {
    const res = await bedrockRuntime().send(new ConverseCommand({
      modelId,
      system: [{ text: SYSTEM }],
      messages,
      toolConfig: { tools: TOOLS.map(t => ({ toolSpec: { name: t.name, description: t.description, inputSchema: { json: novaSchema(t.input_schema) } } })) },
      inferenceConfig: { maxTokens: model.maxTokens || 5000, temperature: 0.2 },
    }));
    const content = res.output?.message?.content || [];
    messages.push({ role: 'assistant', content });
    const u = res.usage || {};
    return {
      text: content.filter(b => b.text).map(b => b.text).join('\n\n').replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim(),
      toolUses: content.filter(b => b.toolUse).map(b => ({ id: b.toolUse.toolUseId, name: b.toolUse.name, input: b.toolUse.input })),
      stop: res.stopReason === 'content_filtered' || res.stopReason === 'guardrail_intervened' ? 'refusal' : res.stopReason === 'max_tokens' ? 'max_tokens' : 'ok',
      usage: { input: u.inputTokens || 0, output: u.outputTokens || 0, cacheWrite: u.cacheWriteInputTokens || 0, cacheRead: u.cacheReadInputTokens || 0 },
    };
  },
  results: rs => ({ role: 'user', content: rs.map(r => ({ toolResult: { toolUseId: r.id, content: [{ text: r.content }], ...(r.error ? { status: 'error' } : {}) } })) }),
};
const PROVIDERS = { claude: claudeTurns, converse: converseTurns };

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
  if (cfg.limit_usd > 0 && cfg.spent_usd >= cfg.limit_usd) {
    throw new AskError(`This month's Ask spending limit (US$${cfg.limit_usd}) has been reached. An owner can raise it in Settings.`, 402);
  }
  let convo = null;
  if (conversationId) {
    convo = db.prepare('SELECT * FROM ask_conversations WHERE id = ? AND user_id = ?').get(conversationId, user.id);
    if (!convo) throw new AskError('That conversation was not found', 404);
  }
  const useModel = (convo?.model && MODELS[convo.model]) ? convo.model : (modelId && MODELS[modelId] ? modelId : cfg.model);
  const model = MODELS[useModel];
  const provider = PROVIDERS[model.provider];
  const EFFORTS = ['low', 'medium', 'high'];
  const useEffort = EFFORTS.includes(effort) ? effort : EFFORTS.includes(setting('ask_effort')) ? setting('ask_effort') : 'low';
  const messages = convo ? JSON.parse(convo.messages_json) : [];
  const turns = convo ? JSON.parse(convo.turns_json) : [];
  const scopeId = convo ? convo.client_id : (clientId ? Number(clientId) : null);
  const scope = scopeId && db.prepare('SELECT id, first_name, last_name FROM clients WHERE id = ?').get(scopeId);
  const today = new Date().toLocaleDateString('en-AU', { timeZone: 'Australia/Melbourne', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const intro = messages.length ? '' : `Today is ${today}.${scope ? ` This conversation is about ${scope.first_name} ${scope.last_name} (client_id ${scope.id}).` : ''}\n\n`;
  messages.push(provider.user(`${intro}${q}`));

  const opts = { canEmail };
  let cost = 0;
  let answer = '';
  const logUsage = db.prepare('INSERT INTO ask_usage (conversation_id, user_id, model, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const usageRows = [];

  try {
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let wrote = false;
    const turn = await provider.turn(useModel, model, messages, delta => { wrote = true; onEvent({ type: 'text', text: delta }); }, { effort: useEffort });
    const c = costOf(turn.usage, model);
    cost += c;
    usageRows.push([turn.usage.input, turn.usage.output, turn.usage.cacheWrite, turn.usage.cacheRead, c]);

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
    // Keep the cost of the calls that did happen before the failure.
    for (const r of usageRows) logUsage.run(convo?.id || null, user.id, useModel, ...r);
    throw e;
  }

  const sources = sourcesIn(answer);
  const now = new Date().toISOString();
  turns.push({ question: q, answer, sources, cost_usd: Math.round(cost * 10000) / 10000, at: now });
  const save = db.transaction(() => {
    let id = convo?.id;
    if (id) {
      db.prepare("UPDATE ask_conversations SET messages_json = ?, turns_json = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(messages), JSON.stringify(turns), id);
    } else {
      id = db.prepare('INSERT INTO ask_conversations (user_id, client_id, model, title, messages_json, turns_json) VALUES (?, ?, ?, ?, ?, ?)')
        .run(user.id, scope ? scope.id : null, useModel, q.slice(0, 120), JSON.stringify(messages), JSON.stringify(turns)).lastInsertRowid;
    }
    for (const r of usageRows) logUsage.run(id, user.id, useModel, ...r);
    // File it to the client it was asked about, and the clients its answer drew on.
    if (scope && !convo) fileToClients(id, [scope.id], 'started', user.id);
    fileToClients(id, clientsOfSources(sources), 'cited', user.id);
    fileToClients(id, clientsLookedUp(messages), 'looked_up', user.id);
    return id;
  });
  const id = save();
  return { conversation_id: id, answer, sources, model: model.label, cost_usd: Math.round(cost * 10000) / 10000 };
}

module.exports = { ask, config, MODELS, AskError, sourcesIn, filedClients, fileToClients, unfileFromClient, clientsOfSources, clientsLookedUp };
