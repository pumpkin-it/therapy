import { useState } from 'react';
import { Plus, Pencil, Trash2, Mail, Phone } from 'lucide-react';
import api from '../lib/api';
import Button from './ui/Button';
import Badge from './ui/Badge';
import Input from './ui/Input';
import Modal from './ui/Modal';
import { useConfirm } from './ui/ConfirmDialog';
import { CONTACT_ROLES, roleLabel, roleColor } from '../lib/clientContacts';

const EMPTY = { role: 'family', name: '', relationship: '', organisation: '', email: '', phone: '', notes: '', is_primary: false, is_emergency: false };

// People attached to a client: parents, carers, support coordinators, school, health professionals.
// With a clientId every change is saved straight away; without one (a client not yet created) the
// list is kept in the page and sent along with the new client.
export default function ClientContacts({ clientId, contacts, onChange }) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState(null); // contact being edited, or EMPTY for a new one
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const open = c => {
    setError('');
    setEditing(c ? { ...EMPTY, ...Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v ?? ''])), is_primary: !!c.is_primary, is_emergency: !!c.is_emergency } : { ...EMPTY });
  };
  const set = (k, v) => setEditing(e => ({ ...e, [k]: v }));

  // Only one primary contact: marking one clears the rest (the server does the same).
  const withSinglePrimary = (list, keep) => keep.is_primary ? list.map(c => (c === keep ? c : { ...c, is_primary: 0 })) : list;

  const save = async () => {
    if (!editing.name.trim()) { setError('Name is required'); return; }
    // Same rule as server/services/clientContacts.js — checked here too, since a contact on a client
    // not yet created is only sent (and rejected) when the client is created.
    const email = (editing.email || '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError(`"${email}" is not a valid email address`); return; }
    setSaving(true); setError('');
    try {
      if (clientId) {
        const res = editing.id
          ? await api.patch(`/clients/${clientId}/contacts/${editing.id}`, editing)
          : await api.post(`/clients/${clientId}/contacts`, editing);
        onChange(res.data);
      } else {
        const entry = { ...editing, key: editing.key || `new-${Date.now()}` };
        const list = editing.key ? contacts.map(c => (c.key === editing.key ? entry : c)) : [...contacts, entry];
        onChange(withSinglePrimary(list, entry));
      }
      setEditing(null);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not save the contact');
    } finally { setSaving(false); }
  };

  const remove = async c => {
    if (!await confirm({ title: 'Remove contact', message: `Remove ${c.name} from this client's contacts?`, confirmLabel: 'Remove', danger: true })) return;
    if (clientId) onChange((await api.delete(`/clients/${clientId}/contacts/${c.id}`)).data);
    else onChange(contacts.filter(x => x.key !== c.key));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium text-gray-700">Contacts</p>
        <button type="button" onClick={() => open(null)} className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800">
          <Plus className="h-4 w-4" /> Add contact
        </button>
      </div>

      {contacts.length === 0 ? (
        <p className="text-sm text-gray-400 rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center">
          No contacts yet — add parents, carers, support coordinators, school or health professionals.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {contacts.map(c => (
            <li key={c.id || c.key} className="flex items-start gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium text-gray-900">{c.name}</span>
                  {c.relationship && <span className="text-sm text-gray-500">{c.relationship}</span>}
                  <Badge color={roleColor(c.role)}>{roleLabel(c.role)}</Badge>
                  {!!c.is_primary && <Badge color="green">Primary</Badge>}
                  {!!c.is_emergency && <Badge color="red">Emergency</Badge>}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-gray-600">
                  {c.organisation && <span>{c.organisation}</span>}
                  {c.email && <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 hover:text-indigo-600"><Mail className="h-3.5 w-3.5" />{c.email}</a>}
                  {c.phone && <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 hover:text-indigo-600"><Phone className="h-3.5 w-3.5" />{c.phone}</a>}
                </div>
                {c.notes && <p className="mt-0.5 text-xs text-gray-500 whitespace-pre-line">{c.notes}</p>}
              </div>
              <div className="flex shrink-0 gap-1">
                <button type="button" onClick={() => open(c)} className="p-1 text-gray-400 hover:text-indigo-600" title="Edit contact"><Pencil className="h-4 w-4" /></button>
                <button type="button" onClick={() => remove(c)} className="p-1 text-gray-400 hover:text-red-600" title="Remove contact"><Trash2 className="h-4 w-4" /></button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <Modal title={editing.id || editing.key ? 'Edit contact' : 'Add contact'} onClose={() => setEditing(null)}>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Role</label>
                <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  value={editing.role} onChange={e => set('role', e.target.value)}>
                  {CONTACT_ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <Input label="Name" value={editing.name} onChange={e => set('name', e.target.value)} autoFocus />
              <Input label="Relationship / title" value={editing.relationship} onChange={e => set('relationship', e.target.value)} placeholder="e.g. Mother, Year 3 teacher" />
              <Input label="Organisation" value={editing.organisation} onChange={e => set('organisation', e.target.value)} />
              <Input label="Email" type="email" value={editing.email} onChange={e => set('email', e.target.value)} />
              <Input label="Phone" value={editing.phone} onChange={e => set('phone', e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Notes</label>
              <textarea rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none focus:border-indigo-500 focus:outline-none"
                value={editing.notes} onChange={e => set('notes', e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" className="accent-indigo-600" checked={editing.is_primary} onChange={e => set('is_primary', e.target.checked)} />
                Primary contact <span className="text-gray-400">(main person we correspond with)</span>
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" className="accent-indigo-600" checked={editing.is_emergency} onChange={e => set('is_emergency', e.target.checked)} />
                Emergency contact
              </label>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save contact'}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
