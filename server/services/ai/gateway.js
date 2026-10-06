// The one way Therapy talks to AI. Every feature (Ask now; email filing, drafts and snapshots
// later) calls turn() or complete() here, naming the feature and a tier or model. This module:
//   - picks the model (services/ai/models.js) and speaks that provider's format (Claude through
//     Bedrock's InvokeModel; Nova and the open models through Bedrock's Converse API);
//   - stops a call when the feature's, or all AI's, monthly spending limit has been reached;
//   - logs every call in ai_usage (tokens, cost, time taken, whether it worked).
// Everything runs on Amazon Bedrock in Australia, so client information stays in Australia.
const { AnthropicBedrock } = require('@anthropic-ai/bedrock-sdk');
const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');
const db = require('../../database');
const { MODELS, resolve, costOf } = require('./models');

const REGION = process.env.ASK_AWS_REGION || 'ap-southeast-2';
let claudeClient, converseClient;
const claude = () => (claudeClient = claudeClient || new AnthropicBedrock({ awsRegion: REGION }));
const bedrockRuntime = () => (converseClient = converseClient || new BedrockRuntimeClient({ region: REGION }));
const setting = (k, d) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value ?? d;

class AiLimitError extends Error {
  constructor(message) { super(message); this.status = 402; this.aiLimit = true; }
}

// ---- spending ----
// Months follow the practice's calendar (Melbourne); created_at is UTC, so the month starts at
// 1st 00:00 Melbourne = the day before, 13:00/14:00 UTC (the 11-hour shift matches AEDT).
function monthStart() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Melbourne' }));
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}
function spentThisMonth(feature = null) {
  const sql = `SELECT COALESCE(SUM(cost_usd), 0) AS c FROM ai_usage WHERE created_at >= datetime(?, '-11 hours')${feature ? ' AND feature = ?' : ''}`;
  return db.prepare(sql).get(...(feature ? [monthStart(), feature] : [monthStart()])).c;
}
// A feature's own limit is setting <feature>_monthly_limit_usd (e.g. ask_monthly_limit_usd);
// ai_monthly_limit_usd covers all features together. 0 or unset = no limit.
const limitOf = feature => Number(setting(`${feature}_monthly_limit_usd`, '0')) || 0;
function budget(feature) {
  const limit = limitOf(feature), spent = spentThisMonth(feature);
  const overallLimit = Number(setting('ai_monthly_limit_usd', '0')) || 0;
  const overallSpent = overallLimit > 0 ? spentThisMonth() : null;
  return {
    limit_usd: limit, spent_usd: Math.round(spent * 100) / 100,
    overall_limit_usd: overallLimit, overall_spent_usd: overallSpent == null ? null : Math.round(overallSpent * 100) / 100,
    blocked: (limit > 0 && spent >= limit) ? 'feature' : (overallLimit > 0 && overallSpent >= overallLimit) ? 'overall' : null,
  };
}
function checkBudget(feature, label = feature) {
  const b = budget(feature);
  if (b.blocked === 'feature') throw new AiLimitError(`This month's ${label} spending limit (US$${b.limit_usd}) has been reached. An owner can raise it in Settings.`);
  if (b.blocked === 'overall') throw new AiLimitError(`This month's overall AI spending limit (US$${b.overall_limit_usd}) has been reached. An owner can raise it in Settings.`);
}

const logUsage = db.prepare(`INSERT INTO ai_usage (feature, task, model, user_id, ref_type, ref_id, job_id, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_usd, duration_ms, ok, error)
  VALUES (@feature, @task, @model, @user_id, @ref_type, @ref_id, @job_id, @input, @output, @cacheWrite, @cacheRead, @cost, @ms, @ok, @error)`);

// ---- providers ----
// Each turns one model call into the same shape: { text, toolUses: [{ id, name, input }], stop,
// usage }, and adds the model's turn to `messages` in the shape that provider expects back.
// user()/results() build the person's message and the tool results in that provider's format.

// Claude: each round re-sends the whole conversation. A cache breakpoint on the newest message
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
const claudeProvider = {
  user: text => ({ role: 'user', content: text }),
  results: rs => ({ role: 'user', content: rs.map(r => ({ type: 'tool_result', tool_use_id: r.id, content: r.content, ...(r.error ? { is_error: true } : {}) })) }),
  async turn(modelId, model, { system, tools = [], messages, effort, onText, maxTokens, cache = true }) {
    const toolList = tools.map((t, i) => ({ ...t, ...(model.eager && onText ? { eager_input_streaming: true } : {}), ...(cache && i === tools.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}) }));
    const params = {
      model: modelId,
      max_tokens: maxTokens || 16000,
      ...(model.noEffort ? {} : { thinking: { type: 'adaptive' }, output_config: { effort: effort || 'low' } }),
      ...(system ? { system: [{ type: 'text', text: system, ...(cache ? { cache_control: { type: 'ephemeral' } } : {}) }] } : {}),
      ...(toolList.length ? { tools: toolList } : {}),
      messages: cache ? withCacheBreakpoint(messages) : messages,
    };
    const stream = claude().messages.stream(params);
    if (onText) stream.on('text', onText);
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
};

// Converse tool schemas: no "null" type unions, so an optional nullable field is just omitted.
const converseSchema = schema => {
  const props = Object.fromEntries(Object.entries(schema.properties || {}).map(([k, v]) => [k, Array.isArray(v.type) ? { ...v, type: v.type.find(t => t !== 'null') } : v]));
  const required = (schema.required || []).filter(k => !Array.isArray(schema.properties[k].type));
  return { type: 'object', properties: props, required };
};
const converseProvider = {
  user: text => ({ role: 'user', content: [{ text }] }),
  results: rs => ({ role: 'user', content: rs.map(r => ({ toolResult: { toolUseId: r.id, content: [{ text: r.content }], ...(r.error ? { status: 'error' } : {}) } })) }),
  async turn(modelId, model, { system, tools = [], messages, onText, maxTokens }) {
    const res = await bedrockRuntime().send(new ConverseCommand({
      modelId,
      ...(system ? { system: [{ text: system }] } : {}),
      messages,
      ...(tools.length ? { toolConfig: { tools: tools.map(t => ({ toolSpec: { name: t.name, description: t.description, inputSchema: { json: converseSchema(t.input_schema) } } })) } } : {}),
      inferenceConfig: { maxTokens: Math.min(maxTokens || model.maxTokens || 5000, model.maxTokens || 5000), temperature: 0.2 },
    }));
    const content = res.output?.message?.content || [];
    messages.push({ role: 'assistant', content });
    const u = res.usage || {};
    const text = content.filter(b => b.text).map(b => b.text).join('\n\n').replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
    if (onText && text) onText(text);
    return {
      text,
      toolUses: content.filter(b => b.toolUse).map(b => ({ id: b.toolUse.toolUseId, name: b.toolUse.name, input: b.toolUse.input })),
      stop: res.stopReason === 'content_filtered' || res.stopReason === 'guardrail_intervened' ? 'refusal' : res.stopReason === 'max_tokens' ? 'max_tokens' : 'ok',
      usage: { input: u.inputTokens || 0, output: u.outputTokens || 0, cacheWrite: u.cacheWriteInputTokens || 0, cacheRead: u.cacheReadInputTokens || 0 },
    };
  },
};
const PROVIDERS = { claude: claudeProvider, converse: converseProvider };

// The message builders for a model, for features that keep their own conversation (Ask).
const formatFor = modelOrTier => PROVIDERS[MODELS[resolve(modelOrTier)].provider];

// One model call.
//   feature (required), task: what it's for, for the usage log and limits
//   model: a model id or a tier ('fast' | 'standard' | 'strong'); default 'standard'
//   system, tools (Claude tool format), messages (in formatFor(model)'s format; the reply is
//   appended), effort (Claude), onText (streamed text), maxTokens, cache (prompt caching, Claude)
//   userId, ref: { type, id }, jobId: recorded with the usage
//   skipBudget: the caller has already checked the limit (e.g. once per Ask question)
// Returns { text, toolUses, stop, usage, cost_usd, model }.
async function turn({ feature, task = null, model = 'standard', system, tools, messages, effort, onText, maxTokens, cache, userId = null, ref = null, jobId = null, skipBudget = false }) {
  if (!feature) throw new Error('AI call without a feature name');
  if (!skipBudget) checkBudget(feature);
  const modelId = resolve(model);
  const m = MODELS[modelId];
  const started = Date.now();
  const row = { feature, task, model: modelId, user_id: userId, ref_type: ref?.type || null, ref_id: ref?.id || null, job_id: jobId, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, ms: 0, ok: 1, error: null };
  try {
    const out = await PROVIDERS[m.provider].turn(modelId, m, { system, tools, messages, effort, onText, maxTokens, cache });
    const cost = costOf(out.usage, modelId);
    logUsage.run({ ...row, ...out.usage, cost, ms: Date.now() - started });
    return { ...out, cost_usd: cost, model: modelId };
  } catch (e) {
    logUsage.run({ ...row, ms: Date.now() - started, ok: 0, error: String(e.message || e).slice(0, 500) });
    throw e;
  }
}

// A single question, no tools: returns the text, or with json: true the parsed JSON object the
// model was asked to give (the first {...} or [...] in its reply).
async function complete({ prompt, json = false, ...opts }) {
  const messages = [formatFor(opts.model || 'standard').user(prompt)];
  const out = await turn({ ...opts, messages, cache: opts.cache ?? false });
  if (!json) return { ...out, value: out.text };
  const match = out.text.match(/[[{][\s\S]*[\]}]/);
  let value = null;
  try { value = match ? JSON.parse(match[0]) : null; } catch { value = null; }
  return { ...out, value };
}

module.exports = { turn, complete, formatFor, budget, checkBudget, spentThisMonth, monthStart, AiLimitError };
