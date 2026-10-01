import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Undo2, CheckCircle2, AlertTriangle, X } from 'lucide-react';
import api from '../lib/api';
import ComposeModal from '../components/email/ComposeModal';

// Writing email from anywhere in the app: openCompose({ mode, source, clientIds, to }) opens the
// compose window. After Send, an Undo bar counts down while the email waits in the outbox; emails
// that couldn't be sent stay listed here until retried or discarded.
const ComposeContext = createContext({ openCompose: () => {}, enabled: false });
export const useCompose = () => useContext(ComposeContext);

export function ComposeProvider({ enabled, children }) {
  const [compose, setCompose] = useState(null);   // options for the open compose window
  const [pending, setPending] = useState([]);     // [{ id, sendAt, subject, state, restore, onSent }]
  const [failed, setFailed] = useState([]);       // from the server outbox
  const [now, setNow] = useState(Date.now());
  const [toast, setToast] = useState(null);
  const tracked = useRef(new Map());              // outbox id → { restore, onSent }

  const openCompose = useCallback(opts => setCompose({ key: Date.now(), ...opts }), []);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const rows = (await api.get('/email/outbox')).data;
      setFailed(rows.filter(r => r.status === 'failed'));
      setPending(list => list.map(p => {
        const row = rows.find(r => r.id === p.id);
        if (!row || row.status === 'sent') {
          if (p.state !== 'sent') tracked.current.get(p.id)?.onSent?.(row?.sent_message_id);
          return { ...p, state: 'sent' };
        }
        return { ...p, state: row.status === 'failed' ? 'failed' : p.state };
      }).filter(p => p.state !== 'failed'));
    } catch { /* offline for a moment — try again on the next tick */ }
  }, [enabled]);

  useEffect(() => { refresh(); const t = setInterval(refresh, 60 * 1000); return () => clearInterval(t); }, [refresh]);

  // While something is waiting or sending: tick the countdown and check the outbox often.
  const active = pending.some(p => p.state !== 'sent');
  useEffect(() => {
    if (!active) return undefined;
    const tick = setInterval(() => setNow(Date.now()), 500);
    const poll = setInterval(refresh, 2500);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [active, refresh]);

  // "Sent" confirmations fade after a few seconds.
  useEffect(() => {
    if (!pending.some(p => p.state === 'sent')) return undefined;
    const t = setTimeout(() => setPending(list => list.filter(p => p.state !== 'sent')), 4000);
    return () => clearTimeout(t);
  }, [pending]);

  const onQueued = ({ id, send_at, scheduled }, { subject, restore, onSent }) => {
    setCompose(null);
    if (scheduled) {
      setToast(`Scheduled for ${new Date(send_at).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}: ${subject || '(no subject)'} — see Email → Scheduled`);
      setTimeout(() => setToast(null), 6000);
      onSent?.();
      return;
    }
    tracked.current.set(id, { restore, onSent });
    setNow(Date.now());
    setPending(list => [...list, { id, sendAt: new Date(send_at).getTime(), subject, state: 'waiting' }]);
  };

  const undo = async p => {
    try {
      await api.post(`/email/outbox/${p.id}/cancel`);
      setPending(list => list.filter(x => x.id !== p.id));
      const t = tracked.current.get(p.id);
      if (t?.restore) setCompose({ key: Date.now(), ...t.restore, restoredFromUndo: true });
    } catch (e) {
      setPending(list => list.map(x => (x.id === p.id ? { ...x, note: e.response?.data?.error || 'Too late to undo' } : x)));
    }
  };

  const retry = async f => { await api.post(`/email/outbox/${f.id}/retry`).catch(() => {}); setPending(l => [...l, { id: f.id, sendAt: Date.now(), subject: f.subject, state: 'waiting' }]); refresh(); };
  const discard = async f => { await api.post(`/email/outbox/${f.id}/discard`).catch(() => {}); refresh(); };
  const openFailed = f => setCompose({ key: Date.now(), fromOutbox: f.payload, mode: f.payload.mode, sourceId: f.payload.source_id });

  return (
    <ComposeContext.Provider value={{ openCompose, enabled }}>
      {children}
      {enabled && compose && <ComposeModal key={compose.key} options={compose} onClose={() => setCompose(null)} onQueued={onQueued} />}
      {enabled && (pending.length > 0 || failed.length > 0 || toast) && (
        <div className="fixed bottom-4 left-1/2 z-[60] w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 space-y-2">
          {toast && <div className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm text-white shadow-lg"><CheckCircle2 className="h-4 w-4 text-green-400" /><span className="flex-1">{toast}</span></div>}
          {pending.map(p => {
            const secs = Math.max(0, Math.ceil((p.sendAt - now) / 1000));
            return (
              <div key={p.id} className="flex items-center gap-3 rounded-lg bg-gray-900 px-4 py-2.5 text-sm text-white shadow-lg">
                {p.state === 'sent'
                  ? <><CheckCircle2 className="h-4 w-4 text-green-400" /><span className="flex-1 truncate">Sent: {p.subject || '(no subject)'}</span></>
                  : (
                    <>
                      <span className="flex-1 truncate">
                        {secs > 0 ? `Sending in ${secs}s` : 'Sending…'}: {p.subject || '(no subject)'}{p.note && <span className="ml-2 text-amber-300">{p.note}</span>}
                      </span>
                      {secs > 0 && !p.note && (
                        <button type="button" onClick={() => undo(p)} className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2.5 py-1 font-medium hover:bg-white/20">
                          <Undo2 className="h-4 w-4" /> Undo
                        </button>
                      )}
                    </>
                  )}
              </div>
            );
          })}
          {failed.map(f => (
            <div key={f.id} className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800 shadow-lg">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Couldn't send: {f.subject || '(no subject)'}</p>
                  <p className="text-xs">{f.error}</p>
                  <div className="mt-1.5 flex gap-3 text-xs font-medium">
                    <button type="button" onClick={() => openFailed(f)} className="underline">Open</button>
                    <button type="button" onClick={() => retry(f)} className="underline">Try again</button>
                    <button type="button" onClick={() => discard(f)} className="underline">Discard</button>
                  </div>
                </div>
                <button type="button" onClick={() => setFailed(l => l.filter(x => x.id !== f.id))} className="text-red-400 hover:text-red-600" title="Hide"><X className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </ComposeContext.Provider>
  );
}
