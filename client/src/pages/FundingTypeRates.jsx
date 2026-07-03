import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Trash2, Plus } from 'lucide-react';
import api from '../lib/api';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';

const OPEN_END_DATE = '9999-09-09';
const RATE_FIELDS = ['code', 'rate', 'travel_code', 'travel_rate_per_hour', 'km_code', 'km_rate', 'notes_code', 'notes_rate', 'cancel_code', 'gst_type'];

function DateInput({ label, value, onChange, disabled }) {
  const ref = useRef();
  const externalVal = useRef(value);
  useEffect(() => {
    if (externalVal.current !== value && ref.current) {
      ref.current.value = value || '';
      externalVal.current = value;
    }
  }, [value]);
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <input ref={ref} type="date" disabled={disabled}
        defaultValue={value || ''}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-400"
        onChange={e => { externalVal.current = e.target.value; onChange(e.target.value); }}
      />
    </div>
  );
}

export default function FundingTypeRates() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [fundingType, setFundingType] = useState(null);
  const [periods, setPeriods] = useState([]);
  const [activePeriodId, setActivePeriodId] = useState(null);
  const [rates, setRates] = useState([]);
  const [services, setServices] = useState([]);
  const [saving, setSaving] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newPeriod, setNewPeriod] = useState({ name: '', start_date: '' });
  const [showAddService, setShowAddService] = useState(false);
  const [newRate, setNewRate] = useState({ service_id: '', code: '', rate: 0, gst_type: 'GST' });
  const [resyncMsg, setResyncMsg] = useState('');

  useEffect(() => {
    api.get('/funding-types').then(r => setFundingType(r.data.find(ft => String(ft.id) === id)));
    api.get('/services').then(r => setServices(r.data));
  }, [id]);

  const loadPeriods = () => api.get(`/funding-types/${id}/rate-periods`).then(r => {
    setPeriods(r.data);
    if (!activePeriodId && r.data.length) setActivePeriodId(r.data[0].id);
  });
  useEffect(() => { loadPeriods(); }, [id]);

  const loadRates = () => {
    if (!activePeriodId) return;
    api.get(`/funding-types/${id}/rate-periods/${activePeriodId}/rates`).then(r => setRates(r.data.map(row => ({ ...row, _dirty: false }))));
  };
  useEffect(() => { loadRates(); }, [activePeriodId]);

  const activePeriod = periods.find(p => p.id === activePeriodId);
  const isOpenPeriod = activePeriod?.end_date === OPEN_END_DATE;
  const hasDirty = rates.some(r => r._dirty);
  const availableServices = services.filter(s => !rates.some(r => r.service_id === s.id));

  const showResyncMsg = count => {
    setResyncMsg(count ? `Updated ${count} future appointment${count === 1 ? '' : 's'} to the new rate` : '');
    if (count) setTimeout(() => setResyncMsg(''), 5000);
  };

  const setRateField = (rateId, k, v) => setRates(rs => rs.map(r => r.id === rateId ? { ...r, [k]: v, _dirty: true } : r));

  const saveRates = async () => {
    setSaving(true);
    try {
      const dirtyRows = rates.filter(r => r._dirty);
      let totalUpdated = 0;
      for (const row of dirtyRows) {
        const body = {};
        for (const f of RATE_FIELDS) body[f] = row[f];
        const res = await api.patch(`/funding-types/${id}/rate-periods/${activePeriodId}/rates/${row.id}`, body);
        totalUpdated += res.data.appointments_updated || 0;
      }
      await loadRates();
      showResyncMsg(totalUpdated);
    } finally { setSaving(false); }
  };

  const createPeriod = async () => {
    if (!newPeriod.name || !newPeriod.start_date) return;
    const res = await api.post(`/funding-types/${id}/rate-periods`, newPeriod);
    setShowNew(false);
    setNewPeriod({ name: '', start_date: '' });
    await loadPeriods();
    setActivePeriodId(res.data.id);
    showResyncMsg(res.data.appointments_updated);
  };

  const deletePeriod = async () => {
    if (!confirm(`Delete rate period "${activePeriod.name}"? This reopens the previous period.`)) return;
    await api.delete(`/funding-types/${id}/rate-periods/${activePeriodId}`);
    setActivePeriodId(null);
    await loadPeriods();
  };

  const addServiceRate = async () => {
    if (!newRate.service_id) return;
    await api.post(`/funding-types/${id}/rate-periods/${activePeriodId}/rates`, newRate);
    setShowAddService(false);
    setNewRate({ service_id: '', code: '', rate: 0, gst_type: 'GST' });
    await loadRates();
  };

  const removeServiceRate = async (rateId, serviceName) => {
    if (!confirm(`Remove "${serviceName}" from this rate period?`)) return;
    await api.delete(`/funding-types/${id}/rate-periods/${activePeriodId}/rates/${rateId}`);
    await loadRates();
  };

  if (!fundingType) return <div className="p-6 text-gray-400">Loading…</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/settings')} className="text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-2xl font-semibold flex-1">{fundingType.name} Rates</h1>
      </div>

      <div className="flex flex-wrap gap-2">
        {periods.map(p => (
          <button key={p.id} onClick={() => setActivePeriodId(p.id)}
            className={`px-3 py-1.5 rounded-lg text-sm border ${p.id === activePeriodId ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
            {p.name} <span className="opacity-70">({p.start_date} – {p.end_date === OPEN_END_DATE ? 'current' : p.end_date})</span>
          </button>
        ))}
        <button onClick={() => setShowNew(s => !s)} className="px-3 py-1.5 rounded-lg text-sm border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50">
          + New Period
        </button>
      </div>

      {showNew && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
          <p className="text-xs text-gray-500">Creating a new period automatically copies every service's current rate forward — you then adjust individual rates below.</p>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Period name" value={newPeriod.name} onChange={e => setNewPeriod(p => ({ ...p, name: e.target.value }))} placeholder="e.g. 2027 Rates" />
            <DateInput label="Start date" value={newPeriod.start_date} onChange={v => setNewPeriod(p => ({ ...p, start_date: v }))} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowNew(false)}>Cancel</Button>
            <Button onClick={createPeriod}>Create Period</Button>
          </div>
        </div>
      )}

      {activePeriod && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          {!isOpenPeriod && (
            <p className="text-xs text-amber-700 bg-amber-50 border-b border-amber-200 px-4 py-2">
              This is a past rate period. Rate values can still be corrected, but its dates are locked.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {['Service','Code','Rate ($)','Travel code','Travel ($/hr)','KM code','KM ($/km)','Notes code','Notes ($/hr)','Cancel code','GST',''].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rates.map(r => (
                  <tr key={r.id} className={r._dirty ? 'bg-yellow-50' : ''}>
                    <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">{r.service_name}</td>
                    <td className="px-3 py-1"><input className="w-24 rounded border border-gray-300 px-2 py-1 text-sm" value={r.code || ''} onChange={e => setRateField(r.id, 'code', e.target.value)} /></td>
                    <td className="px-3 py-1"><input type="number" step="0.01" className="w-20 rounded border border-gray-300 px-2 py-1 text-sm" value={r.rate} onChange={e => setRateField(r.id, 'rate', parseFloat(e.target.value))} /></td>
                    <td className="px-3 py-1"><input className="w-20 rounded border border-gray-300 px-2 py-1 text-sm" value={r.travel_code || ''} onChange={e => setRateField(r.id, 'travel_code', e.target.value)} /></td>
                    <td className="px-3 py-1"><input type="number" step="0.01" className="w-20 rounded border border-gray-300 px-2 py-1 text-sm" value={r.travel_rate_per_hour || ''} onChange={e => setRateField(r.id, 'travel_rate_per_hour', e.target.value)} /></td>
                    <td className="px-3 py-1"><input className="w-20 rounded border border-gray-300 px-2 py-1 text-sm" value={r.km_code || ''} onChange={e => setRateField(r.id, 'km_code', e.target.value)} /></td>
                    <td className="px-3 py-1"><input type="number" step="0.01" className="w-20 rounded border border-gray-300 px-2 py-1 text-sm" value={r.km_rate || ''} onChange={e => setRateField(r.id, 'km_rate', e.target.value)} /></td>
                    <td className="px-3 py-1"><input className="w-20 rounded border border-gray-300 px-2 py-1 text-sm" value={r.notes_code || ''} onChange={e => setRateField(r.id, 'notes_code', e.target.value)} /></td>
                    <td className="px-3 py-1"><input type="number" step="0.01" className="w-20 rounded border border-gray-300 px-2 py-1 text-sm" value={r.notes_rate || ''} onChange={e => setRateField(r.id, 'notes_rate', e.target.value)} /></td>
                    <td className="px-3 py-1"><input className="w-20 rounded border border-gray-300 px-2 py-1 text-sm" value={r.cancel_code || ''} onChange={e => setRateField(r.id, 'cancel_code', e.target.value)} /></td>
                    <td className="px-3 py-1">
                      <select className="rounded border border-gray-300 px-1.5 py-1 text-sm" value={r.gst_type || 'GST'} onChange={e => setRateField(r.id, 'gst_type', e.target.value)}>
                        <option value="GST">GST</option>
                        <option value="FRE">FRE</option>
                        <option value="N-T">N-T</option>
                      </select>
                    </td>
                    <td className="px-3 py-1 text-right">
                      <button onClick={() => removeServiceRate(r.id, r.service_name)} className="text-red-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                    </td>
                  </tr>
                ))}
                {!rates.length && (
                  <tr><td colSpan={11} className="px-3 py-6 text-center text-gray-400">No services priced under this funding type yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="p-4 border-t border-gray-100">
            {showAddService ? (
              <div className="flex items-end gap-2 flex-wrap">
                <div className="space-y-1">
                  <label className="block text-xs text-gray-500">Service</label>
                  <select className="rounded-lg border border-gray-300 px-3 py-2 text-sm min-w-[200px]"
                    value={newRate.service_id} onChange={e => setNewRate(r => ({ ...r, service_id: e.target.value }))}>
                    <option value="">— Select a service —</option>
                    {availableServices.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <Input label="Code" value={newRate.code} onChange={e => setNewRate(r => ({ ...r, code: e.target.value }))} />
                <Input label="Rate ($)" type="number" step="0.01" value={newRate.rate} onChange={e => setNewRate(r => ({ ...r, rate: parseFloat(e.target.value) }))} />
                <Button onClick={addServiceRate} disabled={!newRate.service_id}>Add</Button>
                <Button variant="secondary" onClick={() => setShowAddService(false)}>Cancel</Button>
              </div>
            ) : (
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <Button variant="secondary" size="sm" onClick={() => setShowAddService(true)} disabled={!availableServices.length}>
                    <Plus className="h-3.5 w-3.5" /> Add service
                  </Button>
                  {isOpenPeriod && periods.length > 1 && (
                    <Button variant="ghost" size="sm" onClick={deletePeriod}><Trash2 className="h-3.5 w-3.5 text-red-400" /> Delete Period</Button>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {resyncMsg && <span className="text-sm text-green-600">{resyncMsg}</span>}
                  {hasDirty && <Button onClick={saveRates} disabled={saving}>{saving ? 'Saving…' : 'Save Rates'}</Button>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
