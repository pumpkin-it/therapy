import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Clock } from 'lucide-react';
import api from '../../lib/api';
import NewTaskModal from './NewTaskModal';
import { STATUS_PILL, statusLabel, fmtDay, isOverdue } from '../../lib/tasks';

// This client's open tasks (to do and waiting), with a way to add one.
export default function ClientTasks({ clientId }) {
  const [rows, setRows] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [creating, setCreating] = useState(false);
  const load = useCallback(async () => {
    const [todo, waiting] = await Promise.all(['todo', 'waiting'].map(status => api.get('/tasks', { params: { status, client_id: clientId } }).then(r => r.data.rows).catch(() => [])));
    setRows([...todo, ...waiting]);
  }, [clientId]);
  useEffect(() => { load(); api.get('/tasks/assignees').then(r => setAssignees(r.data)).catch(() => {}); }, [load]);

  return (
    <div className="rounded-lg border border-gray-200">
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        <p className="text-sm font-medium text-gray-800">Open tasks {rows.length > 0 && <span className="text-gray-400">({rows.length})</span>}</p>
        <button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800"><Plus className="h-4 w-4" /> New task</button>
      </div>
      {rows.length === 0 ? <p className="px-3 py-3 text-sm text-gray-400">Nothing open for this client.</p> : (
        <ul className="divide-y divide-gray-100">
          {rows.map(t => (
            <li key={t.id}>
              <Link to={`/tasks?status=${t.status}&id=${t.id}`} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50">
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_PILL[t.status]}`}>{statusLabel(t.status)}</span>
                <span className="min-w-0 flex-1 truncate text-gray-800">{t.title}{t.next_step && <span className="text-gray-500"> · Next: {t.next_step}</span>}</span>
                {t.status === 'waiting' && t.follow_up_at && <span className={`flex shrink-0 items-center gap-1 text-xs ${isOverdue(t.follow_up_at) ? 'text-red-600' : 'text-gray-400'}`}><Clock className="h-3 w-3" />{fmtDay(t.follow_up_at)}</span>}
                {t.assigned_name && <span className="shrink-0 text-xs text-gray-400">{t.assigned_name}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {creating && <NewTaskModal clientIds={[Number(clientId)]} assignees={assignees} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} />}
    </div>
  );
}
