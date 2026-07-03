import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import api from '../lib/api';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import DisciplinePicker from '../components/DisciplinePicker';

const EMPTY_DETAILS = { name: '', description: '', unit: 'hour', default_duration: 60, discipline_id: '' };

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
        <p className="text-sm text-gray-500">
          Rates for this service are managed per funding type — see <span className="font-medium">Settings → Funding Types → Manage Rates</span>.
          {service.funding_type_names && <> Currently priced under: <span className="font-medium text-gray-700">{service.funding_type_names}</span>.</>}
        </p>
      )}
    </div>
  );
}
