import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Paperclip, ArrowUpRight, Inbox, X, PenSquare, CheckCircle2 } from 'lucide-react';
import { useCompose } from '../context/ComposeContext';
import api from '../lib/api';
import { refreshEmailCounts } from '../lib/useUnfiledEmailCount';
import Button from '../components/ui/Button';
import EmailViewer from '../components/email/EmailViewer';
import ScheduledList from '../components/email/ScheduledList';
import { fmtDateOnly } from '../lib/utils';
import { senderLabel, recipientsLabel, preTicked, sortedSuggestions, tagChipClass, tagPillClass } from '../lib/email';
import { CONTACT_ROLES } from '../lib/clientContacts';
import { Highlight, searchTerms } from '../lib/highlight';

const VIEWS = [['new', 'New'], ['unfiled', 'Unfiled'], ['filed', 'Filed'], ['not_client', 'No client'], ['all', 'All'], ['scheduled', 'Scheduled']];

// Email copied in from the practice mailbox, newest first. In Unfiled: open an email, tick its
// clients, File — the next one down opens.
export default function Email() {
  const [params, setParams] = useSearchParams();
  // New is the inbox: every incoming email until someone deals with it (files, replies or Done).
  const view = VIEWS.some(v => v[0] === params.get('view')) ? params.get('view') : 'new';
  const openId = Number(params.get('id')) || null;
  const tagFilter = Number(params.get('tag')) || null;
  const [allTags, setAllTags] = useState([]);
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [list, setList] = useState({ rows: [], total: 0, page: 1, page_size: 50 });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [clients, setClients] = useState([]);
  const [status, setStatus] = useState(null);
  const [unfiledCount, setUnfiledCount] = useState(null);
  const [newCount, setNewCount] = useState(null);
  const [scheduledCount, setScheduledCount] = useState(null);
  const [selected, setSelected] = useState([]);
  const [notice, setNotice] = useState(null); // { text, undoId, emailId } after filing
  const [offer, setOffer] = useState(null); // "add the sender as a contact?" after filing
  const terms = useMemo(() => searchTerms(q), [q]);
  const { openCompose } = useCompose();
  const viewerRef = useRef(null);

  const setParam = useCallback((changes) => {
    setParams(p => {
      const next = new URLSearchParams(p);
      for (const [k, v] of Object.entries(changes)) { if (v == null || v === '') next.delete(k); else next.set(k, v); }
      return next;
    }, { replace: true });
  }, [setParams]);

  useEffect(() => {
    api.get('/clients?active=all').then(r => setClients(r.data)).catch(() => {});
    api.get('/email/status').then(r => setStatus(r.data)).catch(() => {});
    api.get('/email/tags').then(r => setAllTags(r.data)).catch(() => {});
  }, []);

  useEffect(() => { const t = setTimeout(() => setQ(query.trim()), 300); return () => clearTimeout(t); }, [query]);

  const refreshCount = () => {
    refreshEmailCounts();
    api.get('/email/counts').then(r => { setUnfiledCount(r.data.unfiled); setNewCount(r.data.new); }).catch(() => {});
    api.get('/email/outbox').then(r => setScheduledCount(r.data.filter(x => x.scheduled && x.status === 'pending').length)).catch(() => {});
  };

  const load = useCallback(async (page = 1) => {
    if (view === 'scheduled') { setLoading(false); return; }
    setLoading(true);
    try {
      const r = await api.get('/email/messages', { params: { view, q: q || undefined, tag: tagFilter || undefined, page } });
      setList(l => (page === 1 ? r.data : { ...r.data, rows: [...l.rows, ...r.data.rows] }));
    } finally { setLoading(false); }
  }, [view, q, tagFilter]);

  useEffect(() => { setSelected([]); load(1); refreshCount(); }, [load]);

  useEffect(() => {
    if (!openId) { setMessage(null); return undefined; }
    let live = true;
    api.get(`/email/messages/${openId}`).then(r => {
      if (!live) return;
      setMessage(r.data);
      setList(l => ({ ...l, rows: l.rows.map(x => (x.id === openId ? { ...x, is_read: 1 } : x)) }));
      viewerRef.current?.scrollTo(0, 0);
    }).catch(() => { if (live) setMessage(null); });
    return () => { live = false; };
  }, [openId]);

  const open = id => setParam({ id });

  // After filing: in the queue the email leaves the list and the next one opens.
  const onChanged = updated => {
    const what = updated.done_only ? (updated.actioned_at ? 'Marked done.' : 'Moved back to New.')
      : updated.status === 'filed' ? `Filed to ${updated.clients.map(c => c.name).join(', ')}.`
      : updated.status === 'not_client' ? 'Filed as No client.' : 'Moved back to Unfiled.';
    const also = updated.also_filed?.length ? ` Also filed ${updated.also_filed.length} earlier email${updated.also_filed.length > 1 ? 's' : ''} in the same conversation.` : '';
    setNotice({ text: `"${updated.subject || '(no subject)'}": ${what}${also}`, undoId: updated.undo_id, emailId: updated.id });
    if (updated.done_only) refreshEmailCounts();
    setOffer(updated.contact_offer || null);
    refreshCount();
    const leaves = view === 'new' ? !!updated.actioned_at : view !== 'all' && updated.status !== view;
    if (!leaves) {
      setMessage(updated);
      setList(l => ({ ...l, rows: l.rows.map(x => (x.id === updated.id ? { ...x, status: updated.status, clients: updated.clients, tags: updated.tags } : x)) }));
      return;
    }
    const idx = list.rows.findIndex(x => x.id === updated.id);
    const gone = new Set([updated.id, ...(updated.also_filed || [])]);
    const rows = list.rows.filter(x => !gone.has(x.id));
    setList(l => ({ ...l, rows, total: Math.max(0, l.total - (l.rows.length - rows.length)) }));
    const next = rows[Math.min(Math.max(idx, 0), rows.length - 1)];
    setParam({ id: next ? next.id : null });
  };

  // Done: the email leaves New (its filing stays as it is); "Move back to New" undoes that.
  const markDone = async done => {
    try { onChanged({ ...(await api.post(`/email/messages/${message.id}/done`, { done })).data, done_only: true }); }
    catch (e) { setNotice({ text: e.response?.data?.error || 'Could not update the email.' }); }
  };

  // Undo the last filing: everything it changed goes back, and that email opens again.
  const undoFiling = async () => {
    const { undoId, emailId } = notice || {};
    if (!undoId) return;
    try {
      await api.post(`/email/undo/${undoId}`);
      setNotice({ text: 'Filing undone.' });
      setOffer(null);
      await load(1);
      refreshCount();
      if (emailId) setParam({ id: emailId });
    } catch (e) { setNotice({ text: e.response?.data?.error || 'Could not undo the filing.' }); }
  };

  // j / k (or arrow keys) move through the list when not typing.
  useEffect(() => {
    const onKey = e => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = list.rows.findIndex(x => x.id === openId);
      if (e.key === 'j' || e.key === 'ArrowDown') { const n = list.rows[idx + 1] || (idx < 0 && list.rows[0]); if (n) { e.preventDefault(); open(n.id); } }
      if (e.key === 'k' || e.key === 'ArrowUp') { const p = list.rows[idx - 1]; if (p) { e.preventDefault(); open(p.id); } }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const toggleSel = id => setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));

  return (
    <div className="-m-6 flex h-screen flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-white px-6 py-3">
        <h1 className="text-xl font-semibold text-gray-900">Email</h1>
        <Button size="sm" onClick={() => openCompose({ mode: 'new', onSent: () => { load(1); refreshCount(); } })}><PenSquare className="h-4 w-4" /> New email</Button>
        <div className="flex gap-1">
          {VIEWS.map(([v, label]) => (
            <button key={v} type="button" onClick={() => setParam({ view: v === 'new' ? null : v, id: null })}
              className={`rounded-full px-3 py-1 text-sm ${view === v ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
              {label}{(v === 'unfiled' ? unfiledCount : v === 'new' ? newCount : null) != null && <span className={`ml-1.5 ${view === v ? 'text-indigo-100' : 'text-gray-400'}`}>{v === 'unfiled' ? unfiledCount : newCount}</span>}
              {v === 'scheduled' && scheduledCount > 0 && <span className={`ml-1.5 ${view === v ? 'text-indigo-100' : 'text-gray-400'}`}>{scheduledCount}</span>}
            </button>
          ))}
        </div>
        <select value={tagFilter || ''} onChange={e => setParam({ tag: e.target.value || null, id: null })}
          className={`rounded-lg border px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none ${tagFilter ? 'border-indigo-400 bg-indigo-50 text-indigo-800' : 'border-gray-300 text-gray-600'}`}>
          <option value="">All tags</option>
          {allTags.map(t => <option key={t.id} value={t.id}>{t.name}{t.count ? ` (${t.count})` : ''}</option>)}
        </select>
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search email…"
            className="w-full rounded-lg border border-gray-300 py-2 pl-8 pr-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        </div>
      </div>

      {status && !status.enabled && (
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-800">
          The mailbox isn't connected yet, so no new email is being copied in.
        </div>
      )}
      {status?.failures?.length > 0 && (
        <div className="border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-700">
          {status.failures.length} email{status.failures.length > 1 ? 's' : ''} couldn't be copied from the mailbox and {status.failures.length > 1 ? 'were' : 'was'} skipped.
        </div>
      )}

      {view === 'scheduled' ? <ScheduledList onCountChange={setScheduledCount} /> : (
      <div className="flex min-h-0 flex-1">
        <div className="flex w-2/5 min-w-[260px] max-w-md shrink-0 flex-col border-r border-gray-200 bg-white">
          {selected.length > 0 && (
            <BulkBar ids={selected} clients={clients} allTags={allTags} onDone={r => { setNotice({ text: `${selected.length} email${selected.length === 1 ? '' : 's'} updated.`, undoId: r?.undo_id }); setSelected([]); setParam({ id: null }); load(1); refreshCount(); }} onCancel={() => setSelected([])} />
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!loading && list.rows.length === 0 && (
              <div className="flex flex-col items-center gap-2 px-6 py-16 text-center text-sm text-gray-400">
                <Inbox className="h-8 w-8" />
                {q || tagFilter ? 'No emails match.' : view === 'new' ? 'Nothing new — all caught up.' : view === 'unfiled' ? 'Nothing waiting to be filed.' : 'No emails here.'}
              </div>
            )}
            <ul className="divide-y divide-gray-100">
              {list.rows.map(m => (
                <li key={m.id} className={`flex gap-2 px-3 py-2.5 cursor-pointer ${m.id === openId ? 'bg-indigo-50' : 'hover:bg-gray-50'}`} onClick={() => open(m.id)}>
                  <input type="checkbox" className="mt-1 accent-indigo-600" checked={selected.includes(m.id)}
                    onClick={e => e.stopPropagation()} onChange={() => toggleSel(m.id)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {m.direction === 'out' && <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-indigo-500" />}
                      <span className={`truncate text-sm ${m.is_read ? 'text-gray-700' : 'font-semibold text-gray-900'}`}>
                        <Highlight text={m.direction === 'out' ? `To: ${recipientsLabel(m)}` : senderLabel(m)} terms={terms} />
                      </span>
                      {!!m.has_attachments && <Paperclip className="h-3.5 w-3.5 shrink-0 text-gray-400" />}
                      <span className="ml-auto shrink-0 text-xs text-gray-400">{fmtDateOnly(m.received_at)}</span>
                    </div>
                    <p className={`truncate text-sm ${m.is_read ? 'text-gray-600' : 'font-medium text-gray-800'}`}>{m.subject ? <Highlight text={m.subject} terms={terms} /> : '(no subject)'}</p>
                    <p className="truncate text-xs text-gray-400"><Highlight text={m.snippet} terms={terms} /></p>
                    <RowTags m={m} />
                  </div>
                </li>
              ))}
            </ul>
            {list.rows.length < list.total && (
              <div className="p-3 text-center">
                <Button size="sm" variant="secondary" onClick={() => load(list.page + 1)} disabled={loading}>Load more ({list.total - list.rows.length} more)</Button>
              </div>
            )}
          </div>
        </div>

        <div ref={viewerRef} className="min-w-0 flex-1 overflow-y-auto bg-white p-6">
          {notice && (
            <div className="mb-3 flex items-center gap-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
              <p className="min-w-0 flex-1">{notice.text}</p>
              {notice.undoId && <button type="button" onClick={undoFiling} className="shrink-0 font-medium text-green-900 underline hover:text-green-700">Undo</button>}
              <button type="button" onClick={() => setNotice(null)} title="Dismiss" className="shrink-0 text-green-700 hover:text-green-900"><X className="h-4 w-4" /></button>
            </div>
          )}
          {offer && <ContactOffer offer={offer} onDone={() => setOffer(null)} />}
          {message && message.direction === 'in' && (
            <div className="mb-3 flex items-center gap-2 text-sm">
              {message.actioned_at ? (
                <>
                  <span className="text-gray-500">Dealt with {fmtDateOnly(message.actioned_at)}.</span>
                  <button type="button" onClick={() => markDone(false)} className="text-indigo-600 hover:underline">Move back to New</button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="secondary" onClick={() => markDone(true)}><CheckCircle2 className="h-4 w-4" /> Done</Button>
                  <span className="text-xs text-gray-400">Takes it out of New. Filing it or replying does this too.</span>
                </>
              )}
            </div>
          )}
          {message
            ? <EmailViewer message={message} clients={clients} allTags={allTags} onTagCreated={t => setAllTags(ts => (ts.some(x => x.id === t.id) ? ts : [...ts, { ...t, count: 0 }]))}
                onChanged={onChanged} onOpen={id => setParam({ id })} onSent={() => load(1)} terms={terms} />
            : <p className="py-16 text-center text-sm text-gray-400">{list.rows.length ? 'Choose an email to read and file it.' : ''}</p>}
        </div>
      </div>
      )}
    </div>
  );
}

const TASK_PILL = { todo: ['To do', 'bg-amber-100 text-amber-800'], waiting: ['Waiting', 'bg-sky-100 text-sky-800'], done: ['Done', 'bg-green-100 text-green-800'] };

function RowTags({ m }) {
  const tagPills = m.tags?.map(t => <span key={`t${t.id}`} className={`rounded-full px-2 py-0.5 text-xs ${tagPillClass(t.color)}`}>{t.name}</span>) || [];
  if (m.task_status && TASK_PILL[m.task_status]) tagPills.unshift(<span key="task" className={`rounded-full px-2 py-0.5 text-xs font-medium ${TASK_PILL[m.task_status][1]}`}>{TASK_PILL[m.task_status][0]}</span>);
  if (m.status === 'filed') {
    return (
      <div className="mt-1 flex flex-wrap gap-1">
        {m.clients.map(c => <span key={c.id} className="rounded-full bg-indigo-600 px-2 py-0.5 text-xs text-white">{c.name}</span>)}
        {tagPills}
      </div>
    );
  }
  if (m.status === 'not_client') {
    return <div className="mt-1 flex flex-wrap gap-1"><span className="rounded-full border border-gray-300 px-2 py-0.5 text-xs text-gray-500">No client</span>{tagPills}</div>;
  }
  const ticked = preTicked(m.suggestions);
  const strongTags = (m.tag_suggestions || []).filter(t => t.strong);
  const taskPill = m.task_status && TASK_PILL[m.task_status]
    ? <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TASK_PILL[m.task_status][1]}`}>{TASK_PILL[m.task_status][0]}</span> : null;
  if (!m.suggestions.length && !strongTags.length && !taskPill) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {taskPill}
      {sortedSuggestions(m.suggestions).slice(0, 3).map(s => (
        <span key={s.id} className={`rounded-full px-2 py-0.5 text-xs ${ticked.includes(s.id) ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'}`}>{s.name}?</span>
      ))}
      {m.suggestions.length > 3 && <span className="text-xs text-gray-400">+{m.suggestions.length - 3}</span>}
      {strongTags.map(t => <span key={`t${t.id}`} className="rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-xs text-gray-500">{t.name}?</span>)}
    </div>
  );
}

// Several selected emails: file them all to the same client(s) or as "No client", and/or add tags.
function BulkBar({ ids, clients, allTags, onDone, onCancel }) {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState([]);
  const [tagIds, setTagIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const matches = useMemo(() => {
    const t = query.trim().toLowerCase();
    return t ? clients.filter(c => `${c.first_name} ${c.last_name}`.toLowerCase().includes(t) && !chosen.some(x => x.id === c.id)).slice(0, 6) : [];
  }, [query, clients, chosen]);
  const run = async body => {
    setSaving(true); setError('');
    try { onDone((await api.post('/email/bulk', { message_ids: ids, tag_ids: tagIds, ...body })).data); }
    catch (e) { setError(e.response?.data?.error || 'Could not save'); } finally { setSaving(false); }
  };
  const toggleTag = id => setTagIds(t => (t.includes(id) ? t.filter(x => x !== id) : [...t, id]));
  return (
    <div className="space-y-2 border-b border-indigo-100 bg-indigo-50 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-800">{ids.length} selected</p>
        <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
      </div>
      <div className="flex flex-wrap gap-1">
        {chosen.map(c => (
          <span key={c.id} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs text-gray-700 ring-1 ring-gray-200">
            {c.first_name} {c.last_name}{c.active === 0 ? ' - INACTIVE' : ''}
            <button type="button" onClick={() => setChosen(x => x.filter(y => y.id !== c.id))}><X className="h-3 w-3" /></button>
          </span>
        ))}
      </div>
      <div className="relative">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="File all to client…"
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none" />
        {matches.length > 0 && (
          <ul className="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
            {matches.map(c => (
              <li key={c.id}><button type="button" onClick={() => { setChosen(x => [...x, c]); setQuery(''); }}
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-indigo-50">{c.first_name} {c.last_name}{c.active === 0 ? ' - INACTIVE' : ''}</button></li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="mb-1 text-xs text-gray-500">Add tags to all:</p>
        <div className="flex flex-wrap gap-1">
          {allTags.map(t => (
            <button key={t.id} type="button" onClick={() => toggleTag(t.id)}
              className={`rounded-full border px-2 py-0.5 text-xs ${tagChipClass(t.color, tagIds.includes(t.id))}`}>{t.name}</button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {chosen.length > 0 ? (
          <Button size="sm" disabled={saving} onClick={() => run({ client_ids: chosen.map(c => c.id) })}>File {ids.length} to {chosen.length > 1 ? `${chosen.length} clients` : `${chosen[0].first_name} ${chosen[0].last_name}`}</Button>
        ) : (
          <>
            <Button size="sm" variant="secondary" disabled={saving} onClick={() => run({ client_ids: [], no_client: true })}>File {ids.length} — no client</Button>
            <Button size="sm" variant="secondary" disabled={saving} onClick={() => run({ client_ids: [], done: true })} title="Leave their filing as it is; take them out of New">Mark {ids.length} done</Button>
            {tagIds.length > 0 && <Button size="sm" variant="ghost" disabled={saving} onClick={() => run({ client_ids: [] })}>Only add tags</Button>}
          </>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

// After filing an email from someone not yet on file: offer to add them as a contact of the
// client(s), so their next emails are suggested straight away.
function ContactOffer({ offer, onDone }) {
  const [name, setName] = useState(offer.name);
  const [role, setRole] = useState(offer.role);
  const [organisation, setOrganisation] = useState('');
  const [chosen, setChosen] = useState(offer.clients.map(c => c.id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const add = async () => {
    setSaving(true); setError('');
    try {
      const r = await api.post('/email/contacts', { client_ids: chosen, name, email: offer.email, role, organisation });
      setDone(`Added.${r.data.refreshed ? ` ${r.data.refreshed} other unfiled email${r.data.refreshed === 1 ? '' : 's'} from them now suggest this client.` : ''}`);
      setTimeout(onDone, 4000);
    } catch (e) { setError(e.response?.data?.error || 'Could not add the contact'); } finally { setSaving(false); }
  };
  if (done) return <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{done}</p>;
  return (
    <div className="mb-3 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-gray-800">
          <span className="font-medium break-all">{offer.email}</span> isn't on file for {offer.clients.length === 1 ? offer.clients[0].name : 'these clients'}. Add them as a contact?
        </p>
        <button type="button" onClick={onDone} className="text-gray-400 hover:text-gray-600" title="No thanks"><X className="h-4 w-4" /></button>
      </div>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Their name"
        className="w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:border-indigo-500 focus:outline-none" />
      <div className="grid grid-cols-2 gap-2">
        <select value={role} onChange={e => setRole(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none">
          {CONTACT_ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input value={organisation} onChange={e => setOrganisation(e.target.value)} placeholder={offer.organisation_hint ? `Organisation (e.g. ${offer.organisation_hint})` : 'Organisation'}
          className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:border-indigo-500 focus:outline-none" />
      </div>
      {offer.clients.length > 1 && (
        <div className="flex flex-wrap gap-3">
          {offer.clients.map(c => (
            <label key={c.id} className="flex items-center gap-1.5 text-sm text-gray-700">
              <input type="checkbox" className="accent-indigo-600" checked={chosen.includes(c.id)}
                onChange={() => setChosen(x => (x.includes(c.id) ? x.filter(y => y !== c.id) : [...x, c.id]))} />
              {c.name}
            </label>
          ))}
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={add} disabled={saving || !chosen.length || !name.trim()}>Add contact</Button>
        <Button size="sm" variant="ghost" onClick={onDone}>No thanks</Button>
      </div>
    </div>
  );
}
