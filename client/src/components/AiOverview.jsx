import { useState, useEffect } from 'react';
import api from '../lib/api';

// Settings → AI: what each AI feature has cost, which model each tier uses, the background queue
// and the document text store (server/routes/ai.js). Tier choices and the overall limit are saved
// with the rest of Settings (settings ai_tier_models, ai_monthly_limit_usd).
const TIER_LABELS = {
  fast: ['Quick jobs', 'sorting and filing email, picking out facts'],
  standard: ['Everyday', 'answering questions, drafting replies'],
  strong: ['Hardest cases', 'when the everyday model is unsure'],
};
const usd = n => `US$${Number(n || 0).toFixed(2)}`;
const monthName = m => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-AU', { month: 'short', year: 'numeric' });

// refreshKey changes after Settings are saved, so the limits shown here follow what was saved.
export default function AiOverview({ form, set, refreshKey = 0 }) {
  const [data, setData] = useState(null);
  useEffect(() => { api.get('/ai/overview').then(r => setData(r.data)).catch(() => {}); }, [refreshKey]);
  if (!data) return null;

  let chosen = {};
  try { chosen = JSON.parse(form.ai_tier_models || '{}'); } catch {}
  const setTier = (tier, model) => set('ai_tier_models', JSON.stringify({ ...chosen, [tier]: model }));
  const docs = data.documents;
  const jobKinds = Object.entries(data.jobs.kinds);

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-5">
      <div>
        <h2 className="font-semibold text-gray-900">AI overview</h2>
        <p className="text-sm text-gray-500 mt-1">Every AI feature goes through one place, so its cost is tracked here and its model can be changed here. Everything runs on Amazon Bedrock in Australia.</p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-700">This month</p>
        {data.features.length ? (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-500"><th className="font-medium pb-1">Feature</th><th className="font-medium pb-1 text-right">AI calls</th><th className="font-medium pb-1 text-right">Cost</th><th className="font-medium pb-1 text-right">Limit</th></tr></thead>
            <tbody>
              {data.features.map(f => (
                <tr key={f.feature} className="border-t border-gray-100">
                  <td className="py-1.5">{f.label}{f.failed ? <span className="text-xs text-amber-600"> · {f.failed} failed</span> : null}</td>
                  <td className="py-1.5 text-right">{f.calls}</td>
                  <td className="py-1.5 text-right">{usd(f.cost_usd)}</td>
                  <td className="py-1.5 text-right text-gray-500">{f.limit_usd > 0 ? usd(f.limit_usd) : '—'}</td>
                </tr>
              ))}
              <tr className="border-t border-gray-200 font-medium"><td className="py-1.5">Total</td><td /><td className="py-1.5 text-right">{usd(data.overall.spent_usd)}</td><td className="py-1.5 text-right text-gray-500">{data.overall.limit_usd > 0 ? usd(data.overall.limit_usd) : '—'}</td></tr>
            </tbody>
          </table>
        ) : <p className="text-sm text-gray-500">No AI used yet this month.</p>}
        {data.models_used.length > 0 && <p className="text-xs text-gray-500">By model: {data.models_used.map(m => `${m.label} ${usd(m.cost_usd)}`).join(' · ')}</p>}
        {data.months.length > 1 && <p className="text-xs text-gray-500">Past months: {data.months.map(m => `${monthName(m.month)} ${usd(m.cost)}`).join(' · ')}</p>}
      </div>

      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700">Overall monthly limit for all AI (US$, 0 = no overall limit)</label>
        <input type="number" min="0" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          value={form.ai_monthly_limit_usd ?? '0'} onChange={e => set('ai_monthly_limit_usd', e.target.value)} />
        <p className="text-xs text-gray-400">Each feature also has its own limit (Ask's is above). When a limit is reached, that AI stops until next month.</p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-700">Models for the front desk features</p>
        <p className="text-xs text-gray-400">Features ask for a kind of job, not a named model, so a newer or cheaper model can be switched in here. Ask uses its own model setting above.</p>
        {data.tiers.map(t => (
          <div key={t.tier} className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-1 sm:gap-3 items-center">
            <div className="text-sm text-gray-700">{TIER_LABELS[t.tier][0]}<div className="text-xs text-gray-400">{TIER_LABELS[t.tier][1]}</div></div>
            <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              value={chosen[t.tier] || t.default} onChange={e => setTier(t.tier, e.target.value)}>
              {data.models.map(m => <option key={m.id} value={m.id}>{m.label}{m.id === t.default ? ' (default)' : ''}</option>)}
            </select>
          </div>
        ))}
      </div>

      <div className="space-y-1">
        <p className="text-sm font-medium text-gray-700">Documents read</p>
        <p className="text-sm text-gray-600">
          {docs.read.toLocaleString()} documents read{docs.unreadable ? `, ${docs.unreadable.toLocaleString()} with no readable text (pictures, Word files)` : ''}{docs.failed ? `, ${docs.failed} couldn't be opened` : ''}.
          {docs.waiting ? ` ${docs.waiting.toLocaleString()} waiting to be read.` : ' All caught up.'}
        </p>
        <p className="text-xs text-gray-400">Each document is read once when it arrives and kept, so AI features don't pay to read it again.</p>
      </div>

      {jobKinds.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium text-gray-700">Background work</p>
          <p className="text-xs text-gray-500">{jobKinds.map(([k, s]) => `${k.replace(/_/g, ' ')}: ${s.queued + s.running} waiting, ${s.done} done${s.failed ? `, ${s.failed} failed` : ''}`).join(' · ')}</p>
          {data.jobs.recent_failures.length > 0 && <p className="text-xs text-amber-600">Last failure: {data.jobs.recent_failures[0].kind.replace(/_/g, ' ')} — {data.jobs.recent_failures[0].last_error}</p>}
        </div>
      )}
    </section>
  );
}
