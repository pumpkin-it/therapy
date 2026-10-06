// AI overview for Settings: what each AI feature has cost this month, which model each tier uses,
// the background queue, and how many documents have been read.
const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');
const ai = require('../services/ai/gateway');
const { MODELS, TIERS, TIER_DEFAULTS, tierModels } = require('../services/ai/models');
const jobs = require('../services/ai/jobs');
const docs = require('../services/documentText');

const FEATURE_LABELS = { ask: 'Ask' };
const round = n => Math.round(n * 100) / 100;

router.get('/overview', auth, (req, res) => {
  const since = ai.monthStart();
  const byFeature = db.prepare(`SELECT feature, COUNT(*) AS calls, SUM(ok = 0) AS failed, COALESCE(SUM(cost_usd), 0) AS cost
    FROM ai_usage WHERE created_at >= datetime(?, '-11 hours') GROUP BY feature ORDER BY cost DESC`).all(since);
  const byModel = db.prepare(`SELECT model, COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS cost
    FROM ai_usage WHERE created_at >= datetime(?, '-11 hours') GROUP BY model ORDER BY cost DESC`).all(since);
  // Last six months, by the month the practice was in (Melbourne).
  const months = db.prepare(`SELECT strftime('%Y-%m', created_at, '+11 hours') AS month, COALESCE(SUM(cost_usd), 0) AS cost, COUNT(*) AS calls
    FROM ai_usage WHERE created_at >= datetime('now', '-6 months') GROUP BY month ORDER BY month`).all();
  const tiers = tierModels();
  res.json({
    month_start: since,
    features: byFeature.map(f => ({ feature: f.feature, label: FEATURE_LABELS[f.feature] || f.feature, calls: f.calls, failed: f.failed || 0, cost_usd: round(f.cost), ...ai.budget(f.feature) })),
    models_used: byModel.map(m => ({ model: m.model, label: MODELS[m.model]?.label || m.model, calls: m.calls, cost_usd: round(m.cost) })),
    months: months.map(m => ({ ...m, cost: round(m.cost) })),
    overall: { spent_usd: round(ai.spentThisMonth()), limit_usd: Number(db.prepare("SELECT value FROM settings WHERE key = 'ai_monthly_limit_usd'").get()?.value || 0) },
    tiers: TIERS.map(t => ({ tier: t, model: tiers[t], default: TIER_DEFAULTS[t] })),
    models: Object.entries(MODELS).map(([id, m]) => ({ id, label: m.label })),
    jobs: jobs.stats(),
    documents: { ...docs.stats(), waiting: db.prepare("SELECT COUNT(*) AS n FROM ai_jobs WHERE kind = 'read_document' AND status IN ('queued', 'running')").get().n },
  });
});

module.exports = router;
