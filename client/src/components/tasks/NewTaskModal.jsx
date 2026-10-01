import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import api from '../../lib/api';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { addWorkingDays } from '../../lib/tasks';

// A task created by hand (e.g. "Call Katie's mum about the trial"), or for an email (messageId).
export default function NewTaskModal({ clientIds = [], messageId = null, defaultTitle = '', assignees, onClose, onCreated }) {
  const [title, setTitle] = useState(defaultTitle);
  const [nextStep, setNextStep] = useState('');
  const [status, setStatus] = useState('todo');
  const [followUp, setFollowUp] = useState(addWorkingDays());
  const [assignedTo, setAssignedTo] = useState('');
  const [chosen, setChosen] = useState(clientIds);
  const [clients, setClients] = useState([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.get('/clients?active=all').then(r => setClients(r.data)).catch(() => {}); }, []);
  const name = id => { const c = clients.find(x => x.id === id); return c ? `${c.first_name} ${c.last_name}` : `Client ${id}`; };
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? clients.filter(c => `${c.first_name} ${c.last_name}`.toLowerCase().includes(q) && !chosen.includes(c.id)).slice(0, 6) : [];
  }, [query, clients, chosen]);

  const create = async () => {
    if (!title.trim()) { setError('Give the task a title'); return; }
    setSaving(true); setError('');
    try {
      const r = await api.post('/tasks', { title, next_step: nextStep, status, follow_up_at: status === 'waiting' ? followUp : undefined,
        assigned_to: assignedTo ? Number(assignedTo) : null, client_ids: chosen, message_id: messageId || undefined });
      onCreated(r.data);
    } catch (e) { setError(e.response?.data?.error || 'Could not create the task'); setSaving(false); }
  };

  return (
    <Modal title="New task" onClose={onClose}>
      <div className="space-y-3">
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700">What needs doing</label>
          <input autoFocus value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') create(); }}
            placeholder="e.g. Call Katie's mum about the trial"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        </div>
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700">Next step <span className="font-normal text-gray-400">(optional)</span></label>
          <input value={nextStep} onChange={e => setNextStep(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
        </div>
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700">Clients</label>
          <div className="flex flex-wrap items-center gap-1.5">
            {chosen.map(id => (
              <span key={id} className="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs text-white">
                {name(id)}<button type="button" onClick={() => setChosen(c => c.filter(x => x !== id))}><X className="h-3 w-3" /></button>
              </span>
            ))}
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1.5 h-3.5 w-3.5 text-gray-400" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Add a client…"
                className="w-44 rounded-full border border-gray-300 py-1 pl-7 pr-2 text-xs focus:border-indigo-500 focus:outline-none" />
              {matches.length > 0 && (
                <ul className="absolute z-20 mt-1 w-56 rounded-lg border border-gray-200 bg-white shadow-lg">
                  {matches.map(c => <li key={c.id}><button type="button" onClick={() => { setChosen(x => [...x, c.id]); setQuery(''); }}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-indigo-50">{c.first_name} {c.last_name}</button></li>)}
                </ul>
              )}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Status</label>
            <select value={status} onChange={e => setStatus(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm">
              <option value="todo">To do</option>
              <option value="waiting">Waiting (follow up later)</option>
            </select>
          </div>
          {status === 'waiting' ? (
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Follow up on</label>
              <input type="date" value={followUp} onChange={e => setFollowUp(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
            </div>
          ) : <span />}
          <div className="col-span-2 space-y-1">
            <label className="block text-sm font-medium text-gray-700">Assign to</label>
            <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm">
              <option value="">Unassigned</option>
              {assignees.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={create} disabled={saving}>{saving ? 'Creating…' : 'Create task'}</Button>
        </div>
      </div>
    </Modal>
  );
}
