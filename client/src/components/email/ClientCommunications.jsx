import { useEffect, useState } from 'react';
import { Search, Paperclip, ArrowUpRight, ArrowDownLeft, Mail, PenSquare, X } from 'lucide-react';
import { useCompose } from '../../context/ComposeContext';
import ClientTasks from '../tasks/ClientTasks';
import api from '../../lib/api';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import EmailViewer from './EmailViewer';
import { fmtDateTime } from '../../lib/utils';
import { refreshEmailCounts } from '../../lib/useUnfiledEmailCount';
import { senderLabel, recipientsLabel, tagPillClass } from '../../lib/email';
import { Highlight, searchTerms } from '../../lib/highlight';

// Every email filed against this client, newest first. Opening one shows it in full, where its
// filing can be changed.
export default function ClientCommunications({ clientId, defaultTo = [] }) {
  const { openCompose } = useCompose();
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [list, setList] = useState({ rows: [], total: 0, page: 1 });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [clients, setClients] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [notice, setNotice] = useState(null); // { text, undoId } after an email is taken off this client
  const terms = searchTerms(q);

  useEffect(() => {
    api.get('/clients?active=all').then(r => setClients(r.data)).catch(() => {});
    api.get('/email/tags').then(r => setAllTags(r.data)).catch(() => {});
  }, []);
  useEffect(() => { const t = setTimeout(() => setQ(query.trim()), 300); return () => clearTimeout(t); }, [query]);

  const load = async (page = 1) => {
    setLoading(true);
    try {
      const r = await api.get(`/email/client/${clientId}`, { params: { q: q || undefined, page } });
      setList(l => (page === 1 ? r.data : { ...r.data, rows: [...l.rows, ...r.data.rows] }));
    } finally { setLoading(false); }
  };
  useEffect(() => { load(1); }, [clientId, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const openMessage = id => api.get(`/email/messages/${id}`).then(r => setMessage(r.data));
  const undoFiling = async () => {
    try { await api.post(`/email/undo/${notice.undoId}`); setNotice({ text: 'Filing undone.' }); load(1); refreshEmailCounts(); }
    catch (e) { setNotice({ text: e.response?.data?.error || 'Could not undo the filing.' }); }
  };

  return (
    <div className="space-y-3">
      <ClientTasks clientId={clientId} />
      <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" onClick={() => openCompose({ mode: 'new', clientIds: [Number(clientId)], to: defaultTo, onSent: () => load(1) })}><PenSquare className="h-4 w-4" /> New email</Button>
      <div className="relative w-full max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search this client's emails…"
          className="w-full rounded-lg border border-gray-300 py-2 pl-8 pr-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
      </div>
      </div>

      {notice && (
        <div className="flex items-center gap-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          <p className="min-w-0 flex-1">{notice.text}</p>
          {notice.undoId && <button type="button" onClick={undoFiling} className="shrink-0 font-medium text-green-900 underline hover:text-green-700">Undo</button>}
          <button type="button" onClick={() => setNotice(null)} title="Dismiss" className="shrink-0 text-green-700 hover:text-green-900"><X className="h-4 w-4" /></button>
        </div>
      )}

      {!loading && list.rows.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-gray-400">
          <Mail className="h-8 w-8" />
          {q ? 'No emails match that search.' : 'No emails filed against this client yet.'}
        </div>
      )}

      {list.rows.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {list.rows.map(m => (
            <li key={m.id}>
              <button type="button" onClick={() => openMessage(m.id)} className="flex w-full gap-3 px-3 py-2.5 text-left hover:bg-gray-50">
                {m.direction === 'out'
                  ? <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
                  : <ArrowDownLeft className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-gray-900">{m.direction === 'out' ? `To: ${recipientsLabel(m)}` : senderLabel(m)}</span>
                    {!!m.has_attachments && <Paperclip className="h-3.5 w-3.5 shrink-0 text-gray-400" />}
                    <span className="ml-auto shrink-0 text-xs text-gray-400">{fmtDateTime(m.received_at)}</span>
                  </div>
                  <p className="truncate text-sm text-gray-700">{m.subject ? <Highlight text={m.subject} terms={terms} /> : '(no subject)'}</p>
                  <p className="truncate text-xs text-gray-400"><Highlight text={m.snippet} terms={terms} /></p>
                  {m.tags?.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">{m.tags.map(t => <span key={t.id} className={`rounded-full px-2 py-0.5 text-xs ${tagPillClass(t.color)}`}>{t.name}</span>)}</div>
                  )}
                  {m.clients.length > 1 && (
                    <p className="mt-0.5 text-xs text-gray-400">Also filed to {m.clients.filter(c => String(c.id) !== String(clientId)).map(c => c.name).join(', ')}</p>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {list.rows.length < list.total && (
        <div className="text-center"><Button size="sm" variant="secondary" onClick={() => load(list.page + 1)} disabled={loading}>Load more</Button></div>
      )}

      {message && (
        <Modal title="Email" size="xl" onClose={() => setMessage(null)}>
          <EmailViewer message={message} clients={clients} allTags={allTags} onTagCreated={t => setAllTags(ts => [...ts, t])} onOpen={openMessage} onSent={() => load(1)} terms={terms}
            onChanged={updated => {
              const stillHere = updated.clients.some(c => String(c.id) === String(clientId));
              if (stillHere) setMessage(updated);
              else {
                setMessage(null);
                const where = updated.status === 'filed' ? `now filed to ${updated.clients.map(c => c.name).join(', ')}` : updated.status === 'not_client' ? 'filed as No client' : 'moved back to Unfiled';
                setNotice({ text: `"${updated.subject || '(no subject)'}" was taken off this client (${where}).`, undoId: updated.undo_id });
              }
              load(1);
            }} />
        </Modal>
      )}
    </div>
  );
}
