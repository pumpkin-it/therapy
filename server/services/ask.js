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
const tools = require('./askTools');

// Models that keep data in Australia: Claude through Bedrock's AU inference profiles (Sydney and
// Melbourne), and Amazon Nova Pro in Sydney itself (Bedrock's Converse API). Prices are US$ per
// million tokens in those regions (Claude's include AWS's 10% regional premium).
const MODELS = {
  'au.anthropic.claude-sonnet-5': { label: 'Claude Sonnet 5', provider: 'claude', in: 2.2, out: 11, cacheWrite: 2.75, cacheRead: 0.22, eager: true },
  'au.anthropic.claude-opus-5-5': { label: 'Claude Opus 5.5', provider: 'claude', in: 4.4, out: 22, cacheWrite: 5.5, cacheRead: 0.22, eager: true },
  'au.anthropic.claude-haiku-4-5-20251001-v1:0': { label: 'Claude Haiku 4.5', provider: 'claude', in: 1.1, out: 5.5, cacheWrite: 1.375, cacheRead: 0.11, eager: false },
  'amazon.nova-pro-v1:0': { label: 'Amazon Nova Pro', provider: 'nova', in: 0.84, out: 3.36, cacheWrite: 0, cacheRead: 0.21 },
};
const DEFAULT_MODEL = 'au.anthropic.claude-sonnet-5';
const MAX_ROUNDS = 15;
const TOOL_RESULT_CHARS = 40000;

const REGION = process.env.ASK_AWS_REGION || 'ap-southeast-2';
let claudeClient, novaClient;
const claude = () => (claudeClient = claudeClient || new AnthropicBedrock({ awsRegion: REGION }));
const nova = () => (novaClient = novaClient || new BedrockRuntimeClient({ region: REGION }));
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
- Use client_history to see what is on file, then search_records with a few different wordings, and read_record to read the documents that look relevant in full. Answers usually sit inside reports, quotes, letters and emails rather than in titles, so read the documents before answering.
- Old-system backups (zip files) contain earlier notes and reports; read their documents with read_record kind "zip_entry".
- Keep searching until you have the answer or have checked the likely places. Don't stop at the first partial match.

How to answer:
- Start with the direct answer in one or two sentences, then any detail that matters. Keep it short and plain; use a short list only when listing several items.
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
    description: "A client's details and everything on file for them, newest first: appointments, session notes, files (with the documents inside backup zips), emails, forms, reports and tasks, each with its kind and id for read_record.",
    input_schema: { type: 'object', properties: { client_id: { type: 'integer' } }, required: ['client_id'], additionalProperties: false },
  },
  {
    name: 'search_records',
    description: "Search the text of session notes, appointments, files (including PDF contents and documents inside backup zips), forms, reports, emails and email attachments. Returns up to 20 matches with a snippet of the matching text. Give client_id to search one client's records (plus unfiled emails that name them); give null to search everything.",
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Words to look for, e.g. "equipment trial" or "step height back door"' }, client_id: { type: ['integer', 'null'] } },
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
  if (name === 'client_history') return Number.isInteger(i.client_id) ? null : 'client_id must be a whole number';
  if (name === 'search_records') return typeof i.query === 'string' && i.query.trim() && (i.client_id === null || i.client_id === undefined || Number.isInteger(i.client_id)) ? null : 'query is required and client_id must be a number or null';
  if (name === 'read_record') return KINDS.includes(i.kind) && /^\d+(:\d+)?$/.test(String(i.id)) ? null : 'kind must be one of the listed kinds and id a number (or file:number for zip_entry)';
  return `unknown tool ${name}`;
}

async function runTool(name, input, opts) {
  if (name === 'find_clients') return tools.findClients(input.query);
  if (name === 'client_history') return tools.clientTimeline(input.client_id, opts);
  if (name === 'search_records') return tools.searchRecords(input.query, input.client_id ?? null, opts);
  if (name === 'read_record') return (await tools.readRecord(input.kind, input.id, opts)) || { error: `No ${input.kind} with id ${input.id}` };
  return { error: `Unknown tool ${name}` };
}

function describeTool(name, input) {
  if (name === 'find_clients') return `Looking up "${input.query}"`;
  if (name === 'client_history') return 'Reading the client\'s history';
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
  async turn(modelId, model, messages, onText) {
    const tools = TOOLS.map((t, i) => ({ ...t, ...(model.eager ? { eager_input_streaming: true } : {}), ...(i === TOOLS.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}) }));
    const stream = claude().messages.stream({
      model: modelId,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
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

// Nova's tool schemas: no "null" type unions, so an omitted client_id means "everyone".
const novaSchema = schema => {
  const props = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, Array.isArray(v.type) ? { ...v, type: v.type.find(t => t !== 'null') } : v]));
  const required = schema.required.filter(k => !Array.isArray(schema.properties[k].type));
  return { type: 'object', properties: props, required };
};
const novaTurns = {
  user: text => ({ role: 'user', content: [{ text }] }),
  async turn(modelId, model, messages) {
    const res = await nova().send(new ConverseCommand({
      modelId,
      system: [{ text: SYSTEM }],
      messages,
      toolConfig: { tools: TOOLS.map(t => ({ toolSpec: { name: t.name, description: t.description, inputSchema: { json: novaSchema(t.input_schema) } } })) },
      inferenceConfig: { maxTokens: 5000, temperature: 0.2 },
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
const PROVIDERS = { claude: claudeTurns, nova: novaTurns };

class AskError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

// Answer one question (optionally continuing a conversation), reporting progress through
// onEvent: { type: 'status', text } while searching, { type: 'text', text } as the answer is
// written, { type: 'restart' } when the model goes back to searching after writing some text.
// `modelId` overrides the Settings choice (used to compare models side by side); a follow-up
// always continues with the model the conversation started on.
async function ask({ user, question, conversationId, clientId, canEmail, modelId }, onEvent = () => {}) {
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
    const turn = await provider.turn(useModel, model, messages, delta => { wrote = true; onEvent({ type: 'text', text: delta }); });
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
    return id;
  });
  const id = save();
  return { conversation_id: id, answer, sources, model: model.label, cost_usd: Math.round(cost * 10000) / 10000 };
}

module.exports = { ask, config, MODELS, AskError, sourcesIn };
