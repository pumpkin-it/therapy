import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, CheckCircle2, Clock, User } from 'lucide-react';
import api from '../lib/api';
import Button from '../components/ui/Button';
import TaskDetail from '../components/tasks/TaskDetail';
import NewTaskModal from '../components/tasks/NewTaskModal';
import { fmtDay, isOverdue } from '../lib/tasks';
import { fmtDateTime } from '../lib/utils';

const VIEWS = [['todo', 'To do'], ['waiting', 'Waiting'], ['done', 'Done']];
const WHO = [['', 'Everyone'], ['me', 'Mine'], ['unassigned', 'Unassigned']];

// The team's to-do list: work started by email (or added by hand) that needs doing (To do), is
// waiting on someone else until a follow-up date (Waiting), or is finished (Done).
export default function Tasks() {
  const [params, setParams] = useSearchParams();
  const view = VIEWS.some(v => v[0] === params.get('status')) ? params.get('status') : 'todo';
  const who = params.get('who') || '';
  const openId = Number(params.get('id')) || null;
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [list, setList] = useState({ rows: [], total: 0 });
  const [counts, setCounts] = useState(null);
  const [assignees, setAssignees] = useState([]);
  const [creating, setCreating] = useState(false);

  const setParam = useCallback(changes => setParams(p => {
    const next = new URLSearchParams(p);
    for (const [k, v] of Object.entries(changes)) { if (v == null || v === '') next.delete(k); else next.set(k, v); }
    return next;
  }, { replace: true }), [setParams]);

  useEffect(() => { api.get('/tasks/assignees').then(r => setAssignees(r.data)).catch(() => {}); }, []);
  useEffect(() => { const t = setTimeout(() => setQ(query.trim()), 300); return () => clearTimeout(t); }, [query]);
  const load = useCallback(() => {
    api.get('/tasks', { params: { status: view, assigned: who || undefined, q: q || undefined } }).then(r => setList(r.data)).catch(() => {});
    api.get('/tasks/counts').then(r => setCounts(r.data)).catch(() => {});
  }, [view, who, q]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="-m-6 flex h-screen flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-white px-6 py-3">
        <h1 className="text-xl font-semibold text-gray-900">Tasks</h1>
        <Button size="sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New task</Button>
        <div className="flex gap-1">
          {VIEWS.map(([v, label]) => (
            <button key={v} type="button" onClick={() => setParam({ status: v === 'todo' ? null : v, id: null })}
              className={`rounded-full px-3 py-1 text-sm ${view === v ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
              {label}{counts && v !== 'done' && <span className={`ml-1.5 ${view === v ? 'text-indigo-100' : 'text-gray-400'}`}>{counts[v]}</span>}
            </button>
          ))}
        </div>
        <select value={who} onChange={e => setParam({ who: e.target.value || null, id: null })} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-600">
          {WHO.map(([v, l]) => <option key={v} value={v}>{l}{v === 'me' && counts ? ` (${counts.todo_mine} to do)` : ''}</option>)}
          {assignees.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search tasks…"
            className="w-full rounded-lg border border-gray-300 py-2 pl-8 pr-3 text-sm focus:border-indigo-500 focus:outline-none" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-2/5 min-w-[260px] max-w-md shrink-0 overflow-y-auto border-r border-gray-200 bg-white">
          {list.rows.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-6 py-16 text-center text-sm text-gray-400">
              <CheckCircle2 className="h-8 w-8" /> {view === 'todo' ? 'Nothing to do.' : view === 'waiting' ? 'Nothing waiting.' : 'Nothing done yet.'}
            </div>
          )}
          <ul className="divide-y divide-gray-100">
            {list.rows.map(t => (
              <li key={t.id} onClick={() => setParam({ id: t.id })} className={`cursor-pointer px-3 py-2.5 ${t.id === openId ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}>
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">{t.title}</p>
                  {t.status === 'waiting' && t.follow_up_at && (
                    <span className={`flex shrink-0 items-center gap-1 text-xs ${isOverdue(t.follow_up_at) ? 'text-red-600' : 'text-gray-400'}`}><Clock className="h-3 w-3" />{fmtDay(t.follow_up_at)}</span>
                  )}
                </div>
                {t.next_step && <p className="truncate text-xs text-gray-600">Next: {t.next_step}</p>}
                <p className="truncate text-xs text-gray-400">{t.last_event} · {fmtDateTime(t.updated_at)}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {t.clients.map(c => <span key={c.id} className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-800">{c.name}</span>)}
                  {t.assigned_name && <span className="inline-flex items-center gap-0.5 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"><User className="h-3 w-3" />{t.assigned_name}</span>}
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto bg-white p-6">
          {openId ? <TaskDetail key={openId} taskId={openId} assignees={assignees} onChanged={load} />
            : <p className="py-16 text-center text-sm text-gray-400">{list.rows.length ? 'Choose a task.' : ''}</p>}
        </div>
      </div>
      {creating && <NewTaskModal assignees={assignees} onClose={() => setCreating(false)} onCreated={t => { setCreating(false); setParam({ status: t.status === 'todo' ? null : t.status, id: t.id }); load(); }} />}
    </div>
  );
}

