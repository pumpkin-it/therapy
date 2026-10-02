import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, Plus } from 'lucide-react';
import api from '../lib/api';
import { fmtDateTime } from '../lib/utils';

// Ask conversations filed to this client — by anyone with Ask access — newest first. Opening one
// shows the full questions and answers on the Ask page.
export default function ClientAskConversations({ clientId }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.get(`/ask/client/${clientId}`).then(r => setRows(r.data)).catch(() => setRows([])); }, [clientId]);

  return (
    <div className="rounded-lg border border-gray-200">
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        <p className="flex items-center gap-1.5 text-sm font-medium text-gray-800"><Sparkles className="h-4 w-4 text-indigo-500" /> Ask conversations {rows?.length > 0 && <span className="text-gray-400">({rows.length})</span>}</p>
        <Link to={`/ask?client=${clientId}`} className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800"><Plus className="h-4 w-4" /> Ask a question</Link>
      </div>
      {rows === null ? <p className="px-3 py-3 text-sm text-gray-400">Loading…</p>
        : rows.length === 0 ? <p className="px-3 py-3 text-sm text-gray-400">No questions asked about this client yet.</p> : (
          <ul className="divide-y divide-gray-100">
            {rows.map(c => (
              <li key={c.id}>
                <Link to={`/ask?id=${c.id}`} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50">
                  <span className="min-w-0 flex-1 truncate text-gray-800">{c.title}{c.questions > 1 && <span className="text-gray-400"> · {c.questions} questions</span>}</span>
                  <span className="shrink-0 text-xs text-gray-400">{c.mine ? 'You' : c.asked_by} · {fmtDateTime(c.updated_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
