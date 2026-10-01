import { useCallback, useEffect, useState } from 'react';
import { Clock, Send, Pencil, X } from 'lucide-react';
import api from '../../lib/api';
import Button from '../ui/Button';
import { useConfirm } from '../ui/ConfirmDialog';
import { useCompose } from '../../context/ComposeContext';

const fmtWhen = d => new Date(d).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const plain = html => String(html || '').replace(/<(br|\/p|\/div|\/li)[^>]*>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim();

// Emails waiting to go out at a chosen time. Each can be sent now, edited (taken off the schedule
// and reopened), or cancelled.
export default function ScheduledList({ onCountChange }) {
  const confirm = useConfirm();
  const { openCompose } = useCompose();
  const [items, setItems] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => api.get('/email/outbox').then(r => {
    const list = r.data.filter(x => x.scheduled && x.status === 'pending');
    setItems(list);
    onCountChange?.(list.length);
  }).catch(() => setItems([])), [onCountChange]);
  useEffect(() => { load(); const t = setInterval(load, 30 * 1000); return () => clearInterval(t); }, [load]);

  const act = async (fn) => { setError(''); try { await fn(); } catch (e) { setError(e.response?.data?.error || 'Something went wrong'); } load(); };
  const sendNow = item => act(() => api.post(`/email/outbox/${item.id}/send-now`));
  const cancel = async item => {
    if (!await confirm({ title: 'Cancel scheduled email', message: `Cancel "${item.subject || '(no subject)'}"? It won't be sent.`, confirmLabel: 'Cancel email', danger: true })) return;
    act(() => api.post(`/email/outbox/${item.id}/cancel`));
  };
  // The original stays scheduled while it's edited; sending or rescheduling the edit replaces it.
  const editItem = item => openCompose({
    mode: item.payload.mode, sourceId: item.payload.source_id, fromOutbox: item.payload, replacesOutboxId: item.id, wasScheduledFor: item.send_at, onSent: load,
  });

  if (items === null) return <p className="p-6 text-sm text-gray-400">Loading…</p>;
  const open = items.find(x => x.id === openId);
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-2/5 min-w-[260px] max-w-md shrink-0 flex-col overflow-y-auto border-r border-gray-200 bg-white">
        {items.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center text-sm text-gray-400">
            <Clock className="h-8 w-8" /> Nothing scheduled. Use the arrow next to Send to send an email later.
          </div>
        )}
        <ul className="divide-y divide-gray-100">
          {items.map(x => (
            <li key={x.id} onClick={() => setOpenId(x.id)} className={`cursor-pointer px-3 py-2.5 ${x.id === openId ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}>
              <p className="flex items-center gap-1 text-xs font-medium text-indigo-700"><Clock className="h-3.5 w-3.5" /> {fmtWhen(x.send_at)}</p>
              <p className="truncate text-sm font-medium text-gray-900">{x.subject || '(no subject)'}</p>
              <p className="truncate text-xs text-gray-500">To: {x.to.map(t => t.name || t.address).join(', ')}</p>
              {x.clients.length > 0 && <p className="truncate text-xs text-gray-400">{x.clients.join(', ')}</p>}
            </li>
          ))}
        </ul>
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto bg-white p-6">
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        {open ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => sendNow(open)}><Send className="h-4 w-4" /> Send now</Button>
              <Button size="sm" variant="secondary" onClick={() => editItem(open)}><Pencil className="h-4 w-4" /> Edit or reschedule</Button>
              <Button size="sm" variant="ghost" onClick={() => cancel(open)}><X className="h-4 w-4" /> Cancel</Button>
            </div>
            <h2 className="text-lg font-semibold text-gray-900">{open.subject || '(no subject)'}</h2>
            <div className="space-y-0.5 text-sm text-gray-600">
              <p><span className="text-gray-400">Sends:</span> {fmtWhen(open.send_at)}</p>
              <p><span className="text-gray-400">To:</span> {open.to.map(t => t.name ? `${t.name} <${t.address}>` : t.address).join(', ')}</p>
              {open.payload?.cc?.length > 0 && <p><span className="text-gray-400">Cc:</span> {open.payload.cc.map(t => t.address).join(', ')}</p>}
              {open.clients.length > 0 && <p><span className="text-gray-400">Filed to:</span> {open.clients.join(', ')}</p>}
              {open.payload?.uploads?.length > 0 && <p><span className="text-gray-400">Attachments:</span> {open.payload.uploads.map(u => u.filename).join(', ')}</p>}
              <p className="text-gray-400">Scheduled by {open.created_by_name || 'someone'}</p>
            </div>
            <pre className="whitespace-pre-wrap border-t border-gray-100 pt-3 font-sans text-sm text-gray-800">{plain(open.payload?.html) || '(no text)'}</pre>
          </div>
        ) : (
          items.length > 0 && <p className="py-16 text-center text-sm text-gray-400">Choose a scheduled email.</p>
        )}
      </div>
    </div>
  );
}
