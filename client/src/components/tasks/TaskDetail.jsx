import { useEffect, useMemo, useState } from 'react';
import { Mail, ArrowUpRight, ArrowDownLeft, X, Search, Reply, MessageSquarePlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import Button from '../ui/Button';
import { useCompose } from '../../context/ComposeContext';
import { fmtDateTime } from '../../lib/utils';
import { TASK_STATUSES, STATUS_PILL, addWorkingDays, fmtDay } from '../../lib/tasks';

// One task: what it's about, its status (to do / waiting until a date / done), who has it, its
// clients and emails, and everything that has happened to it.
export default function TaskDetail({ taskId, assignees, onChanged }) {
  const { openCompose } = useCompose();
  const [task, setTask] = useState(null);
  const [title, setTitle] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [note, setNote] = useState('');
  const [clients, setClients] = useState([]);
  const [clientQuery, setClientQuery] = useState('');
  const [error, setError] = useState('');

  const show = t => { setTask(t); setTitle(t.title); setNextStep(t.next_step || ''); };
  useEffect(() => { setTask(null); api.get(`/tasks/${taskId}`).then(r => show(r.data)).catch(() => setError('Task not found')); }, [taskId]);
  useEffect(() => { api.get('/clients?active=all').then(r => setClients(r.data)).catch(() => {}); }, []);

  const save = async (patch) => {
    setError('');
    try { const r = await api.patch(`/tasks/${taskId}`, patch); show(r.data); onChanged?.(r.data); }
    catch (e) { setError(e.response?.data?.error || 'Could not save'); }
  };
  const call = async (method, url, body) => {
    setError('');
    try { const r = await api[method](url, body); show(r.data); onChanged?.(r.data); return true; }
    catch (e) { setError(e.response?.data?.error || 'Could not save'); return false; }
  };

  const clientMatches = useMemo(() => {
    const q = clientQuery.trim().toLowerCase();
    if (!q || !task) return [];
    return clients.filter(c => `${c.first_name} ${c.last_name}`.toLowerCase().includes(q) && !task.clients.some(x => x.id === c.id)).slice(0, 6);
  }, [clientQuery, clients, task]);

  if (error && !task) return <p className="text-sm text-red-600">{error}</p>;
  if (!task) return <p className="text-sm text-gray-400">Loading…</p>;
  const lastIn = [...task.emails].reverse().find(e => e.direction === 'in');

  return (
    <div className="space-y-4">
      <input value={title} onChange={e => setTitle(e.target.value)} onBlur={() => title.trim() && title !== task.title && save({ title })}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        className="w-full rounded-md border border-transparent px-1 text-lg font-semibold text-gray-900 hover:border-gray-200 focus:border-indigo-400 focus:outline-none" />

      <div className="flex flex-wrap items-center gap-2">
        {TASK_STATUSES.map(([s, label]) => (
          <button key={s} type="button" onClick={() => task.status !== s && save({ status: s, ...(s === 'waiting' ? { follow_up_at: task.follow_up_at || addWorkingDays() } : {}) })}
            className={`rounded-full px-3 py-1 text-sm font-medium ${task.status === s ? STATUS_PILL[s] : 'bg-white text-gray-500 ring-1 ring-gray-200 hover:bg-gray-50'}`}>
            {label}
          </button>
        ))}
        {task.status === 'waiting' && (
          <label className="flex items-center gap-1.5 text-sm text-gray-600">
            follow up
            <input type="date" value={task.follow_up_at || ''} onChange={e => e.target.value && save({ follow_up_at: e.target.value })}
              className="rounded border border-gray-300 px-2 py-0.5 text-sm" />
          </label>
        )}
        <select value={task.assigned_to || ''} onChange={e => save({ assigned_to: e.target.value ? Number(e.target.value) : null })}
          className="ml-auto rounded-lg border border-gray-300 px-2 py-1 text-sm text-gray-700">
          <option value="">Unassigned</option>
          {assignees.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-500">Next step</label>
        <input value={nextStep} onChange={e => setNextStep(e.target.value)} onBlur={() => nextStep !== (task.next_step || '') && save({ next_step: nextStep })}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          placeholder="e.g. Add client details, answer about service types"
          className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none" />
      </div>

      <div>
        <p className="mb-1 text-xs font-medium text-gray-500">Clients</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {task.clients.map(c => (
            <span key={c.id} className="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs text-white">
              <Link to={`/clients/${c.id}`} className="hover:underline">{c.name}</Link>
              <button type="button" onClick={() => call('delete', `/tasks/${taskId}/clients/${c.id}`)}><X className="h-3 w-3" /></button>
            </span>
          ))}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1.5 h-3.5 w-3.5 text-gray-400" />
            <input value={clientQuery} onChange={e => setClientQuery(e.target.value)} placeholder="Add a client…"
              className="w-40 rounded-full border border-gray-300 py-1 pl-7 pr-2 text-xs focus:border-indigo-500 focus:outline-none" />
            {clientMatches.length > 0 && (
              <ul className="absolute z-20 mt-1 w-56 rounded-lg border border-gray-200 bg-white shadow-lg">
                {clientMatches.map(c => (
                  <li key={c.id}><button type="button" onClick={async () => { if (await call('post', `/tasks/${taskId}/clients`, { client_id: c.id })) setClientQuery(''); }}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-indigo-50">{c.first_name} {c.last_name}</button></li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {task.emails.length > 0 && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs font-medium text-gray-500">Emails</p>
            {lastIn && (
              <button type="button" onClick={() => openCompose({ mode: 'reply', sourceId: lastIn.id, onSent: () => api.get(`/tasks/${taskId}`).then(r => show(r.data)) })}
                className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline"><Reply className="h-3.5 w-3.5" /> Reply to the latest</button>
            )}
          </div>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {task.emails.map(e => (
              <li key={e.id}>
                <Link to={`/email?view=all&id=${e.id}`} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50">
                  {e.direction === 'out' ? <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-indigo-500" /> : <ArrowDownLeft className="h-3.5 w-3.5 shrink-0 text-green-600" />}
                  <span className="truncate text-gray-800">{e.from_name || e.from_address}</span>
                  <span className="truncate text-gray-500">{e.snippet}</span>
                  <span className="ml-auto shrink-0 text-xs text-gray-400">{fmtDateTime(e.received_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="mb-1 text-xs font-medium text-gray-500">History</p>
        <div className="mb-2 flex gap-2">
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note (e.g. left a voicemail)…"
            onKeyDown={async e => { if (e.key === 'Enter' && note.trim()) { if (await call('post', `/tasks/${taskId}/notes`, { text: note })) setNote(''); } }}
            className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none" />
          <Button size="sm" variant="secondary" disabled={!note.trim()} onClick={async () => { if (await call('post', `/tasks/${taskId}/notes`, { text: note })) setNote(''); }}>
            <MessageSquarePlus className="h-4 w-4" /> Add
          </Button>
        </div>
        <ul className="space-y-1.5">
          {task.events.map(ev => (
            <li key={ev.id} className="flex gap-2 text-sm">
              {ev.message_id ? <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" /> : <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-300" />}
              <div className="min-w-0">
                <p className={ev.kind === 'note' ? 'text-gray-900' : 'text-gray-700'}>{ev.detail}</p>
                <p className="text-xs text-gray-400">{fmtDateTime(ev.created_at)} · {ev.actor_name || 'automatic'}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {task.status === 'waiting' && task.follow_up_at && <p className="text-xs text-gray-400">Comes back to To do on {fmtDay(task.follow_up_at)} if nothing arrives.</p>}
    </div>
  );
}
