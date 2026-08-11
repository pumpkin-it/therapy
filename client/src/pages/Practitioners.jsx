import { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, Pencil, UserX, UserCheck, Calendar, ArrowLeft, Link2, Mail } from 'lucide-react';
import api from '../lib/api';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import DisciplinePicker from '../components/DisciplinePicker';
import { EmbeddedCalendar } from '../components/CalendarViews';
import { useAuth } from '../context/AuthContext';

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

const EMPTY = { first_name: '', last_name: '', title: '', email: '', phone: '', color: '#6366f1', provider_number: '', role: 'practitioner', gender: '', discipline_id: '', password: '', target_amount: '', target_period: 'fortnightly' };

function UserModal({ user, onClose, onSaved }) {
  const { user: authUser } = useAuth();
  const isSelf = !!(user && authUser && Number(user.id) === Number(authUser.id));
  const [form, setForm] = useState(user || EMPTY);
  const [saving, setSaving] = useState(false);
  const [duplicates, setDuplicates] = useState([]);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(false);
  const [createdEmail, setCreatedEmail] = useState(null); // { sent, error } from the create response
  const [resetStatus, setResetStatus] = useState(null); // 'sending' | 'sent' | { error }
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const dupTimer = useRef(null);

  useEffect(() => {
    clearTimeout(dupTimer.current);
    if (!form.first_name || !form.last_name) { setDuplicates([]); return; }
    dupTimer.current = setTimeout(() => {
      const params = new URLSearchParams({ first_name: form.first_name, last_name: form.last_name });
      if (user?.id) params.set('exclude_id', user.id);
      api.get(`/practitioners/check-duplicates?${params}`).then(r => setDuplicates(r.data)).catch(() => {});
    }, 500);
    return () => clearTimeout(dupTimer.current);
  }, [form.first_name, form.last_name]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      if (user) {
        // Only self-service edits (or the no-email fallback) ever carry a `password` field here —
        // stripping it otherwise means re-saving unrelated fields can never accidentally blank a
        // password that's meant to be managed via the set-password email flow instead.
        const payload = (isSelf || !form.email) ? form : { ...form, password: undefined };
        await api.patch(`/practitioners/${user.id}`, payload);
        onSaved();
      } else {
        const res = await api.post('/practitioners', form);
        setCreatedEmail(res.data.setPasswordEmail || null);
        setCreated(true);
      }
    } catch (e) {
      if (e.response?.status === 409 || e.response?.status === 400) setError(e.response.data.message || e.response.data.error);
    } finally { setSaving(false); }
  };

  const sendSetPasswordLink = async () => {
    setResetStatus('sending');
    try {
      await api.post(`/practitioners/${user.id}/send-set-password`);
      setResetStatus('sent');
    } catch (e) {
      setResetStatus({ error: e.response?.data?.error || 'Failed to send' });
    } finally {
      setTimeout(() => setResetStatus(null), 5000);
    }
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
          <DisciplinePicker value={form.discipline_id} onChange={v => set('discipline_id', v)} />
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

        {form.role === 'practitioner' && (
          <div className="grid grid-cols-2 gap-3">
            <Input label="Billing target ($)" type="number" value={form.target_amount ?? ''} onChange={e => set('target_amount', e.target.value)}
              placeholder="e.g. 5000" />
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Target period</label>
              <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                value={form.target_period || 'fortnightly'} onChange={e => set('target_period', e.target.value)}>
                <option value="weekly">Weekly</option>
                <option value="fortnightly">Fortnightly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
          </div>
        )}

        {isSelf ? (
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">New Password</label>
            <input type="password" value={form.password || ''} onChange={e => set('password', e.target.value)}
              placeholder="Leave blank to keep current"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <p className="text-xs text-gray-400">Changing your own password takes effect immediately.</p>
          </div>
        ) : user && form.email ? (
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Password</label>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={sendSetPasswordLink} disabled={resetStatus === 'sending'}>
                <Mail className="h-3.5 w-3.5" /> {resetStatus === 'sending' ? 'Sending…' : 'Send set-password link'}
              </Button>
              {resetStatus === 'sent' && <span className="text-xs text-green-600">✓ Sent to {form.email}</span>}
              {resetStatus?.error && <span className="text-xs text-red-600">{resetStatus.error}</span>}
            </div>
            <p className="text-xs text-gray-400">Emails {form.email} a link to set their own password — nobody but them ever sees it.</p>
          </div>
        ) : (
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">{user ? 'New Password' : 'Password'}</label>
            <input type="password" value={form.password || ''} onChange={e => set('password', e.target.value)}
              placeholder={user ? 'Leave blank to keep current' : 'Set login password'}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <p className="text-xs text-gray-400">
              {form.email ? 'Add an email above to send a set-password link instead.' : "No email on file, so a password must be set directly. Leave blank if this user doesn't need to log in."}
            </p>
          </div>
        )}

        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700">Calendar colour</label>
          <input type="color" value={form.color} onChange={e => set('color', e.target.value)}
            className="h-9 w-20 rounded border border-gray-300 p-1 cursor-pointer" />
        </div>
      </div>
      {duplicates.length > 0 && (
        <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
          <p className="font-medium">Possible duplicate{duplicates.length > 1 ? 's' : ''}:</p>
          {duplicates.map(d => <p key={d.id} className="text-xs mt-0.5">{d.first_name} {d.last_name} — {d.email || 'no email'} ({d.role})</p>)}
        </div>
      )}
      {error && <div className="mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>

      {created && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <h3 className="font-semibold text-gray-900">User created</h3>
            <p className="text-sm text-gray-600">{form.first_name} {form.last_name} has been added successfully.</p>
            {createdEmail?.sent && (
              <p className="text-sm text-green-600">✓ A set-password email was sent to {form.email}.</p>
            )}
            {createdEmail && !createdEmail.sent && (
              <p className="text-sm text-amber-600">The set-password email failed to send ({createdEmail.error}). You can retry from their user edit screen once created.</p>
            )}
            <Button onClick={onSaved} className="w-full justify-center">Close</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function Users() {
  const [users, setUsers] = useState([]);
  const [modal, setModal] = useState(null);
  const [activeFilter, setActiveFilter] = useState('1');
  const [roleFilter, setRoleFilter] = useState('');
  const [calendarUser, setCalendarUser] = useState(null);
  const [calUrlUser, setCalUrlUser] = useState(null);
  const [copied, setCopied] = useState(false);

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
                    <span className={`font-medium ${u.active ? 'text-gray-900' : 'text-gray-400'}`}><span className="font-mono text-xs text-purple-400 mr-1.5">USR-{String(u.id).padStart(5,'0')}</span>{u.first_name} {u.last_name}</span>
                    {!u.active && <span className="text-xs text-gray-400 font-medium">(inactive)</span>}
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
                    {u.cal_token && (
                      <Button variant="ghost" size="sm" title="Calendar subscription URL" onClick={() => { setCalUrlUser(u); setCopied(false); }}>
                        <Link2 className="h-3.5 w-3.5 text-green-500" />
                      </Button>
                    )}
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

      {calUrlUser && (
        <Modal title={`${calUrlUser.first_name} ${calUrlUser.last_name} — Calendar Subscription`} onClose={() => setCalUrlUser(null)}>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">Add this URL as a calendar subscription in Apple Calendar, Google Calendar, or Outlook to auto-sync appointments.</p>
            <div className="flex gap-2">
              <input readOnly value={`${window.location.origin}/api/cal/${calUrlUser.cal_token}.ics`}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm bg-gray-50 font-mono text-xs" />
              <Button size="sm" onClick={() => {
                navigator.clipboard.writeText(`${window.location.origin}/api/cal/${calUrlUser.cal_token}.ics`);
                setCopied(true); setTimeout(() => setCopied(false), 2000);
              }}>
                {copied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
            <div className="border-t border-gray-100 pt-3 flex items-center justify-between">
              <p className="text-xs text-gray-400">Regenerating the token will invalidate the current subscription.</p>
              <Button variant="ghost" size="sm" onClick={async () => {
                const { cal_token } = await api.post(`/practitioners/${calUrlUser.id}/reset-cal-token`).then(r => r.data);
                setCalUrlUser({ ...calUrlUser, cal_token });
                load();
              }}>
                Regenerate URL
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
