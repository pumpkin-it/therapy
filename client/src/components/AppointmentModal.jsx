import { useState, useEffect } from 'react';
import api from '../lib/api';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { Trash2, Plus } from 'lucide-react';

const EMPTY_ITEM = { service_id: '', description: '', quantity: 1, unit_rate: 0, travel_time_min: '', travel_km: '', prep_time_min: '' };

export default function AppointmentModal({ appointment, defaultDate, onClose, onSaved }) {
  const editing = !!appointment;
  const [practitioners, setPractitioners] = useState([]);
  const [clients, setClients] = useState([]);
  const [services, setServices] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    practitioner_id: '',
    client_id: '',
    location: '',
    title: '',
    start_time: `${defaultDate}T09:00`,
    end_time: `${defaultDate}T10:00`,
    status: 'scheduled',
    notes: '',
    items: [{ ...EMPTY_ITEM }],
  });

  useEffect(() => {
    Promise.all([
      api.get('/practitioners').then(r => r.data),
      api.get('/clients').then(r => r.data),
      api.get('/services').then(r => r.data),
    ]).then(([p, c, s]) => {
      setPractitioners(p); setClients(c); setServices(s);
    });

    if (editing) {
      setForm({
        practitioner_id: appointment.practitioner_id,
        client_id: appointment.client_id,
        location: appointment.location || '',
        title: appointment.title || '',
        start_time: appointment.start_time?.slice(0, 16),
        end_time: appointment.end_time?.slice(0, 16),
        status: appointment.status,
        notes: appointment.notes || '',
        items: appointment.items?.length ? appointment.items.map(i => ({
          service_id: i.service_id || '',
          description: i.description,
          quantity: i.quantity,
          unit_rate: i.unit_rate,
          travel_time_min: i.travel_time_min || '',
          travel_km: i.travel_km || '',
          prep_time_min: i.prep_time_min || '',
        })) : [{ ...EMPTY_ITEM }],
      });
    }
  }, []);

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const setItem = (idx, k, v) => setForm(f => {
    const items = [...f.items];
    items[idx] = { ...items[idx], [k]: v };
    // Auto-fill rate from service
    if (k === 'service_id' && v) {
      const svc = services.find(s => s.id === Number(v));
      if (svc) {
        items[idx].description = svc.name;
        items[idx].unit_rate   = svc.default_rate;
      }
    }
    return { ...f, items };
  });

  const save = async () => {
    setSaving(true); setError('');
    try {
      const payload = {
        ...form,
        practitioner_id: Number(form.practitioner_id),
        client_id: Number(form.client_id),
        items: form.items.map(i => ({
          ...i,
          service_id:     i.service_id ? Number(i.service_id) : null,
          quantity:       Number(i.quantity),
          unit_rate:      Number(i.unit_rate),
          travel_time_min: i.travel_time_min ? Number(i.travel_time_min) : null,
          travel_km:      i.travel_km ? Number(i.travel_km) : null,
          prep_time_min:  i.prep_time_min ? Number(i.prep_time_min) : null,
        })),
      };
      if (editing) {
        await api.patch(`/appointments/${appointment.id}`, payload);
      } else {
        await api.post('/appointments', payload);
      }
      onSaved();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!confirm('Cancel this appointment?')) return;
    await api.patch(`/appointments/${appointment.id}/status`, { status: 'cancelled' });
    onSaved();
  };

  return (
    <Modal title={editing ? 'Edit Appointment' : 'New Appointment'} onClose={onClose} wide>
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Practitioner</label>
            <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={form.practitioner_id} onChange={e => setField('practitioner_id', e.target.value)}>
              <option value="">Select…</option>
              {practitioners.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Client</label>
            <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={form.client_id} onChange={e => setField('client_id', e.target.value)}>
              <option value="">Select…</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.last_name}, {c.first_name}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Start</label>
            <input type="datetime-local" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={form.start_time} onChange={e => setField('start_time', e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">End</label>
            <input type="datetime-local" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={form.end_time} onChange={e => setField('end_time', e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Location</label>
            <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={form.location} onChange={e => setField('location', e.target.value)} placeholder="e.g. Home visit, Clinic" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Status</label>
            <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={form.status} onChange={e => setField('status', e.target.value)}>
              {['scheduled','confirmed','completed','cancelled','no_show'].map(s =>
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              )}
            </select>
          </div>
        </div>

        {/* Line items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Services / Items</span>
            <Button variant="ghost" size="sm" onClick={() => setForm(f => ({ ...f, items: [...f.items, { ...EMPTY_ITEM }] }))}>
              <Plus className="h-3.5 w-3.5" /> Add item
            </Button>
          </div>
          <div className="space-y-3">
            {form.items.map((item, idx) => (
              <div key={idx} className="rounded-lg border border-gray-200 p-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs text-gray-500">Service</label>
                    <select className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                      value={item.service_id} onChange={e => setItem(idx, 'service_id', e.target.value)}>
                      <option value="">Manual…</option>
                      {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-500">Description</label>
                    <input className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                      value={item.description} onChange={e => setItem(idx, 'description', e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs text-gray-500">Qty</label>
                    <input type="number" step="0.25" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                      value={item.quantity} onChange={e => setItem(idx, 'quantity', e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-500">Rate ($)</label>
                    <input type="number" step="0.01" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                      value={item.unit_rate} onChange={e => setItem(idx, 'unit_rate', e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-500">Travel (min)</label>
                    <input type="number" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                      value={item.travel_time_min} onChange={e => setItem(idx, 'travel_time_min', e.target.value)} placeholder="—" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-500">Travel (km)</label>
                    <input type="number" step="0.1" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                      value={item.travel_km} onChange={e => setItem(idx, 'travel_km', e.target.value)} placeholder="—" />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="space-y-1 w-32">
                    <label className="text-xs text-gray-500">Prep time (min)</label>
                    <input type="number" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                      value={item.prep_time_min} onChange={e => setItem(idx, 'prep_time_min', e.target.value)} placeholder="—" />
                  </div>
                  <div className="ml-auto pt-4">
                    <span className="text-sm font-medium text-gray-700">
                      ${(Number(item.quantity) * Number(item.unit_rate)).toFixed(2)}
                    </span>
                  </div>
                  {form.items.length > 1 && (
                    <button onClick={() => setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))}
                      className="pt-4 text-red-400 hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700">Notes</label>
          <textarea rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none"
            value={form.notes} onChange={e => setField('notes', e.target.value)} />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      <div className="flex items-center gap-2 pt-4 border-t border-gray-100 mt-4">
        {editing && (
          <Button variant="danger" size="sm" onClick={del}>Cancel appointment</Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>
    </Modal>
  );
}
