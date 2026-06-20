import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, ChevronRight, Pencil, Trash2, AlertTriangle, Bell } from 'lucide-react';
import { format, parseISO, isWithinInterval, parseISO as parse } from 'date-fns';
import api from '../lib/api';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import SearchSelect from '../components/ui/SearchSelect';
import { localToday } from '../lib/utils';

const FUNDING_COLOR = { NDIS: 'blue', Medicare: 'green', Private: 'purple', 'Aged Care': 'orange', Other: 'gray' };

const EMPTY_CLIENT = {
  first_name: '', last_name: '', email: '', phone: '', date_of_birth: '',
  address: '', ndis_number: '', notes: '', alert: '',
  emergency_contact_name: '', emergency_contact_phone: '', emergency_contact_relationship: '',
  diagnosis: '', allergies: '', regular_medication: '',
};

const dateInput = (label, value, onChange) => (
  <div className="space-y-1">
    <label className="block text-sm font-medium text-gray-700">{label}</label>
    <input type="date"
      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      value={value}
      onChange={e => { onChange(e.target.value); e.target.blur(); }}
    />
  </div>
);

// ─── Add Funder mini-modal ─────────────────────────────────────────────

function AddFundsManagerModal({ initialName, onClose, onSaved }) {
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try { const res = await api.post('/funds-managers', { name, email }); onSaved(res.data); }
    finally { setSaving(false); }
  };
  return (
    <Modal title="Add Funder" onClose={onClose}>
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

// ─── Funding tab ──────────────────────────────────────────────────────────────

const EMPTY_PERIOD = { funding_type: '', funds_manager_id: '', client_identifier: '', start_date: '', end_date: '' };

function FundingTab({ clientId }) {
  const [periods, setPeriods] = useState([]);
  const [fundsManagers, setFundsManagers] = useState([]);
  const [editing, setEditing] = useState(null); // null | 'new' | period obj
  const [form, setForm] = useState(EMPTY_PERIOD);
  const [overlapWarning, setOverlapWarning] = useState('');
  const [saving, setSaving] = useState(false);
  const [addFMName, setAddFMName] = useState(null);

  const loadPeriods = () => api.get(`/funding-periods?client_id=${clientId}`).then(r => setPeriods(r.data));
  const loadFMs = () => api.get('/funds-managers').then(r => setFundsManagers(r.data));

  useEffect(() => { if (clientId) { loadPeriods(); loadFMs(); } }, [clientId]);

  const fmOptions = fundsManagers.map(fm => ({
    value: fm.id,
    label: fm.email ? `${fm.name} — ${fm.email}` : fm.name,
  }));

  const handleAddFM = name => new Promise(resolve => setAddFMName({ name, resolve }));

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    setOverlapWarning('');
  };

  const openAdd = () => { setEditing('new'); setForm(EMPTY_PERIOD); setOverlapWarning(''); };
  const openEdit = p => { setEditing(p); setForm({ funding_type: p.funding_type, funds_manager_id: p.funds_manager_id || '', client_identifier: p.client_identifier || '', start_date: p.start_date, end_date: p.end_date }); setOverlapWarning(''); };
  const cancel = () => { setEditing(null); setOverlapWarning(''); };

  const save = async () => {
    setOverlapWarning('');
    setSaving(true);
    try {
      if (editing === 'new') {
        await api.post('/funding-periods', { ...form, client_id: clientId, funds_manager_id: form.funds_manager_id || null });
      } else {
        await api.patch(`/funding-periods/${editing.id}`, { ...form, funds_manager_id: form.funds_manager_id || null });
      }
      setEditing(null);
      loadPeriods();
    } catch (e) {
      if (e.response?.status === 422) setOverlapWarning(e.response.data.error);
    } finally { setSaving(false); }
  };

  const remove = async id => {
    if (!confirm('Delete this funding period?')) return;
    await api.delete(`/funding-periods/${id}`);
    loadPeriods();
  };

  const today = localToday();
  const isActive = p => p.start_date <= today && p.end_date >= today;

  if (!clientId) return <p className="text-sm text-gray-400 py-6 text-center">Save the client first to manage funding periods.</p>;

  return (
    <div className="space-y-3">
      {periods.length === 0 && !editing && (
        <p className="text-sm text-gray-400 py-4 text-center">No funding periods added yet.</p>
      )}

      {periods.map(p => (
        <div key={p.id} className={`rounded-lg border p-3 ${isActive(p) ? 'border-indigo-200 bg-indigo-50/40' : 'border-gray-200 bg-white'}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Badge color={FUNDING_COLOR[p.funding_type] || 'gray'}>{p.funding_type}</Badge>
                {isActive(p) && <span className="text-xs text-indigo-600 font-medium">Active</span>}
              </div>
              <p className="text-sm text-gray-700 mt-1">
                {format(parseISO(p.start_date), 'd MMM yyyy')} – {format(parseISO(p.end_date), 'd MMM yyyy')}
              </p>
              {p.funds_manager_name && (
                <p className="text-xs text-gray-500">Funder: {p.funds_manager_name}</p>
              )}
              {p.client_identifier && (
                <p className="text-xs text-gray-500">Client ID: {p.client_identifier}</p>
              )}
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => openEdit(p)} className="text-gray-400 hover:text-gray-600 p-1"><Pencil className="h-3.5 w-3.5" /></button>
              <button onClick={() => remove(p.id)} className="text-red-300 hover:text-red-500 p-1"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        </div>
      ))}

      {editing ? (
        <div className="rounded-lg border border-gray-200 p-4 space-y-3 bg-gray-50">
          <p className="text-sm font-medium text-gray-700">{editing === 'new' ? 'Add funding period' : 'Edit funding period'}</p>

          {overlapWarning && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              {overlapWarning}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Funding type</label>
              <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                value={form.funding_type} onChange={e => set('funding_type', e.target.value)}>
                <option value="">Select…</option>
                {['NDIS', 'Medicare', 'Private', 'Other'].map(f => <option key={f}>{f}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Funder {form.funding_type !== 'NDIS' && <span className="text-gray-400">(optional)</span>}</label>
              {form.funding_type === 'NDIS' || true ? (
                <SearchSelect
                  options={fmOptions}
                  value={form.funds_manager_id}
                  onChange={v => set('funds_manager_id', v)}
                  placeholder="None"
                  onAddNew={handleAddFM}
                  addNewLabel="Add funder"
                />
              ) : null}
            </div>
            <div className="col-span-2 space-y-1">
              <label className="block text-sm font-medium text-gray-700">Client ID <span className="text-gray-400">(optional)</span></label>
              <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                value={form.client_identifier} onChange={e => set('client_identifier', e.target.value)}
                placeholder="e.g. NDIS participant number" />
            </div>
            {dateInput('Start date', form.start_date, v => set('start_date', v))}
            {dateInput('End date', form.end_date, v => set('end_date', v))}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={cancel}>Cancel</Button>
            <Button size="sm" onClick={save}
              disabled={saving || !form.funding_type || !form.start_date || !form.end_date}>
              {saving ? 'Saving…' : editing === 'new' ? 'Add period' : 'Save changes'}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" size="sm" onClick={openAdd}>
          <Plus className="h-3.5 w-3.5" /> Add funding period
        </Button>
      )}

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
    </div>
  );
}

// ─── Medical tab ──────────────────────────────────────────────────────────────

function MedicalTab({ form, set }) {
  const ta = (label, key, rows = 3) => (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <textarea rows={rows}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        value={form[key] || ''}
        onChange={e => set(key, e.target.value)}
      />
    </div>
  );
  return (
    <div className="space-y-3 py-1">
      {ta('Diagnosis', 'diagnosis')}
      {ta('Allergies', 'allergies', 2)}
      {ta('Regular medication', 'regular_medication', 3)}
    </div>
  );
}

// ─── Case notes tab ───────────────────────────────────────────────────────────

function CaseNotesTab({ clientId }) {
  const [notes, setNotes] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');

  const load = () => api.get(`/case-notes?client_id=${clientId}`).then(r => setNotes(r.data));
  useEffect(() => { if (clientId) load(); }, [clientId]);

  const saveEdit = async id => {
    await api.patch(`/case-notes/${id}`, { note: editText });
    setEditingId(null); load();
  };
  const remove = async id => {
    if (!confirm('Delete this note?')) return;
    await api.delete(`/case-notes/${id}`); load();
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
                <button onClick={() => { setEditingId(n.id); setEditText(n.note); }} className="text-gray-400 hover:text-gray-600"><Pencil className="h-3.5 w-3.5" /></button>
                <button onClick={() => remove(n.id)} className="text-red-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Client modal ─────────────────────────────────────────────────────────────

function ClientModal({ client, onClose, onSaved }) {
  const [tab, setTab] = useState('details');
  const [form, setForm] = useState(client ? {
    first_name: client.first_name || '',
    last_name: client.last_name || '',
    email: client.email || '',
    phone: client.phone || '',
    date_of_birth: client.date_of_birth || '',
    address: client.address || '',
    ndis_number: client.ndis_number || '',
    notes: client.notes || '',
    emergency_contact_name: client.emergency_contact_name || '',
    emergency_contact_phone: client.emergency_contact_phone || '',
    emergency_contact_relationship: client.emergency_contact_relationship || '',
    diagnosis: client.diagnosis || '',
    allergies: client.allergies || '',
    regular_medication: client.regular_medication || '',
  } : { ...EMPTY_CLIENT });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      if (client) await api.patch(`/clients/${client.id}`, form);
      else        await api.post('/clients', form);
      onSaved();
    } finally { setSaving(false); }
  };

  const TABS = client
    ? [['details', 'Details'], ['funding', 'Funding'], ['medical', 'Medical'], ['notes', 'Case Notes']]
    : [['details', 'Details']];

  return (
    <Modal title={client ? `${client.first_name} ${client.last_name}` : 'Add Client'} onClose={onClose} wide>
      {TABS.length > 1 && (
        <div className="flex border-b border-gray-200 mb-4 -mt-1">
          {TABS.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === id ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="max-h-[60vh] overflow-y-auto pr-1">
        {tab === 'details' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Input label="First name" value={form.first_name} onChange={e => set('first_name', e.target.value)} />
              <Input label="Last name"  value={form.last_name}  onChange={e => set('last_name', e.target.value)} />
              <Input label="Email"      value={form.email}      onChange={e => set('email', e.target.value)} type="email" />
              <Input label="Phone"      value={form.phone}      onChange={e => set('phone', e.target.value)} />
              {dateInput('Date of birth', form.date_of_birth, v => set('date_of_birth', v))}
              <div className="col-span-2">
                <Input label="Address" value={form.address} onChange={e => set('address', e.target.value)} />
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Emergency contact</p>
              <div className="grid grid-cols-3 gap-3">
                <Input label="Name" value={form.emergency_contact_name} onChange={e => set('emergency_contact_name', e.target.value)} />
                <Input label="Phone" value={form.emergency_contact_phone} onChange={e => set('emergency_contact_phone', e.target.value)} />
                <Input label="Relationship" value={form.emergency_contact_relationship} onChange={e => set('emergency_contact_relationship', e.target.value)} placeholder="e.g. Parent" />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Notes</label>
              <textarea rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none"
                value={form.notes} onChange={e => set('notes', e.target.value)} />
            </div>
          </div>
        )}

        {tab === 'funding' && <FundingTab clientId={client?.id} />}
        {tab === 'medical' && <MedicalTab form={form} set={set} />}
        {tab === 'notes'   && <CaseNotesTab clientId={client?.id} />}
      </div>

      {(tab === 'details' || tab === 'medical' || !client) && (
        <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-gray-100">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      )}
    </Modal>
  );
}

// ─── Clients list ─────────────────────────────────────────────────────────────

export default function Clients() {
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('1');

  const load = (q = '', af = activeFilter) => {
    const params = new URLSearchParams();
    if (q) params.set('search', q);
    params.set('active', af);
    api.get(`/clients?${params}`).then(r => setClients(r.data));
  };
  useEffect(() => { load(search, activeFilter); }, [activeFilter]);
  useEffect(() => {
    const t = setTimeout(() => load(search, activeFilter), 300);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Clients</h1>
        <Button onClick={() => navigate('/clients/new')}><Plus className="h-4 w-4" /> Add client</Button>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input className="w-64 rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="Search name, email…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select value={activeFilter} onChange={e => setActiveFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700">
          <option value="1">Active</option>
          <option value="0">Inactive</option>
          <option value="all">All</option>
        </select>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>
              {['Name', 'Contact', 'Active Funding', 'Funder', ''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {clients.length === 0 && (
              <tr><td colSpan={5} className="py-12 text-center text-gray-400">No clients found</td></tr>
            )}
            {clients.map(c => {
              const fundingType = c.active_funding_type || c.funding_type;
              const fundsManager = c.active_funds_manager_name || c.funds_manager_name;
              return (
                <tr key={c.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/clients/${c.id}`)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{c.last_name}, {c.first_name}</span>
                      {c.alert && <Bell className="h-3.5 w-3.5 text-amber-500 shrink-0" title={c.alert} />}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    <div>{c.email}</div>
                    <div className="text-gray-400">{c.phone}</div>
                  </td>
                  <td className="px-4 py-3">
                    {fundingType
                      ? <Badge color={FUNDING_COLOR[fundingType] || 'gray'}>{fundingType}</Badge>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {fundsManager || <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-indigo-500"><ChevronRight className="h-4 w-4" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

    </div>
  );
}
