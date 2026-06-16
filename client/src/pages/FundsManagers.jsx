import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import api from '../lib/api';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';

const EMPTY = { name: '', email: '' };

function FundsManagerModal({ fm, onClose, onSaved }) {
  const [form, setForm] = useState(fm || EMPTY);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      if (fm) await api.patch(`/funds-managers/${fm.id}`, form);
      else    await api.post('/funds-managers', form);
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <Modal title={fm ? 'Edit Funds Manager' : 'Add Funds Manager'} onClose={onClose}>
      <div className="space-y-3">
        <Input label="Name" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. NDIS Support Coord Pty Ltd" />
        <Input label="Email" type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="invoices@example.com" />
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving || !form.name || !form.email}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Modal>
  );
}

export default function FundsManagers() {
  const [fms, setFms] = useState([]);
  const [modal, setModal] = useState(null);

  const load = () => api.get('/funds-managers').then(r => setFms(r.data));
  useEffect(() => { load(); }, []);

  const remove = async id => {
    if (!confirm('Remove this funds manager?')) return;
    await api.delete(`/funds-managers/${id}`);
    load();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Funds Managers</h1>
        <Button onClick={() => setModal({})}><Plus className="h-4 w-4" /> Add funds manager</Button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>
              {['Name', 'Invoice email', ''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {fms.length === 0 && (
              <tr><td colSpan={3} className="py-12 text-center text-gray-400">No funds managers added yet</td></tr>
            )}
            {fms.map(fm => (
              <tr key={fm.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{fm.name}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{fm.email}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex gap-1 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => setModal(fm)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => remove(fm.id)}><Trash2 className="h-3.5 w-3.5 text-red-400" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal !== null && (
        <FundsManagerModal
          fm={modal.id ? modal : null}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}
