import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Send, Sparkles, X, Loader2 } from 'lucide-react';
import api from '../lib/api';
import Button from '../components/ui/Button';
import { fmtDateTime } from '../lib/utils';

const KIND_LABELS = {
  note: 'Session note', appointment: 'Appointment', file: 'File', zip_entry: 'Old-system document', note_file: 'Note attachment',
  form: 'Form', report: 'Report', email: 'Email', attachment: 'Email attachment', task: 'Task',
};
const CITATION = /\[(note|appointment|file|zip_entry|note_file|form|report|email|attachment|task) (\d+(?::\d+)?)\]/g;

// Documents open (or download) themselves; other sources link to their page in Therapy.
const DOCUMENT_URL = {
  file: s => `/client-files/${s.id}/download`,
  zip_entry: s => { const [f, i] = String(s.id).split(':'); return `/ask/zip-entry/${f}/${i}`; },
  note_file: s => `/session-note-files/${s.id}/download`,
  attachment: s => `/email/attachments/${s.id}`,
};
const VIEWABLE = /^(application\/pdf|image\/|text\/plain)/;

// Fetched with the sign-in token (a plain link can't send it), then shown in a new tab when the
// browser can display it (PDFs, images, text), otherwise downloaded with its own name. The tab is
// opened straight away, before the download, so the browser doesn't treat it as a pop-up.
async function openDocument(s) {
  const tab = window.open('', '_blank');
  try {
    const res = await api.get(DOCUMENT_URL[s.kind](s), { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    if (tab && VIEWABLE.test(res.data.type || '')) tab.location.href = url;
    else {
      tab?.close();
      const a = document.createElement('a');
      a.href = url;
      a.download = s.name || `${s.kind}-${s.id}`;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch {
    tab?.close();
    window.alert('That document could not be opened.');
  }
}

// Where a cited record lives in Therapy.
function sourceLink(s) {
  const client = s.client_id ? `/clients/${s.client_id}` : null;
  switch (s.kind) {
    case 'appointment': return `/appointments/${s.id}`;
    case 'note': case 'note_file': return client && `${client}?tab=notes`;
    case 'file': case 'zip_entry': return client && `${client}?tab=files`;
    case 'form': return client && `${client}?tab=forms`;
    case 'report': return client && `${client}?tab=reports`;
    case 'email': return `/email?view=all&id=${s.id}`;
    case 'attachment': return s.email_id && `/email?view=all&id=${s.email_id}`;
    case 'task': return `/tasks?id=${s.id}`;
    default: return null;
  }
}

const sourceTitle = s => (s.name ? `${KIND_LABELS[s.kind]}: ${s.name}` : `${KIND_LABELS[s.kind]} ${s.id}`);

// A source as a link: documents open themselves, everything else opens its page in a new tab.
function SourceLink({ source, className, children }) {
  if (DOCUMENT_URL[source.kind]) {
    return <button type="button" title={sourceTitle(source)} onClick={() => openDocument(source)} className={className}>{children}</button>;
  }
  const to = sourceLink(source);
  return to ? <Link to={to} target="_blank" rel="noopener noreferrer" title={sourceTitle(source)} className={className}>{children}</Link>
    : <span title={sourceTitle(source)}>{children}</span>;
}

function SourceChip({ source, n }) {
  return (
    <SourceLink source={source} className="mx-0.5 inline-flex items-center rounded bg-indigo-50 px-1.5 text-xs font-medium text-indigo-700 align-baseline hover:bg-indigo-100">{n}</SourceLink>
  );
}

// The answer, with each [kind id] citation shown as a numbered link and **bold** / "- " lists kept.
function Answer({ text, sources }) {
  const index = new Map((sources || []).map((s, i) => [`${s.kind} ${s.id}`, i]));
  const inline = (line, key) => {
    const out = [];
    let last = 0;
    for (const m of line.matchAll(CITATION)) {
      out.push(line.slice(last, m.index));
      const i = index.get(`${m[1]} ${m[2]}`);
      out.push(i === undefined ? <span key={`${key}-${m.index}`} className="text-xs text-gray-400">[{m[1]} {m[2]}]</span>
        : <SourceChip key={`${key}-${m.index}`} source={sources[i]} n={i + 1} />);
      last = m.index + m[0].length;
    }
    out.push(line.slice(last));
    return out.map((part, i) => typeof part !== 'string' ? part
      : part.split(/(\*\*[^*]+\*\*)/).map((t, j) => (t.startsWith('**') && t.endsWith('**') ? <strong key={`${key}-${i}-${j}`}>{t.slice(2, -2)}</strong> : <Fragment key={`${key}-${i}-${j}`}>{t}</Fragment>)));
  };
  const blocks = String(text || '').split(/\n\s*\n/);
  return (
    <div className="space-y-2 text-sm leading-relaxed text-gray-800">
      {blocks.map((b, bi) => {
        const lines = b.split('\n').filter(l => l.trim());
        if (lines.length && lines.every(l => /^\s*([-*•]|\d+\.)\s+/.test(l))) {
          return <ul key={bi} className="list-disc space-y-1 pl-5">{lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ''), `${bi}-${li}`)}</li>)}</ul>;
        }
        return <p key={bi}>{lines.map((l, li) => <Fragment key={li}>{li > 0 && <br />}{inline(l.replace(/^#+\s*/, ''), `${bi}-${li}`)}</Fragment>)}</p>;
      })}
    </div>
  );
}

function SourceList({ sources }) {
  if (!sources?.length) return null;
  return (
    <ol className="mt-3 space-y-0.5 border-t border-gray-100 pt-2 text-xs text-gray-500">
      {sources.map((s, i) => (
        <li key={i}><span className="mr-1 font-medium text-indigo-700">{i + 1}</span>
          <SourceLink source={s} className="text-left hover:text-indigo-700 hover:underline">{sourceTitle(s)}</SourceLink></li>
      ))}
    </ol>
  );
}

// The clients a conversation is filed to (shown on their Communications tab), with remove and add.
function FiledClients({ convo, onChange }) {
  const [adding, setAdding] = useState(false);
  const [all, setAll] = useState([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { if (adding && !all.length) api.get('/clients?active=all').then(r => setAll(r.data)).catch(() => {}); }, [adding, all.length]);
  const matches = useMemo(() => {
    const t = query.trim().toLowerCase();
    return t ? all.filter(c => `${c.first_name} ${c.last_name}`.toLowerCase().includes(t) && !convo.clients.some(x => x.id === c.id)).slice(0, 6) : [];
  }, [query, all, convo.clients]);
  const change = async body => {
    setError('');
    try { onChange((await api.post(`/ask/conversations/${convo.id}/clients`, body)).data.clients); setQuery(''); setAdding(false); }
    catch (e) { setError(e.response?.data?.error || 'Could not change the filing'); }
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-500">
      <span>Filed to</span>
      {convo.clients.length === 0 && <span className="text-gray-400">no client yet</span>}
      {convo.clients.map(c => (
        <span key={c.id} className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 font-medium text-indigo-800">
          <Link to={`/clients/${c.id}?tab=communications`} target="_blank" rel="noopener noreferrer" className="hover:underline">{c.name}{!c.active ? ' - INACTIVE' : ''}</Link>
          <button type="button" title="Take this conversation off this client" onClick={() => change({ remove: [c.id] })}><X className="h-3 w-3" /></button>
        </span>
      ))}
      {adding ? (
        <span className="relative">
          <input autoFocus value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setAdding(false); }} placeholder="Client name…"
            className="w-40 rounded-full border border-gray-300 px-2 py-0.5 text-xs focus:border-indigo-500 focus:outline-none" />
          {matches.length > 0 && (
            <ul className="absolute z-20 mt-1 w-56 rounded-lg border border-gray-200 bg-white shadow-lg">
              {matches.map(c => <li key={c.id}><button type="button" onClick={() => change({ add: [c.id] })} className="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-indigo-50">{c.first_name} {c.last_name}{!c.active ? ' - INACTIVE' : ''}</button></li>)}
            </ul>
          )}
        </span>
      ) : <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-0.5 text-indigo-600 hover:text-indigo-800"><Plus className="h-3 w-3" /> Add client</button>}
      {convo.asked_by && !convo.mine && <span className="ml-auto text-gray-400">Asked by {convo.asked_by}</span>}
      {error && <span className="w-full text-red-600">{error}</span>}
    </div>
  );
}

// Ask questions about clients; Claude searches Therapy's records and answers with links to them.
export default function Ask() {
  const [params, setParams] = useSearchParams();
  const openId = Number(params.get('id')) || null;
  const scopeClientId = Number(params.get('client')) || null;
  const [list, setList] = useState([]);
  const [convo, setConvo] = useState(null); // { id, client_id, client_name, turns }
  const [scopeName, setScopeName] = useState('');
  const [status, setStatus] = useState(null);
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(null); // { question, text, status }
  const [error, setError] = useState('');
  const bottomRef = useRef(null);

  const loadList = useCallback(() => api.get('/ask/conversations').then(r => setList(r.data)).catch(() => {}), []);
  const loadStatus = useCallback(() => api.get('/ask/status').then(r => setStatus(r.data)).catch(() => {}), []);
  useEffect(() => { loadList(); loadStatus(); }, [loadList, loadStatus]);
  useEffect(() => {
    setError('');
    if (!openId) { setConvo(null); return; }
    api.get(`/ask/conversations/${openId}`).then(r => setConvo(r.data)).catch(() => setConvo(null));
  }, [openId]);
  useEffect(() => {
    if (!scopeClientId || openId) { setScopeName(''); return; }
    api.get(`/clients/${scopeClientId}`).then(r => setScopeName(`${r.data.first_name} ${r.data.last_name}`)).catch(() => setScopeName(''));
  }, [scopeClientId, openId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [convo, pending?.text, pending?.status]);

  const submit = async () => {
    const q = question.trim();
    if (!q || pending) return;
    setError('');
    setQuestion('');
    setPending({ question: q, text: '', status: 'Starting…' });
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('pm_token')}` },
        body: JSON.stringify({ question: q, conversation_id: convo?.id || undefined, client_id: convo ? undefined : scopeClientId || undefined }),
      });
      if (!res.ok || !res.body) throw new Error(res.status === 403 ? "You don't have access to Ask." : 'Ask is not available right now.');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let done = null;
      for (;;) {
        const { value, done: finished } = await reader.read();
        if (finished) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop();
        for (const e of events) {
          const line = e.split('\n').find(l => l.startsWith('data: '));
          if (!line) continue;
          const ev = JSON.parse(line.slice(6));
          if (ev.type === 'status') setPending(p => ({ ...p, status: ev.text }));
          else if (ev.type === 'text') setPending(p => ({ ...p, text: p.text + ev.text, status: '' }));
          else if (ev.type === 'restart') setPending(p => ({ ...p, text: '' }));
          else if (ev.type === 'error') throw new Error(ev.error);
          else if (ev.type === 'done') done = ev;
        }
      }
      if (!done) throw new Error('The answer was cut off. Please try again.');
      const turn = { question: q, answer: done.answer, sources: done.sources, cost_usd: done.cost_usd, at: new Date().toISOString() };
      setConvo(c => (c ? { ...c, turns: [...c.turns, turn] } : { id: done.conversation_id, client_id: scopeClientId, client_name: scopeName, turns: [turn] }));
      if (!convo) setParams({ id: String(done.conversation_id) }, { replace: true });
      // Pick up which clients it's now filed to.
      api.get(`/ask/conversations/${done.conversation_id}`).then(r => setConvo(r.data)).catch(() => {});
      loadList();
      loadStatus();
    } catch (e) {
      setError(e.message || 'Something went wrong.');
      setQuestion(q);
    } finally {
      setPending(null);
    }
  };

  const newConversation = () => setParams({}, { replace: false });
  const about = convo ? null : scopeName;
  const readOnly = convo && convo.mine === false;
  const overLimit = status && status.limit_usd > 0 && status.spent_usd >= status.limit_usd;

  return (
    <div className="-m-6 flex h-screen flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-white px-6 py-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900"><Sparkles className="h-5 w-5 text-indigo-500" /> Ask</h1>
        <Button size="sm" variant="secondary" onClick={newConversation}><Plus className="h-4 w-4" /> New question</Button>
        {status && <p className="ml-auto text-xs text-gray-400">{status.model_label} in Australia · US${status.spent_usd.toFixed(2)}{status.limit_usd > 0 ? ` of US$${status.limit_usd}` : ''} used this month</p>}
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-64 shrink-0 overflow-y-auto border-r border-gray-200 bg-white md:block">
          {list.length === 0 && <p className="px-4 py-8 text-center text-sm text-gray-400">Your questions will appear here.</p>}
          <ul className="divide-y divide-gray-100">
            {list.map(c => (
              <li key={c.id}>
                <button type="button" onClick={() => setParams({ id: String(c.id) })} className={`w-full px-3 py-2.5 text-left ${c.id === openId ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}>
                  <p className="truncate text-sm text-gray-900">{c.title}</p>
                  <p className="truncate text-xs text-gray-400">{c.client_name ? `${c.client_name} · ` : ''}{fmtDateTime(c.updated_at)}</p>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex min-w-0 flex-1 flex-col bg-gray-50">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="mx-auto max-w-3xl space-y-5">
              {!convo && !pending && (
                <div className="py-10 text-center text-sm text-gray-500">
                  <Sparkles className="mx-auto mb-3 h-8 w-8 text-indigo-300" />
                  <p className="font-medium text-gray-700">Ask about a client, and the answer comes from Therapy's records.</p>
                  <p className="mt-1">For example: "When did Jupiter do his equipment trial?" or "What equipment was recommended for Katie?"</p>
                  <p className="mt-3 text-xs text-gray-400">It searches notes, appointments, files (including PDFs), forms, reports{status?.can_email ? ' and emails' : ''}. Every fact links to where it came from: check the source before relying on it.</p>
                </div>
              )}
              {convo?.clients && <FiledClients convo={convo} onChange={clients => setConvo(c => ({ ...c, clients }))} />}
              {convo?.turns.map((t, i) => (
                <div key={i} className="space-y-2">
                  <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-2 text-sm text-white">{t.question}</div>
                  <div className="rounded-2xl rounded-bl-sm border border-gray-200 bg-white px-4 py-3 shadow-sm">
                    <Answer text={t.answer} sources={t.sources} />
                    <SourceList sources={t.sources} />
                  </div>
                </div>
              ))}
              {pending && (
                <div className="space-y-2">
                  <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-2 text-sm text-white">{pending.question}</div>
                  <div className="rounded-2xl rounded-bl-sm border border-gray-200 bg-white px-4 py-3 shadow-sm">
                    {pending.text && <div className="whitespace-pre-wrap text-sm text-gray-800">{pending.text.replace(CITATION, '')}</div>}
                    {(pending.status || !pending.text) && <p className="flex items-center gap-2 text-xs text-gray-400"><Loader2 className="h-3.5 w-3.5 animate-spin" />{pending.status || 'Thinking…'}</p>}
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>
          <div className="border-t border-gray-200 bg-white px-6 py-3">
            <div className="mx-auto max-w-3xl space-y-2">
              {about && (
                <p className="flex items-center gap-1.5 text-xs text-gray-500">
                  About <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 font-medium text-indigo-800">{about}
                    {!convo && <button type="button" title="Ask about all clients" onClick={() => setParams({})}><X className="h-3 w-3" /></button>}</span>
                </p>
              )}
              {error && <p className="text-sm text-red-600">{error}</p>}
              {overLimit && <p className="text-sm text-amber-700">This month's spending limit has been reached. An owner can raise it in Settings → Ask (AI).</p>}
              {readOnly ? (
                <p className="text-sm text-gray-500">Asked by {convo.asked_by}. Only they can ask follow-ups here. <button type="button" onClick={newConversation} className="text-indigo-600 hover:underline">Ask your own question</button></p>
              ) : (
              <div className="flex items-end gap-2">
                <textarea rows={2} value={question} onChange={e => setQuestion(e.target.value)} disabled={!!pending}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
                  placeholder={convo ? 'Ask a follow-up question…' : 'Ask a question about a client…'}
                  className="min-h-[44px] flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                <Button onClick={submit} disabled={!question.trim() || !!pending}><Send className="h-4 w-4" /> Ask</Button>
              </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
