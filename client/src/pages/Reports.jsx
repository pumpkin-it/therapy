import { useState, useEffect } from 'react';
import { Download } from 'lucide-react';
import api from '../lib/api';
import Button from '../components/ui/Button';
import SearchSelect from '../components/ui/SearchSelect';
import { currency, localToday, downloadFile } from '../lib/utils';
import { useAuth } from '../context/AuthContext';

const daysAgo = n => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const fmtMin = min => {
  if (!min) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
};

const pctColor = pct => pct >= 100 ? 'text-green-600' : pct >= 80 ? 'text-amber-600' : 'text-red-600';
const barColor = pct => pct >= 100 ? 'bg-green-500' : pct >= 80 ? 'bg-amber-500' : 'bg-red-500';

function TargetCell({ pct }) {
  if (pct == null) return <span className="text-gray-300">—</span>;
  return (
    <div className="flex items-center gap-2 justify-end">
      <div className="w-16 h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full ${barColor(pct)}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className={`text-xs font-semibold tabular-nums ${pctColor(pct)}`}>{pct.toFixed(0)}%</span>
    </div>
  );
}

export default function Reports() {
  const { user } = useAuth();
  const isPractitioner = user?.role === 'practitioner';
  const canViewClients = !!user?.permissions?.clients;

  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(localToday());
  const [practitionerId, setPractitionerId] = useState(isPractitioner ? String(user.id) : '');
  const [clientId, setClientId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [groupBy, setGroupBy] = useState('practitioner');

  const [practitioners, setPractitioners] = useState([]);
  const [clients, setClients] = useState([]);
  const [services, setServices] = useState([]);

  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isPractitioner) api.get('/practitioners?role=practitioner').then(r => setPractitioners(r.data)).catch(() => {});
    if (canViewClients) api.get('/clients?active=all').then(r => setClients(r.data)).catch(() => {});
    api.get('/services').then(r => setServices(r.data)).catch(() => {});
  }, []);

  const load = () => {
    if (!from || !to) return;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ from, to, group_by: groupBy });
    if (practitionerId) params.set('practitioner_id', practitionerId);
    if (clientId) params.set('client_id', clientId);
    if (serviceId) params.set('service_id', serviceId);
    api.get(`/reports/billing?${params}`)
      .then(r => setRows(r.data.rows))
      .catch(e => setError(e.response?.data?.error || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [from, to, practitionerId, clientId, serviceId, groupBy]);

  const exportCsv = () => {
    const params = new URLSearchParams({ from, to, group_by: groupBy });
    if (practitionerId) params.set('practitioner_id', practitionerId);
    if (clientId) params.set('client_id', clientId);
    if (serviceId) params.set('service_id', serviceId);
    downloadFile(api, `/reports/billing/csv?${params}`, `billing-report_${from}_${to}.csv`);
  };

  const showTargetCols = groupBy === 'practitioner';

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Reports</h1>
          <p className="text-sm text-gray-500 mt-0.5">Billable hours, travel, km, notes and dollars — booked vs. invoiced.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!rows?.length}>
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-500">From</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-500">To</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-500">Practitioner</label>
            {isPractitioner ? (
              <div className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500">
                {user.first_name} {user.last_name}
              </div>
            ) : (
              <SearchSelect
                options={practitioners.map(p => ({ value: String(p.id), label: `${p.first_name} ${p.last_name}` }))}
                value={practitionerId} onChange={setPractitionerId} placeholder="All practitioners" />
            )}
          </div>
          {canViewClients && (
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-500">Client</label>
              <SearchSelect
                options={clients.filter(c => !c.is_test_data).map(c => ({ value: String(c.id), label: `${c.first_name} ${c.last_name}` }))}
                value={clientId} onChange={setClientId} placeholder="All clients" />
            </div>
          )}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-500">Service</label>
            <SearchSelect
              options={services.map(s => ({ value: String(s.id), label: s.name }))}
              value={serviceId} onChange={setServiceId} placeholder="All services" />
          </div>
        </div>

        <div className="flex items-center gap-1.5 pt-1">
          <span className="text-xs font-medium text-gray-500 mr-1">Group by</span>
          {[['practitioner', 'Practitioner'], ['service', 'Service Type'], ['client', 'Client']].map(([key, label]) => (
            <button key={key} onClick={() => setGroupBy(key)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                groupBy === key ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-2.5 font-medium">{groupBy === 'practitioner' ? 'Practitioner' : groupBy === 'client' ? 'Client' : 'Service'}</th>
                <th className="text-right px-3 py-2.5 font-medium">Hours</th>
                <th className="text-right px-3 py-2.5 font-medium">Travel</th>
                <th className="text-right px-3 py-2.5 font-medium">Km</th>
                <th className="text-right px-3 py-2.5 font-medium">Notes</th>
                <th className="text-right px-3 py-2.5 font-medium">$ Booked</th>
                <th className="text-right px-3 py-2.5 font-medium">$ Invoiced</th>
                {showTargetCols && <th className="text-right px-3 py-2.5 font-medium">Target</th>}
                {showTargetCols && <th className="text-right px-4 py-2.5 font-medium">% of target</th>}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={showTargetCols ? 9 : 7} className="px-4 py-8 text-center text-sm text-gray-400">Loading…</td></tr>
              )}
              {!loading && rows?.length === 0 && (
                <tr><td colSpan={showTargetCols ? 9 : 7} className="px-4 py-8 text-center text-sm text-gray-400">No activity in this date range.</td></tr>
              )}
              {!loading && rows?.map(r => (
                <tr key={r.key} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                  <td className="px-4 py-2.5 font-medium text-gray-800">{r.label}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.hours.toFixed(1)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{fmtMin(r.travelMin)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{r.km ? r.km.toFixed(1) : '—'}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{fmtMin(r.notesMin)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-medium">{currency(r.booked)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{currency(r.invoiced)}</td>
                  {showTargetCols && (
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">
                      {r.targetAmount ? `${currency(r.targetAmount)}/${r.targetPeriod?.replace('ly', '')}` : <span className="text-gray-300">—</span>}
                    </td>
                  )}
                  {showTargetCols && (
                    <td className="px-4 py-2.5"><TargetCell pct={r.pctBooked} /></td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-gray-400">
        $ Booked is projected from scheduled appointments in range; $ Invoiced is based on each session's date, not when the invoice was issued — so a late invoice for an August session still counts toward August.
        {showTargetCols && ' % of target compares $ Booked against each practitioner’s target, prorated to the selected date range.'}
      </p>
    </div>
  );
}
