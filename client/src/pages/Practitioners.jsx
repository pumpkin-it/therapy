import { useState, useEffect } from 'react';
import { Plus, Pencil, UserX, UserCheck, Calendar, ArrowLeft, PlusCircle } from 'lucide-react';
import api from '../lib/api';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import { EmbeddedCalendar } from '../components/CalendarViews';

const ROLES = [
  { value: 'owner',        label: 'Owner',        desc: 'Full access' },
  { value: 'admin',        label: 'Admin',        desc: 'All except Settings' },
  { value: 'practitioner', label: 'Practitioner', desc: 'Calendar & Clients' },
  { value: 'finance',      label: 'Finance',      desc: 'Clients, Invoices & Services' },
];

const ROLE_COLORS = {
  owner:        'bg-purple-100 text-purple-700',
  admin:        'bg-blue-100 text-blue-700',
  practitioner: 'bg-green-100 text-green-700',
  finance:      'bg-amber-100 text-amber-700',
};

const EMPTY = { first_name: '', last_name: '', title: '', email: '', phone: '', color: '#6366f1', provider_number: '', role: 'practitioner', gender: '', discipline_id: '' };

function UserModal({ user, onClose, onSaved }) {
  const [form, setForm] = useState(user || EMPTY);
  const [saving, setSaving] = useState(false);
  const [disciplines, setDisciplines] = useState([]);
  const [newDiscipline, setNewDiscipline] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => { api.get('/disciplines').then(r => setDisciplines(r.data)); }, []);

  const addDiscipline = async () => {
    if (!newDiscipline.trim()) return;
    const res = await api.post('/disciplines', { name: newDiscipline.trim() });
    setDisciplines(d => [...d, res.data]);
    set('discipline_id', res.data.id);
    setNewDiscipline('');
  };

  const save = async () => {
    setSaving(true);
    try {
      if (user) await api.patch(`/practitioners/${user.id}`, form);
      else      await api.post('/practitioners', form);
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <Modal title={user ? 'Edit User' : 'Add User'} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Input label="First name" value={form.first_name} onChange={e => set('first_name', e.target.value)} />
          <Input label="Last name"  value={form.last_name}  onChange={e => set('last_name', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Title (e.g. OT, Psychologist)" value={form.title} onChange={e => set('title', e.target.value)} />
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Discipline</label>
            <div className="flex gap-1">
              <select className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                value={form.discipline_id} onChange={e => set('discipline_id', e.target.value)}>
                <option value="">— None —</option>
                {disciplines.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div className="flex gap-1 mt-1">
              <input className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs" placeholder="Add new…"
                value={newDiscipline} onChange={e => setNewDiscipline(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addDiscipline()} />
              <button onClick={addDiscipline} className="text-indigo-500 hover:text-indigo-700"><PlusCircle className="h-4 w-4" /></button>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Email" type="email" value={form.email} onChange={e => set('email', e.target.value)} />
          <Input label="Phone" value={form.phone} onChange={e => set('phone', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Provider number" value={form.provider_number} onChange={e => set('provider_number', e.target.value)} />
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Gender</label>
            <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              value={form.gender} onChange={e => set('gender', e.target.value)}>
              <option value="">—</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Non-binary">Non-binary</option>
              <option value="Other">Other</option>
              <option value="Prefer not to say">Prefer not to say</option>
            </select>
          </div>
        </div>

        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700">Role</label>
          <div className="grid grid-cols-2 gap-2">
            {ROLES.map(r => (
              <button key={r.value} type="button"
                onClick={() => set('role', r.value)}
                className={`rounded-lg border-2 px-3 py-2 text-left transition-colors ${
                  form.role === r.value
                    ? 'border-indigo-500 bg-indigo-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}>
                <div className="text-sm font-medium text-gray-900">{r.label}</div>
                <div className="text-xs text-gray-500 mt-0.5">{r.desc}</div>
              </button>
            ))}
          </div>
        </div>

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

export default function Users() {
  const [users, setUsers] = useState([]);
  const [modal, setModal] = useState(null);
  const [activeFilter, setActiveFilter] = useState('1');
  const [roleFilter, setRoleFilter] = useState('');
  const [calendarUser, setCalendarUser] = useState(null);

  const load = () => api.get(`/practitioners?active=${activeFilter}`).then(r => setUsers(r.data));
  useEffect(() => { load(); }, [activeFilter]);

  const visible = roleFilter ? users.filter(u => u.role === roleFilter) : users;

  if (calendarUser) {
    return (
      <div className="space-y-4 h-full flex flex-col">
        <div className="flex items-center gap-3">
          <button onClick={() => setCalendarUser(null)} className="text-gray-400 hover:text-gray-600">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h2 className="text-lg font-semibold">{calendarUser.first_name} {calendarUser.last_name} — Calendar</h2>
        </div>
        <EmbeddedCalendar practitionerId={calendarUser.id} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Users</h1>
        <div className="flex items-center gap-2">
          <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700">
            <option value="">All roles</option>
            {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <select value={activeFilter} onChange={e => setActiveFilter(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700">
            <option value="1">Active</option>
            <option value="0">Inactive</option>
            <option value="all">All</option>
          </select>
          <Button onClick={() => setModal({})}><Plus className="h-4 w-4" /> Add user</Button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>
              {['Name', 'Title', 'Email', 'Phone', 'Provider #', 'Role', 'Status', ''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {visible.map(u => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full shrink-0" style={{ background: u.color }} />
                    <span className="font-medium text-gray-900"><span className="font-mono text-xs text-purple-400 mr-1.5">USR-{String(u.id).padStart(5,'0')}</span>{u.first_name} {u.last_name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{u.title || '—'}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{u.email || '—'}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{u.phone || '—'}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{u.provider_number || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${ROLE_COLORS[u.role] || 'bg-gray-100 text-gray-600'}`}>
                    {ROLES.find(r => r.value === u.role)?.label || 'Practitioner'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {u.active
                    ? <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5 font-medium">Active</span>
                    : <span className="text-xs bg-gray-100 text-gray-500 rounded-full px-2 py-0.5 font-medium">Inactive</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center gap-1 justify-end">
                    <Button variant="ghost" size="sm" title="View calendar" onClick={() => setCalendarUser(u)}>
                      <Calendar className="h-3.5 w-3.5 text-indigo-400" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setModal(u)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" title={u.active ? 'Deactivate' : 'Reactivate'}
                      onClick={async () => { await api.patch(`/practitioners/${u.id}/active`, { active: !u.active }); load(); }}>
                      {u.active
                        ? <UserX className="h-3.5 w-3.5 text-red-400" />
                        : <UserCheck className="h-3.5 w-3.5 text-green-500" />}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal !== null && (
        <UserModal
          user={modal.id ? modal : null}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}
