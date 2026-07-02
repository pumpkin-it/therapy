import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Trash2 } from 'lucide-react';
import api from '../lib/api';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import DisciplinePicker from '../components/DisciplinePicker';
import { currency } from '../lib/utils';

const OPEN_END_DATE = '9999-09-09';
const EMPTY_DETAILS = { name: '', description: '', unit: 'hour', default_duration: 60, discipline_id: '' };
const EMPTY_RATE = { name: '', code: '', rate: 0, travel_code: '', travel_rate_per_hour: '', km_code: '', km_rate: '', notes_code: '', notes_rate: '', cancel_code: '', gst_type: 'GST' };

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

function RatePeriods({ serviceId }) {
  const [periods, setPeriods] = useState([]);
  const [activePeriodId, setActivePeriodId] = useState(null);
  const [form, setForm] = useState(EMPTY_RATE);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newPeriod, setNewPeriod] = useState({ name: '', start_date: '', copy_from_period_id: '' });

  const loadPeriods = () => api.get(`/services/${serviceId}/rate-periods`).then(r => {
    setPeriods(r.data);
    if (!activePeriodId && r.data.length) setActivePeriodId(r.data[0].id);
  });

  useEffect(() => { if (serviceId) loadPeriods(); }, [serviceId]);

  useEffect(() => {
    const p = periods.find(p => p.id === activePeriodId);
    if (p) { setForm({ ...p }); setDirty(false); }
  }, [activePeriodId, periods]);

  const activePeriod = periods.find(p => p.id === activePeriodId);
  const isOpenPeriod = activePeriod?.end_date === OPEN_END_DATE;

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setDirty(true); };

  const saveRates = async () => {
    setSaving(true);
    try {
      await api.patch(`/services/${serviceId}/rate-periods/${activePeriodId}`, form);
      await loadPeriods();
      setDirty(false);
    } finally { setSaving(false); }
  };

  const createPeriod = async () => {
    if (!newPeriod.name || !newPeriod.start_date) return;
    const res = await api.post(`/services/${serviceId}/rate-periods`, newPeriod);
    setShowNew(false);
    setNewPeriod({ name: '', start_date: '', copy_from_period_id: '' });
    await loadPeriods();
    setActivePeriodId(res.data.id);
  };

  const deletePeriod = async () => {
    if (!confirm(`Delete rate period "${activePeriod.name}"? This reopens the previous period.`)) return;
    await api.delete(`/services/${serviceId}/rate-periods/${activePeriodId}`);
    setActivePeriodId(null);
    await loadPeriods();
  };

  if (!serviceId) return null;

  return (
    <div className="space-y-4">
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
          <div className="grid grid-cols-3 gap-3">
            <Input label="Period name" value={newPeriod.name} onChange={e => setNewPeriod(p => ({ ...p, name: e.target.value }))} placeholder="e.g. 2027 Rates" />
            <DateInput label="Start date" value={newPeriod.start_date} onChange={v => setNewPeriod(p => ({ ...p, start_date: v }))} />
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Copy rates from</label>
              <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                value={newPeriod.copy_from_period_id} onChange={e => setNewPeriod(p => ({ ...p, copy_from_period_id: e.target.value }))}>
                <option value="">— Start blank —</option>
                {periods.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowNew(false)}>Cancel</Button>
            <Button onClick={createPeriod}>Create Period</Button>
          </div>
        </div>
      )}

      {activePeriod && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
          {!isOpenPeriod && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              This is a past rate period. Its dates are locked; only the name and rate values can be changed.
            </p>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Input label="Period name" value={form.name || ''} onChange={e => set('name', e.target.value)} />
            <DateInput label="Start date" value={form.start_date} onChange={v => set('start_date', v)} disabled={!isOpenPeriod} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Code" value={form.code || ''} onChange={e => set('code', e.target.value)} placeholder="e.g. NDIS-001" />
            <Input label="Rate ($)" type="number" step="0.01" value={form.rate} onChange={e => set('rate', parseFloat(e.target.value))} />
          </div>
          <div className="border-t border-gray-100 pt-3 space-y-3">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Additional codes &amp; rates</p>
            <div className="grid grid-cols-2 gap-4">
              <Input label="Travel code" value={form.travel_code || ''} onChange={e => set('travel_code', e.target.value)} />
              <Input label="Travel rate ($/hr)" type="number" step="0.01" value={form.travel_rate_per_hour || ''} onChange={e => set('travel_rate_per_hour', e.target.value)} placeholder="Optional" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="KM code" value={form.km_code || ''} onChange={e => set('km_code', e.target.value)} />
              <Input label="KM rate ($/km)" type="number" step="0.01" value={form.km_rate || ''} onChange={e => set('km_rate', e.target.value)} placeholder="Optional" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="Notes code" value={form.notes_code || ''} onChange={e => set('notes_code', e.target.value)} />
              <Input label="Notes rate ($/hr)" type="number" step="0.01" value={form.notes_rate || ''} onChange={e => set('notes_rate', e.target.value)} placeholder="Optional" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="Cancellation code" value={form.cancel_code || ''} onChange={e => set('cancel_code', e.target.value)} />
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">GST Type</label>
                <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  value={form.gst_type || 'GST'} onChange={e => set('gst_type', e.target.value)}>
                  <option value="GST">GST (standard rate)</option>
                  <option value="FRE">GST Free</option>
                  <option value="N-T">N-T (Not Reportable)</option>
                </select>
              </div>
            </div>
          </div>
          <div className="flex justify-between items-center pt-2">
            <div>
              {isOpenPeriod && periods.length > 1 && (
                <Button variant="ghost" onClick={deletePeriod}><Trash2 className="h-3.5 w-3.5 text-red-400" /> Delete Period</Button>
              )}
            </div>
            {dirty && <Button onClick={saveRates} disabled={saving}>{saving ? 'Saving…' : 'Save Rates'}</Button>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ServiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = id === 'new';
  const [service, setService] = useState(isNew ? {} : null);
  const [form, setForm] = useState(EMPTY_DETAILS);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = () => {
    if (isNew) return;
    api.get(`/services/${id}`).then(r => {
      setService(r.data);
      setForm({
        name: r.data.name || '',
        description: r.data.description || '',
        unit: r.data.unit || 'hour',
        default_duration: r.data.default_duration || 60,
        discipline_id: r.data.discipline_id || '',
      });
    });
  };

  useEffect(() => { load(); }, [id]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      if (isNew) {
        const res = await api.post('/services', form);
        navigate(`/services/${res.data.id}`, { replace: true });
      } else {
        await api.patch(`/services/${id}`, form);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        load();
      }
    } finally { setSaving(false); }
  };

  if (!service) return <div className="p-6 text-gray-400">Loading…</div>;

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/services')} className="text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-2xl font-semibold flex-1">
          {isNew ? 'New Service' : service.name}
        </h1>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Input label="Service name" value={form.name} onChange={e => set('name', e.target.value)} />
          <DisciplinePicker value={form.discipline_id} onChange={v => set('discipline_id', v)} noneLabel="— All disciplines —" />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Input label="Description" value={form.description} onChange={e => set('description', e.target.value)} />
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Unit</label>
            <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={form.unit} onChange={e => set('unit', e.target.value)}>
              <option value="hour">Per hour</option>
              <option value="session">Per session</option>
              <option value="km">Per km</option>
              <option value="item">Per item</option>
            </select>
          </div>
          <Input label="Default duration (minutes)" type="number" value={form.default_duration}
            onChange={e => set('default_duration', parseInt(e.target.value))} />
        </div>
        <div className="flex justify-end gap-2">
          {saved && <span className="text-sm text-green-600 self-center">Saved</span>}
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : isNew ? 'Create Service' : 'Save Details'}</Button>
        </div>
      </div>

      {!isNew && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Rate Periods</h2>
          <RatePeriods serviceId={service.id} />
        </div>
      )}
    </div>
  );
}
