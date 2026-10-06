import { useEffect, useMemo, useRef, useState } from 'react';
import { Paperclip, X, Send, Search, Trash2, PenLine, ChevronDown, ChevronRight, Clock } from 'lucide-react';
import api from '../../lib/api';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import DocEditor from '../reportEditor/DocEditor';
import RecipientInput, { EMAIL_RE } from './RecipientInput';
import { preTicked, tagChipClass, fmtBytes, personLabel, INACTIVE_SUFFIX } from '../../lib/email';
import { fmtDateTime } from '../../lib/utils';
import { addWorkingDays } from '../../lib/tasks';

const TITLES = { new: 'New email', reply: 'Reply', replyAll: 'Reply all', forward: 'Forward' };
const draftKey = (mode, sourceId, clientIds) => `therapy-email-draft:${mode}:${sourceId || (clientIds?.length ? `c${clientIds.join('-')}` : 'new')}`;
const storage = {
  get: k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  remove: k => { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};
const isBlankHtml = h => !String(h || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, '').trim();

// Quick choices for "Schedule send", in this computer's local time.
function schedulePresets(now = new Date()) {
  const at = (days, hour) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d; };
  const daysToMonday = ((8 - now.getDay()) % 7) || 7;
  return [
    ['Tomorrow morning', at(1, 8)],
    ['Tomorrow afternoon', at(1, 13)],
    ['Monday morning', at(daysToMonday, 8)],
  ];
}
export const fmtWhen = d => new Date(d).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const toLocalInput = d => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

// Who a reply goes to: the sender (or Reply-To) of an incoming email, the recipients of one we sent.
function replyRecipients(source, mode, mailbox) {
  const own = (mailbox || '').toLowerCase();
  const strip = list => (list || []).filter(r => r.address && r.address.toLowerCase() !== own);
  const to = source.direction === 'out' ? strip(source.to)
    : strip(source.reply_to?.length ? source.reply_to : [{ name: source.from_name, address: source.from_address }]);
  if (mode !== 'replyAll') return { to, cc: [] };
  const seen = new Set(to.map(r => r.address.toLowerCase()));
  const cc = strip([...(source.direction === 'out' ? [] : source.to || []), ...(source.cc || [])]).filter(r => !seen.has(r.address.toLowerCase()) && seen.add(r.address.toLowerCase()));
  return { to, cc };
}
const prefixed = (prefix, subject) => (new RegExp(`^${prefix}:`, 'i').test(subject || '') ? subject : `${prefix}: ${subject || ''}`.trim());

// Writing an email: recipients, subject, text (with the writer's signature), attachments, and which
// clients/tags it's filed to once sent. Unsent work is kept in this browser and offered back next time.
export default function ComposeModal({ options, onClose, onQueued }) {
  const [source, setSource] = useState(options.source || null);
  const mode = options.mode || 'new';
  const sourceId = options.source?.id || options.sourceId || null;
  const [state, setState] = useState(null);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [mailbox, setMailbox] = useState(undefined);
  const [fromMailbox, setFromMailbox] = useState('');
  const [clients, setClients] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [showCc, setShowCc] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [clientQuery, setClientQuery] = useState('');
  const [editingSignature, setEditingSignature] = useState(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [customWhen, setCustomWhen] = useState('');
  const fileRef = useRef(null);
  // A scheduled email being edited keeps its own draft slot.
  const key = options.replacesOutboxId ? `therapy-email-draft:outbox:${options.replacesOutboxId}` : draftKey(mode, sourceId, options.clientIds);

  useEffect(() => {
    api.get('/email/status').then(r => { setMailbox(r.data.mailbox || ''); setFromMailbox(r.data.sending_mailbox || r.data.mailbox || ''); }).catch(() => setMailbox(''));
    api.get('/clients?active=all').then(r => setClients(r.data)).catch(() => {});
    api.get('/email/tags').then(r => setAllTags(r.data)).catch(() => {});
    if (!options.source && sourceId) api.get(`/email/messages/${sourceId}`).then(r => setSource(r.data)).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Starting content, once the original email (for replies) and the mailbox are known.
  useEffect(() => {
    if (state || mailbox === undefined || (sourceId && !source)) return;
    if (options.state) { setState(options.state); setShowCc(!!(options.state.cc.length || options.state.bcc.length)); return; }
    if (options.fromOutbox) {
      const p = options.fromOutbox;
      setState({ to: p.to, cc: p.cc, bcc: p.bcc, subject: p.subject, html: p.html, uploads: p.uploads || (p.upload_ids || []).map(id => ({ id, filename: `Attachment ${id}` })),
        clientIds: p.client_ids || [], noClient: !!p.no_client, tagIds: p.tag_ids || [] });
      return;
    }
    const saved = storage.get(key);
    if (saved) { setState(saved); setRestoredDraft(true); setShowCc(!!(saved.cc?.length || saved.bcc?.length)); return; }
    api.get('/email/signature').then(r => r.data.html).catch(() => '').then(signature => {
      const sig = signature ? `<p></p>${signature}` : '';
      let to = options.to || [], cc = [], subject = '', clientIds = options.clientIds || [], tagIds = [];
      if (source) {
        if (mode === 'reply' || mode === 'replyAll') ({ to, cc } = replyRecipients(source, mode, mailbox));
        subject = mode === 'forward' ? prefixed('FW', source.subject) : prefixed('RE', source.subject);
        clientIds = source.status === 'filed' ? source.clients.map(c => c.id) : preTicked(source.suggestions);
        tagIds = (source.tags || []).map(t => t.id);
      }
      setShowCc(cc.length > 0);
      // A reply usually asks something: by default the task waits for an answer. A new email isn't
      // tracked unless asked.
      const taskChoice = mode === 'new' ? { status: 'none', follow_up_at: addWorkingDays() } : { status: 'waiting', follow_up_at: addWorkingDays() };
      setState({ to, cc, bcc: [], subject, html: `<p></p>${sig}`, uploads: [], clientIds, noClient: !!source && source.status === 'not_client', tagIds, taskChoice });
    }).catch(e => {
      console.error('Compose setup failed:', e);
      setState({ to: options.to || [], cc: [], bcc: [], subject: '', html: '<p></p>', uploads: [], clientIds: options.clientIds || [], noClient: false, tagIds: [] });
    });
  }, [state, mailbox, source]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep unsent work in this browser.
  useEffect(() => {
    if (!state || sending) return undefined;
    const t = setTimeout(() => storage.set(key, state), 400);
    return () => clearTimeout(t);
  }, [state, key, sending]);

  const set = patch => setState(s => ({ ...s, ...patch }));
  const clientMatches = useMemo(() => {
    const q = clientQuery.trim().toLowerCase();
    if (!q || !state) return [];
    return clients.filter(c => `${c.first_name} ${c.last_name}`.toLowerCase().includes(q) && !state.clientIds.includes(c.id)).slice(0, 6);
  }, [clientQuery, clients, state]);
  const clientName = id => { const c = clients.find(x => x.id === id); return c ? `${c.first_name} ${c.last_name}${c.active === 0 ? INACTIVE_SUFFIX : ''}` : `Client ${id}`; };

  if (!state) {
    return <Modal title={TITLES[mode]} size="xl" onClose={onClose}><p className="py-10 text-center text-sm text-gray-400">Loading…</p></Modal>;
  }

  const upload = async files => {
    if (!files?.length) return;
    setUploading(n => n + files.length); setError('');
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const r = await api.post('/email/uploads', fd);
      setState(s => ({ ...s, uploads: [...s.uploads, ...r.data] }));
    } catch (e) {
      setError(e.response?.status === 413 || /too large/i.test(e.response?.data?.error || e.message) ? 'That file is too large (25 MB at most)' : (e.response?.data?.error || 'Could not attach the file'));
    } finally { setUploading(n => n - files.length); }
  };

  const discard = () => { storage.remove(key); onClose(); };

  const send = async (sendAt = null) => {
    setError('');
    const all = [...state.to, ...state.cc, ...state.bcc];
    if (!state.to.length) return setError('Add at least one recipient');
    const bad = all.find(r => !EMAIL_RE.test(r.address));
    if (bad) return setError(`"${bad.address}" isn't a valid email address`);
    if (!state.clientIds.length && !state.noClient) return setError('Choose which client this email is about, or tick "No client"');
    if (mode === 'new' && !state.subject.trim()) return setError('Add a subject');
    if (uploading) return setError('Wait for the attachments to finish uploading');
    setSending(true);
    try {
      const r = await api.post('/email/send', {
        mode, source_id: sourceId, to: state.to, cc: state.cc, bcc: state.bcc, subject: state.subject, html: isBlankHtml(state.html) ? '' : state.html,
        upload_ids: state.uploads.map(u => u.id), client_ids: state.noClient ? [] : state.clientIds, no_client: state.noClient && !state.clientIds.length, tag_ids: state.tagIds,
        send_at: sendAt ? sendAt.toISOString() : undefined,
        task_choice: state.taskChoice,
        replaces_outbox_id: options.replacesOutboxId || undefined,
      });
      storage.remove(key);
      onQueued(r.data, { subject: state.subject, restore: { mode, sourceId, source, clientIds: options.clientIds, state }, onSent: options.onSent });
    } catch (e) {
      setError(e.response?.data?.error || 'Could not send');
      setSending(false);
    }
  };

  const saveSignature = async () => {
    await api.put('/email/signature', { html: editingSignature });
    setEditingSignature(null);
  };

  return (
    <Modal title={TITLES[mode]} size="xl" onClose={onClose}>
      <div className="space-y-3"
        onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); } }}
        onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); upload([...e.dataTransfer.files]); }}>
        {mailbox === '' && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Email isn't connected yet, so this can't be sent.</p>}
        {restoredDraft && (
          <p className="flex items-center justify-between rounded-md bg-indigo-50 px-3 py-1.5 text-xs text-indigo-800">
            Restored your unsent draft.
            <button type="button" className="font-medium underline" onClick={() => { storage.remove(key); setRestoredDraft(false); setState(null); }}>Start again</button>
          </p>
        )}
        {options.restoredFromUndo && <p className="rounded-md bg-indigo-50 px-3 py-1.5 text-xs text-indigo-800">Sending was undone — nothing was sent.</p>}
        {options.wasScheduledFor && <p className="rounded-md bg-indigo-50 px-3 py-1.5 text-xs text-indigo-800">Editing an email scheduled for {fmtWhen(options.wasScheduledFor)}. Sending or scheduling replaces it; closing without sending leaves it scheduled as it was.</p>}

        <div>
          <p className="py-1 text-sm text-gray-500"><span className="inline-block w-10">From</span> <span className="text-gray-800">{fromMailbox || mailbox || '—'}</span></p>
          <RecipientInput label="To" value={state.to} onChange={to => set({ to })} clientIds={state.clientIds} autoFocus={!state.to.length} />
          {showCc ? (
            <>
              <RecipientInput label="Cc" value={state.cc} onChange={cc => set({ cc })} clientIds={state.clientIds} />
              <RecipientInput label="Bcc" value={state.bcc} onChange={bcc => set({ bcc })} clientIds={state.clientIds} />
            </>
          ) : (
            <button type="button" onClick={() => setShowCc(true)} className="mt-1 text-xs text-indigo-600 hover:underline">Cc / Bcc</button>
          )}
          <div className="flex items-center gap-2 border-b border-gray-200 py-1.5">
            <span className="w-10 shrink-0 text-sm text-gray-500">Subject</span>
            <input value={state.subject} onChange={e => set({ subject: e.target.value })} className="flex-1 border-0 p-1 text-sm focus:outline-none focus:ring-0" />
          </div>
        </div>

        {/* The same Word-style editor as notes and templates: fonts, colours, tables, pictures. */}
        <div className="email-compose"><DocEditor layout="plain" value={state.html} onChange={html => set({ html })} uploadUrl="/email/images" placeholder="Write your email…" /></div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50">
            <Paperclip className="h-4 w-4" /> Attach
          </button>
          <input ref={fileRef} type="file" multiple className="hidden" onChange={e => { upload([...e.target.files]); e.target.value = ''; }} />
          {state.uploads.map(u => (
            <span key={u.id} className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700">
              {u.filename} {u.size != null && <span className="text-gray-400">{fmtBytes(u.size)}</span>}
              <button type="button" onClick={() => set({ uploads: state.uploads.filter(x => x.id !== u.id) })}><X className="h-3 w-3" /></button>
            </span>
          ))}
          {uploading > 0 && <span className="text-xs text-gray-400">Uploading…</span>}
          {mode === 'forward' && source?.attachments?.some(a => !a.is_inline) && <span className="text-xs text-gray-500">The original's attachments are included.</span>}
          <button type="button" onClick={async () => setEditingSignature((await api.get('/email/signature')).data.html || '')}
            className="ml-auto inline-flex items-center gap-1 text-xs text-gray-500 hover:text-indigo-600"><PenLine className="h-3.5 w-3.5" /> My signature</button>
        </div>

        {source && mode !== 'new' && (
          <div className="rounded-lg border border-gray-200">
            <button type="button" onClick={() => setShowOriginal(v => !v)} className="flex w-full items-center gap-1 px-3 py-1.5 text-left text-xs text-gray-500">
              {showOriginal ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Original email from {personLabel({ name: source.from_name, address: source.from_address })}, {fmtDateTime(source.received_at)} — included below your text
            </button>
            {showOriginal && <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap border-t border-gray-100 px-3 py-2 font-sans text-xs text-gray-600">{source.body_text}</pre>}
          </div>
        )}

        <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3 space-y-2">
          <p className="text-sm font-medium text-gray-800">File the sent email to</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {state.clientIds.map(id => (
              <span key={id} className="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs text-white">
                {clientName(id)}
                <button type="button" onClick={() => set({ clientIds: state.clientIds.filter(x => x !== id) })}><X className="h-3 w-3" /></button>
              </span>
            ))}
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1.5 h-3.5 w-3.5 text-gray-400" />
              <input value={clientQuery} onChange={e => setClientQuery(e.target.value)} placeholder="Add a client…"
                onKeyDown={e => { if (e.key === 'Enter' && clientMatches[0]) { e.preventDefault(); set({ clientIds: [...state.clientIds, clientMatches[0].id], noClient: false }); setClientQuery(''); } }}
                className="w-44 rounded-full border border-gray-300 bg-white py-1 pl-7 pr-2 text-xs focus:border-indigo-500 focus:outline-none" />
              {clientMatches.length > 0 && (
                <ul className="absolute z-30 mt-1 w-56 rounded-lg border border-gray-200 bg-white shadow-lg">
                  {clientMatches.map(c => (
                    <li key={c.id}><button type="button" onClick={() => { set({ clientIds: [...state.clientIds, c.id], noClient: false }); setClientQuery(''); }}
                      className="w-full px-3 py-1.5 text-left text-sm hover:bg-indigo-50">{c.first_name} {c.last_name}{c.active === 0 ? INACTIVE_SUFFIX : ''}</button></li>
                  ))}
                </ul>
              )}
            </div>
            {!state.clientIds.length && (
              <label className="ml-1 inline-flex items-center gap-1.5 text-xs text-gray-600">
                <input type="checkbox" className="accent-indigo-600" checked={state.noClient} onChange={e => set({ noClient: e.target.checked })} /> No client
              </label>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {allTags.map(t => (
              <button key={t.id} type="button" onClick={() => set({ tagIds: state.tagIds.includes(t.id) ? state.tagIds.filter(x => x !== t.id) : [...state.tagIds, t.id] })}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${tagChipClass(t.color, state.tagIds.includes(t.id))}`}>{t.name}</button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="mr-1 text-gray-600">After sending:</span>
          {[['waiting', 'Waiting for a reply'], ['done', 'Done'], ['todo', 'Keep as To do'], ['none', mode === 'new' ? "Don't track" : 'Leave the task as it is']].map(([v, l]) => (
            <button key={v} type="button" onClick={() => set({ taskChoice: { ...(state.taskChoice || {}), status: v, follow_up_at: state.taskChoice?.follow_up_at || addWorkingDays() } })}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${(state.taskChoice?.status || 'none') === v ? 'border-indigo-400 bg-indigo-100 text-indigo-800' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>{l}</button>
          ))}
          {state.taskChoice?.status === 'waiting' && (
            <label className="flex items-center gap-1 text-xs text-gray-600">
              follow up <input type="date" value={state.taskChoice.follow_up_at || ''} onChange={e => set({ taskChoice: { ...state.taskChoice, follow_up_at: e.target.value } })}
                className="rounded border border-gray-300 px-1.5 py-0.5 text-xs" />
            </label>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center gap-2">
          <div className="relative flex">
            <Button onClick={() => send()} disabled={sending || mailbox === '' || uploading > 0} title="Ctrl/⌘ + Enter" className="rounded-r-none"><Send className="h-4 w-4" /> Send</Button>
            <Button onClick={() => setScheduleOpen(o => !o)} disabled={sending || mailbox === '' || uploading > 0} title="Schedule send" className="rounded-l-none border-l border-indigo-500 px-2"><ChevronDown className="h-4 w-4" /></Button>
            {scheduleOpen && (
              <div className="absolute bottom-full left-0 z-30 mb-2 w-72 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
                <p className="flex items-center gap-1 px-2 pb-1 text-xs font-medium text-gray-500"><Clock className="h-3.5 w-3.5" /> Schedule send</p>
                {schedulePresets().map(([label, when]) => (
                  <button key={label} type="button" onClick={() => { setScheduleOpen(false); send(when); }}
                    className="flex w-full justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-indigo-50">
                    <span>{label}</span><span className="text-gray-400">{fmtWhen(when)}</span>
                  </button>
                ))}
                <div className="mt-1 border-t border-gray-100 px-2 pt-2">
                  <p className="mb-1 text-xs text-gray-500">Pick a date and time</p>
                  <div className="flex gap-1.5">
                    <input type="datetime-local" value={customWhen} min={toLocalInput(new Date())} onChange={e => setCustomWhen(e.target.value)}
                      className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none" />
                    <Button size="sm" disabled={!customWhen} onClick={() => { setScheduleOpen(false); send(new Date(customWhen)); }}>Schedule</Button>
                  </div>
                </div>
              </div>
            )}
          </div>
          <span className="text-xs text-gray-400">You can undo for a few seconds after sending.</span>
          <button type="button" onClick={discard} className="ml-auto inline-flex items-center gap-1 text-sm text-gray-500 hover:text-red-600"><Trash2 className="h-4 w-4" /> Discard</button>
        </div>
      </div>

      {editingSignature !== null && (
        <Modal title="My email signature" size="lg" onClose={() => setEditingSignature(null)} z="z-[70]">
          <div className="space-y-3">
            <p className="text-sm text-gray-500">Added to the end of every email you write. It's yours only — each person has their own.</p>
            <div className="email-compose"><DocEditor layout="plain" value={editingSignature} onChange={setEditingSignature} uploadUrl="/email/images" placeholder="e.g. your name, role, phone — add your logo with the picture button" /></div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditingSignature(null)}>Cancel</Button>
              <Button onClick={saveSignature}>Save signature</Button>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
