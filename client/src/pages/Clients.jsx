import { useState, useEffect } from 'react';
import { Search, Plus, ChevronRight } from 'lucide-react';
import api from '../lib/api';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';

const FUNDING_COLOR = { NDIS: 'blue', Medicare: 'green', Private: 'purple' };
const EMPTY = { first_name:'', last_name:'', email:'', phone:'', date_of_birth:'', address:'', ndis_number:'', funding_type:'', funds_manager_id:'', notes:'' };

function ClientModal({ client, onClose, onSaved }) {
  const [form, setForm] = useState(client || EMPTY);
  const [fundsManagers, setFundsManagers] = useState([]);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    api.get('/funds-managers').then(r => setFundsManagers(r.data));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...form, funds_manager_id: form.funds_manager_id || null };
      if (client) await api.patch(`/clients/${client.id}`, payload);
      else        await api.post('/clients', payload);
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <Modal title={client ? 'Edit Client' : 'Add Client'} onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-3">
        <Input label="First name" value={form.first_name} onChange={e => set('first_name', e.target.value)} />
        <Input label="Last name"  value={form.last_name}  onChange={e => set('last_name', e.target.value)} />
        <Input label="Email"      value={form.email}      onChange={e => set('email', e.target.value)} type="email" />
        <Input label="Phone"      value={form.phone}      onChange={e => set('phone', e.target.value)} />
        <Input label="Date of birth" value={form.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} type="date" />
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700">Funding type</label>
          <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            value={form.funding_type} onChange={e => set('funding_type', e.target.value)}>
            <option value="">Select…</option>
            {['NDIS','Medicare','Private','Other'].map(f => <option key={f}>{f}</option>)}
          </select>
        </div>
        <Input label="NDIS number" value={form.ndis_number} onChange={e => set('ndis_number', e.target.value)} />
        <div className="col-span-2 space-y-1">
          <label className="block text-sm font-medium text-gray-700">Funds manager</label>
          <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            value={form.funds_manager_id || ''} onChange={e => set('funds_manager_id', e.target.value)}>
            <option value="">None</option>
            {fundsManagers.map(fm => <option key={fm.id} value={fm.id}>{fm.name} — {fm.email}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <Input label="Address" value={form.address} onChange={e => set('address', e.target.value)} />
        </div>
        <div className="col-span-2 space-y-1">
          <label className="block text-sm font-medium text-gray-700">Notes</label>
          <textarea rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none"
            value={form.notes} onChange={e => set('notes', e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </Modal>
  );
}

export default function Clients() {
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);

  const load = (q = '') => api.get(`/clients${q ? `?search=${q}` : ''}`).then(r => setClients(r.data));

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const t = setTimeout(() => load(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Clients</h1>
        <Button onClick={() => setModal({})}>
          <Plus className="h-4 w-4" /> Add client
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          placeholder="Search name, email or NDIS…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>
              {['Name','Contact','Funding','Funds Manager',''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {clients.length === 0 && (
              <tr><td colSpan={5} className="py-12 text-center text-gray-400">No clients found</td></tr>
            )}
            {clients.map(c => (
              <tr key={c.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setModal(c)}>
                <td className="px-4 py-3 font-medium text-gray-900">{c.last_name}, {c.first_name}</td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  <div>{c.email}</div>
                  <div className="text-gray-400">{c.phone}</div>
                </td>
                <td className="px-4 py-3">
                  {c.funding_type && <Badge color={FUNDING_COLOR[c.funding_type] || 'gray'}>{c.funding_type}</Badge>}
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {c.funds_manager_name
                    ? <span>{c.funds_manager_name}</span>
                    : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-4 py-3 text-right text-indigo-500"><ChevronRight className="h-4 w-4" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal !== null && (
        <ClientModal
          client={modal.id ? modal : null}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(search); }}
        />
      )}
    </div>
  );
}
