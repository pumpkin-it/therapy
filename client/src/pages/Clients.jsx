import { useState, useEffect } from 'react';
import { Search, Plus, ChevronRight, FileText, Pencil, Trash2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import api from '../lib/api';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import SearchSelect from '../components/ui/SearchSelect';

const FUNDING_COLOR = { NDIS: 'blue', Medicare: 'green', Private: 'purple' };
const EMPTY = {
  first_name: '', last_name: '', email: '', phone: '', date_of_birth: '',
  address: '', ndis_number: '', funding_type: '', funds_manager_id: '',
  plan_start_date: '', plan_end_date: '', notes: '',
};

function AddFundsManagerModal({ initialName, onClose, onSaved }) {
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.post('/funds-managers', { name, email });
      onSaved(res.data);
    } finally { setSaving(false); }
  };

  return (
    <Modal title="Add Funds Manager" onClose={onClose}>
      <div className="space-y-3">
        <Input label="Name" value={name} onChange={e => setName(e.target.value)} />
        <Input label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving || !name}>{saving ? 'Saving…' : 'Add'}</Button>
      </div>
    </Modal>
  );
}

function CaseNotesTab({ clientId }) {
  const [notes, setNotes] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');

  const load = () => api.get(`/case-notes?client_id=${clientId}`).then(r => setNotes(r.data));
  useEffect(() => { if (clientId) load(); }, [clientId]);

  const saveEdit = async id => {
    await api.patch(`/case-notes/${id}`, { note: editText });
    setEditingId(null);
    load();
  };

  const remove = async id => {
    if (!confirm('Delete this note?')) return;
    await api.delete(`/case-notes/${id}`);
    load();
  };

  if (!clientId) return <p className="text-sm text-gray-400 py-4 text-center">Save the client first to view notes.</p>;

  return (
    <div className="space-y-3 py-1">
      {notes.length === 0 && (
        <p className="text-sm text-gray-400 py-6 text-center">No case notes yet. Add them from the calendar when editing an appointment.</p>
      )}
      {notes.map(n => (
        <div key={n.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
          {editingId === n.id ? (
            <div className="space-y-2">
              <textarea rows={3} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm resize-none"
                value={editText} onChange={e => setEditText(e.target.value)} autoFocus />
              <div className="flex gap-2 justify-end">
                <Button variant="secondary" size="sm" onClick={() => setEditingId(null)}>Cancel</Button>
                <Button size="sm" onClick={() => saveEdit(n.id)}>Save</Button>
              </div>
            </div>
          ) : (
            <div className="group flex gap-2">
              <div className="flex-1">
                <p className="text-sm text-gray-800 whitespace-pre-wrap">{n.note}</p>
                <p className="text-xs text-gray-400 mt-1.5">
                  {n.practitioner_name && <span className="font-medium">{n.practitioner_name} · </span>}
                  {n.appointment_time && <span>{format(parseISO(n.appointment_time), 'd MMM yyyy')} · </span>}
                  {format(parseISO(n.created_at), 'd MMM yyyy h:mm a')}
                </p>
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button onClick={() => { setEditingId(n.id); setEditText(n.note); }}
                  className="text-gray-400 hover:text-gray-600"><Pencil className="h-3.5 w-3.5" /></button>
                <button onClick={() => remove(n.id)}
                  className="text-red-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ClientModal({ client, onClose, onSaved }) {
  const [tab, setTab] = useState('details');
  const [form, setForm] = useState(client || EMPTY);
  const [fundsManagers, setFundsManagers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [addFMName, setAddFMName] = useState(null); // triggers AddFundsManagerModal
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const loadFMs = () => api.get('/funds-managers').then(r => setFundsManagers(r.data));
  useEffect(() => { loadFMs(); }, []);

  const handleAddFM = name => {
    // Return a promise that resolves once the modal completes
    return new Promise(resolve => {
      setAddFMName({ name, resolve });
    });
  };

  const fmOptions = fundsManagers.map(fm => ({
    value: fm.id,
    label: fm.email ? `${fm.name} — ${fm.email}` : fm.name,
  }));

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        funds_manager_id: form.funds_manager_id || null,
        plan_start_date: form.funding_type === 'NDIS' ? (form.plan_start_date || null) : null,
        plan_end_date:   form.funding_type === 'NDIS' ? (form.plan_end_date   || null) : null,
      };
      if (client) await api.patch(`/clients/${client.id}`, payload);
      else        await api.post('/clients', payload);
      onSaved();
    } finally { setSaving(false); }
  };

  const dateInput = (label, key) => (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <input
        type="date"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        value={form[key]}
        onChange={e => { set(key, e.target.value); e.target.blur(); }}
      />
    </div>
  );

  return (
    <>
    <Modal title={client ? `${client.first_name} ${client.last_name}` : 'Add Client'} onClose={onClose} wide>
      {/* Tabs — only show when editing an existing client */}
      {client && (
        <div className="flex border-b border-gray-200 mb-4 -mt-1">
          {[['details', 'Details'], ['notes', 'Case Notes']].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === id ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {tab === 'details' && (
        <>
        <div className="grid grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto pr-1">
          <Input label="First name" value={form.first_name} onChange={e => set('first_name', e.target.value)} />
          <Input label="Last name"  value={form.last_name}  onChange={e => set('last_name', e.target.value)} />
          <Input label="Email"      value={form.email}      onChange={e => set('email', e.target.value)} type="email" />
          <Input label="Phone"      value={form.phone}      onChange={e => set('phone', e.target.value)} />
          {dateInput('Date of birth', 'date_of_birth')}
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Funding type</label>
            <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={form.funding_type} onChange={e => set('funding_type', e.target.value)}>
              <option value="">Select…</option>
              {['NDIS', 'Medicare', 'Private', 'Other'].map(f => <option key={f}>{f}</option>)}
            </select>
          </div>
          <Input label="NDIS number" value={form.ndis_number} onChange={e => set('ndis_number', e.target.value)} />

          {form.funding_type === 'NDIS' && (
            <>
              {dateInput('Plan start date', 'plan_start_date')}
              {dateInput('Plan end date', 'plan_end_date')}
            </>
          )}

          <div className="col-span-2 space-y-1">
            <label className="block text-sm font-medium text-gray-700">Funds manager</label>
            <SearchSelect
              options={fmOptions}
              value={form.funds_manager_id}
              onChange={v => set('funds_manager_id', v)}
              placeholder="None"
              onAddNew={handleAddFM}
              addNewLabel="Add funds manager"
            />
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
        </>
      )}

      {tab === 'notes' && (
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          <CaseNotesTab clientId={client?.id} />
        </div>
      )}
    </Modal>

    {addFMName && (
      <AddFundsManagerModal
        initialName={addFMName.name}
        onClose={() => setAddFMName(null)}
        onSaved={async fm => {
          await loadFMs();
          set('funds_manager_id', fm.id);
          addFMName.resolve({ value: fm.id, label: fm.email ? `${fm.name} — ${fm.email}` : fm.name });
          setAddFMName(null);
        }}
      />
    )}
    </>
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
              {['Name', 'Contact', 'Funding', 'Funds Manager', ''].map(h => (
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
