import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import api from '../lib/api';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import { currency } from '../lib/utils';

const EMPTY = { name:'', description:'', code:'', default_rate:0, unit:'hour', default_duration:60, travel_rate_per_hour:'', km_rate:'', notes_rate:'', gst_pct:'', discipline_id:'', travel_code:'', km_code:'', notes_code:'' };

function ServiceModal({ service, onClose, onSaved }) {
  const [form, setForm] = useState(() => {
    const s = service || EMPTY;
    return { ...s, gst_pct: s.gst_rate != null && s.gst_rate !== '' ? Math.round(Number(s.gst_rate) * 100) : '' };
  });
  const [saving, setSaving] = useState(false);
  const [disciplines, setDisciplines] = useState([]);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => { api.get('/disciplines').then(r => setDisciplines(r.data)); }, []);

  const save = async () => {
    setSaving(true);
    const payload = { ...form, gst_rate: form.gst_pct !== '' ? Number(form.gst_pct) / 100 : null };
    delete payload.gst_pct;
    try {
      if (service) await api.patch(`/services/${service.id}`, payload);
      else         await api.post('/services', payload);
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <Modal title={service ? 'Edit Service' : 'Add Service'} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Service name" value={form.name} onChange={e => set('name', e.target.value)} />
          <Input label="Code" value={form.code} onChange={e => set('code', e.target.value)} placeholder="e.g. NDIS-001" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Description" value={form.description} onChange={e => set('description', e.target.value)} />
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Discipline</label>
            <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              value={form.discipline_id} onChange={e => set('discipline_id', e.target.value)}>
              <option value="">— All disciplines —</option>
              {disciplines.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Default rate ($)" type="number" step="0.01" value={form.default_rate}
            onChange={e => set('default_rate', parseFloat(e.target.value))} />
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
        </div>
        <Input label="Default duration (minutes)" type="number" value={form.default_duration}
          onChange={e => set('default_duration', parseInt(e.target.value))} />
        <div className="grid grid-cols-3 gap-3">
          <Input label="Travel rate ($/hr)" type="number" step="0.01" value={form.travel_rate_per_hour}
            onChange={e => set('travel_rate_per_hour', e.target.value)} placeholder="Optional" />
          <Input label="KM rate ($/km)" type="number" step="0.01" value={form.km_rate}
            onChange={e => set('km_rate', e.target.value)} placeholder="Optional" />
          <Input label="Notes rate ($/hr)" type="number" step="0.01" value={form.notes_rate}
            onChange={e => set('notes_rate', e.target.value)} placeholder="Optional" />
          <Input label="Travel code" value={form.travel_code}
            onChange={e => set('travel_code', e.target.value)} placeholder="e.g. 04_799" />
          <Input label="KM code" value={form.km_code}
            onChange={e => set('km_code', e.target.value)} placeholder="e.g. 04_799" />
          <Input label="Notes code" value={form.notes_code}
            onChange={e => set('notes_code', e.target.value)} placeholder="e.g. 04_799" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="GST (%)" type="number" step="1" value={form.gst_pct}
            onChange={e => set('gst_pct', e.target.value)} placeholder="e.g. 10" />
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </Modal>
  );
}

export default function Services() {
  const [services, setServices] = useState([]);
  const [disciplines, setDisciplines] = useState([]);
  const [modal, setModal] = useState(null);

  const load = () => api.get('/services').then(r => setServices(r.data));
  useEffect(() => { load(); api.get('/disciplines').then(r => setDisciplines(r.data)); }, []);

  const discName = id => disciplines.find(d => d.id === id)?.name || '—';

  const remove = async id => {
    if (!confirm('Remove this service?')) return;
    await api.delete(`/services/${id}`);
    load();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Services & Rates</h1>
        <Button onClick={() => setModal({})}><Plus className="h-4 w-4" /> Add service</Button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>
              {['Service','Discipline','Rate','Unit','Duration',''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {services.map(s => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{s.name}</div>
                  {s.description && <div className="text-xs text-gray-400">{s.description}</div>}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{s.discipline_id ? discName(s.discipline_id) : <span className="text-gray-300">All</span>}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{currency(s.default_rate)}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{s.unit}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{s.default_duration} min</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex gap-1 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => setModal(s)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => remove(s.id)}><Trash2 className="h-3.5 w-3.5 text-red-400" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal !== null && (
        <ServiceModal
          service={modal.id ? modal : null}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}
