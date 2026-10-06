// The AI models Therapy can use. All keep data in Australia: Claude through Bedrock's AU inference
// profiles (Sydney and Melbourne), and Amazon Nova and the open models served by Bedrock in Sydney
// itself (Bedrock's Converse API). Prices are US$ per million tokens in those regions (Claude's
// include AWS's 10% regional premium). Re-check prices when they change.
//
// Features ask for a tier ('fast', 'standard', 'strong') rather than a named model, so a model can
// be swapped for every feature in one place (setting ai_tier_models, e.g. {"fast": "qwen..."}).
const db = require('../../database');

const MODELS = {
  'au.anthropic.claude-sonnet-5': { label: 'Claude Sonnet 5', provider: 'claude', in: 2.2, out: 11, cacheWrite: 2.75, cacheRead: 0.22, eager: true },
  'au.anthropic.claude-opus-5-5': { label: 'Claude Opus 5.5', provider: 'claude', in: 4.4, out: 22, cacheWrite: 5.5, cacheRead: 0.22, eager: true },
  'au.anthropic.claude-haiku-4-5-20251001-v1:0': { label: 'Claude Haiku 4.5', provider: 'claude', in: 1.1, out: 5.5, cacheWrite: 1.375, cacheRead: 0.11, eager: false, noEffort: true },
  'amazon.nova-pro-v1:0': { label: 'Amazon Nova Pro', provider: 'converse', in: 0.84, out: 3.36, cacheWrite: 0, cacheRead: 0.21, maxTokens: 5000 },
  'deepseek.v3.2': { label: 'DeepSeek V3.2', provider: 'converse', in: 0.64, out: 1.91, cacheWrite: 0, cacheRead: 0, maxTokens: 8000 },
  'qwen.qwen3-235b-a22b-2507-v1:0': { label: 'Qwen 3 235B', provider: 'converse', in: 0.2266, out: 0.9064, cacheWrite: 0, cacheRead: 0, maxTokens: 8000 },
  'moonshotai.kimi-k2.5': { label: 'Kimi K2.5', provider: 'converse', in: 0.62, out: 3.09, cacheWrite: 0, cacheRead: 0, maxTokens: 8000 },
  'zai.glm-5': { label: 'GLM 5', provider: 'converse', in: 1.03, out: 3.3, cacheWrite: 0, cacheRead: 0, maxTokens: 8000 },
};

// fast: sorting, filing, extracting facts. standard: answering, drafting. strong: hardest cases.
const TIER_DEFAULTS = {
  fast: 'au.anthropic.claude-haiku-4-5-20251001-v1:0',
  standard: 'au.anthropic.claude-sonnet-5',
  strong: 'au.anthropic.claude-opus-5-5',
};
const TIERS = Object.keys(TIER_DEFAULTS);

function tierModels() {
  let chosen = {};
  try { chosen = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'ai_tier_models'").get()?.value || '{}'); } catch {}
  return Object.fromEntries(TIERS.map(t => [t, MODELS[chosen[t]] ? chosen[t] : TIER_DEFAULTS[t]]));
}

// A model id, or a tier name, to the model id to use.
function resolve(modelOrTier) {
  if (MODELS[modelOrTier]) return modelOrTier;
  return tierModels()[TIERS.includes(modelOrTier) ? modelOrTier : 'standard'];
}

// usage: { input, output, cacheWrite, cacheRead } token counts.
const costOf = (u, modelId) => {
  const m = MODELS[modelId];
  return m ? (u.input * m.in + u.output * m.out + u.cacheWrite * m.cacheWrite + u.cacheRead * m.cacheRead) / 1e6 : 0;
};

module.exports = { MODELS, TIERS, TIER_DEFAULTS, tierModels, resolve, costOf };
