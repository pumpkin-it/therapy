import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import api from '../lib/api';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';

const EMPTY = { first_name:'', last_name:'', title:'', email:'', phone:'', color:'#6366f1' };

function PractitionerModal({ practitioner, onClose, onSaved }) {
  const [form, setForm] = useState(practitioner || EMPTY);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      if (practitioner) await api.patch(`/practitioners/${practitioner.id}`, form);
      else              await api.post('/practitioners', form);
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <Modal title={practitioner ? 'Edit Practitioner' : 'Add Practitioner'} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Input label="First name" value={form.first_name} onChange={e => set('first_name', e.target.value)} />
          <Input label="Last name"  value={form.last_name}  onChange={e => set('last_name', e.target.value)} />
        </div>
        <Input label="Title (e.g. OT, Psychologist)" value={form.title} onChange={e => set('title', e.target.value)} />
        <Input label="Email" type="email" value={form.email} onChange={e => set('email', e.target.value)} />
        <Input label="Phone" value={form.phone} onChange={e => set('phone', e.target.value)} />
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700">Calendar colour</label>
          <input type="color" value={form.color} onChange={e => set('color', e.target.value)}
            className="h-9 w-20 rounded border border-gray-300 p-1 cursor-pointer" />
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </Modal>
  );
}

export default function Practitioners() {
  const [practitioners, setPractitioners] = useState([]);
  const [modal, setModal] = useState(null);

  const load = () => api.get('/practitioners').then(r => setPractitioners(r.data));
  useEffect(() => { load(); }, []);

  const remove = async (id) => {
    if (!confirm('Remove this practitioner?')) return;
    await api.delete(`/practitioners/${id}`);
    load();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Practitioners</h1>
        <Button onClick={() => setModal({})}><Plus className="h-4 w-4" /> Add practitioner</Button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>
              {['Name','Title','Email','Phone',''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {practitioners.map(p => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ background: p.color }} />
                    <span className="font-medium text-gray-900">{p.first_name} {p.last_name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{p.title || '—'}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{p.email || '—'}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{p.phone || '—'}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center gap-1 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => setModal(p)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => remove(p.id)}><Trash2 className="h-3.5 w-3.5 text-red-400" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal !== null && (
        <PractitionerModal
          practitioner={modal.id ? modal : null}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}
