import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, FolderInput, Plus, Sparkles } from 'lucide-react';
import api from '../../lib/api';
import { refreshEmailCounts } from '../../lib/useUnfiledEmailCount';
import Button from '../ui/Button';
import { reasonLabel, preTicked, sortedSuggestions, tagChipClass, tagReasonLabel, INACTIVE_SUFFIX } from '../../lib/email';

// File an email: which clients it belongs to (suggested ones listed with why), and what it's about
// (tags — suggested ones marked). Tags work with or without clients; an email about nobody is
// filed as "No client". Ctrl/⌘+Enter files it.
export default function EmailFiling({ message, clients, allTags, onTagCreated, onDone }) {
  const initialClients = useMemo(
    () => (message.status === 'filed' ? message.clients.map(c => c.id) : message.status === 'unfiled' ? preTicked(message.suggestions) : []),
    [message.id, message.status], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const initialTags = useMemo(
    () => (message.status === 'unfiled'
      ? [...new Set([...message.tags.map(t => t.id), ...message.tag_suggestions.filter(t => t.strong).map(t => t.id)])]
      : message.tags.map(t => t.id)),
    [message.id, message.status], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [ticked, setTicked] = useState(initialClients);
  const [tagIds, setTagIds] = useState(initialTags);
  const [extra, setExtra] = useState([]); // clients added by search, shown under the suggestions
  const [query, setQuery] = useState('');
  const [newTag, setNewTag] = useState(null); // null = closed, string = typing a new tag
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const searchRef = useRef(null);

  useEffect(() => {
    setTicked(initialClients); setTagIds(initialTags); setExtra([]); setQuery(''); setError(''); setNewTag(null);
  }, [message.id, initialClients, initialTags]);

  const byId = useMemo(() => new Map(clients.map(c => [c.id, c])), [clients]);
  const rows = useMemo(() => {
    const list = sortedSuggestions(message.suggestions).map(s => ({ id: s.id, name: s.name, reasons: s.reasons }));
    for (const c of message.clients) if (!list.some(r => r.id === c.id)) list.push({ id: c.id, name: c.name, reasons: [] });
    for (const id of extra) if (!list.some(r => r.id === id)) { const c = byId.get(id); if (c) list.push({ id, name: `${c.first_name} ${c.last_name}${c.active === 0 ? INACTIVE_SUFFIX : ''}`, reasons: [] }); }
    return list;
  }, [message, extra, byId]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const code = /^c?0*(\d+)$/i.exec(q);
    return clients.filter(c => `${c.first_name} ${c.last_name}`.toLowerCase().includes(q) || (code && c.id === Number(code[1]))).slice(0, 8);
  }, [query, clients]);

  const tagSuggestion = useMemo(() => new Map(message.tag_suggestions.map(t => [t.id, t])), [message.tag_suggestions]);

  const toggle = id => setTicked(t => (t.includes(id) ? t.filter(x => x !== id) : [...t, id]));
  const toggleTag = id => setTagIds(t => (t.includes(id) ? t.filter(x => x !== id) : [...t, id]));
  const add = c => {
    if (!rows.some(r => r.id === c.id)) setExtra(e => [...e, c.id]);
    setTicked(t => (t.includes(c.id) ? t : [...t, c.id]));
    setQuery('');
    searchRef.current?.focus();
  };
  const createTag = async () => {
    const name = (newTag || '').trim();
    if (!name) { setNewTag(null); return; }
    try {
      const t = (await api.post('/email/tags', { name })).data;
      onTagCreated?.(t);
      setTagIds(ids => (ids.includes(t.id) ? ids : [...ids, t.id]));
      setNewTag(null);
    } catch (e) { setError(e.response?.data?.error || 'Could not add the tag'); }
  };

  const save = async (body) => {
    setSaving(true); setError('');
    // Filed from anywhere (Email page or a client's Communications tab): the sidebar number changes.
    try { onDone((await api.post(`/email/messages/${message.id}/file`, { tag_ids: tagIds, ...body })).data); refreshEmailCounts(); }
    catch (e) { setError(e.response?.data?.error || 'Could not save'); } finally { setSaving(false); }
  };
  const fileToClients = () => ticked.length && save({ client_ids: ticked });
  const fileNoClient = () => save({ client_ids: [], no_client: true });
  const moveToUnfiled = () => save({ client_ids: [] });

  useEffect(() => {
    const onKey = e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !saving) { e.preventDefault(); if (ticked.length) fileToClients(); else fileNoClient(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
  const unchanged = message.status !== 'unfiled' && sameSet(ticked, initialClients) && sameSet(tagIds, message.tags.map(t => t.id))
    && (ticked.length > 0) === (message.status === 'filed');

  // Every active tag, suggested ones first.
  const shownTags = useMemo(() => {
    const list = [...allTags];
    for (const t of message.tags) if (!list.some(x => x.id === t.id)) list.push(t);
    return list.sort((a, b) => (tagSuggestion.has(b.id) ? 1 : 0) - (tagSuggestion.has(a.id) ? 1 : 0));
  }, [allTags, message.tags, tagSuggestion]);

  return (
    <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3 space-y-3">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <p className="text-sm font-medium text-gray-800">
            {message.status === 'filed' ? 'Filed to' : message.status === 'not_client' ? 'Filed — no client' : 'Clients'}
          </p>
          {message.auto_filed ? <p className="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-800" title="Filed automatically — the sender is on file for this client only. Change it if it's wrong.">Auto-filed</p>
            : message.filed_by_name && <p className="text-xs text-gray-400">by {message.filed_by_name}</p>}
        </div>
        {rows.length > 0 && (
          <ul className="mb-2 space-y-1">
            {rows.map(r => (
              <li key={r.id}>
                <label className="flex items-start gap-2 cursor-pointer rounded px-1 py-0.5 hover:bg-white">
                  <input type="checkbox" className="mt-0.5 accent-indigo-600" checked={ticked.includes(r.id)} onChange={() => toggle(r.id)} />
                  <span className="min-w-0">
                    <span className="text-sm text-gray-900">{r.name}</span>
                    {r.reasons.length > 0 && <span className="ml-2 text-xs text-gray-500">{r.reasons.map(reasonLabel).join(' · ')}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
          <input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !(e.metaKey || e.ctrlKey) && matches[0]) { e.preventDefault(); add(matches[0]); } }}
            placeholder={rows.length ? 'Add another client…' : 'Search for a client…'}
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-8 pr-8 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          {query && <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-2.5 text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>}
          {matches.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
              {matches.map(c => (
                <li key={c.id}>
                  <button type="button" onClick={() => add(c)} className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-indigo-50">
                    <span>{c.first_name} {c.last_name}{c.active === 0 && <span className="text-gray-500">{INACTIVE_SUFFIX}</span>}</span>
                    <span className="text-xs text-gray-400">C{String(c.id).padStart(4, '0')}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium text-gray-800">Tags <span className="font-normal text-gray-400">(optional, any number)</span></p>
        <div className="flex flex-wrap gap-1.5">
          {shownTags.map(t => {
            const on = tagIds.includes(t.id);
            const sug = tagSuggestion.get(t.id);
            return (
              <button key={t.id} type="button" onClick={() => toggleTag(t.id)} title={sug ? `Suggested: ${sug.reasons.map(tagReasonLabel).join(' · ')}` : undefined}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${tagChipClass(t.color, on)} ${!on && sug ? 'border-dashed' : ''}`}>
                {sug && <Sparkles className="h-3 w-3" />}{t.name}
              </button>
            );
          })}
          {newTag === null ? (
            <button type="button" onClick={() => setNewTag('')} className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-2.5 py-1 text-xs text-gray-500 hover:border-indigo-400 hover:text-indigo-600">
              <Plus className="h-3 w-3" /> New tag
            </button>
          ) : (
            <span className="inline-flex items-center gap-1">
              <input autoFocus value={newTag} onChange={e => setNewTag(e.target.value)} maxLength={40}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); createTag(); } if (e.key === 'Escape') setNewTag(null); }}
                placeholder="Tag name" className="w-32 rounded-full border border-indigo-300 bg-white px-2.5 py-1 text-xs focus:outline-none" />
              <button type="button" onClick={createTag} className="text-xs font-medium text-indigo-600">Add</button>
            </span>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap items-center gap-2 border-t border-indigo-100 pt-2">
        {ticked.length > 0 ? (
          <Button size="sm" onClick={fileToClients} disabled={saving || unchanged} title="Ctrl/⌘ + Enter">
            <FolderInput className="h-4 w-4" />
            {message.status === 'filed' ? 'Save' : ticked.length > 1 ? `File to ${ticked.length} clients` : 'File'}
          </Button>
        ) : (
          <Button size="sm" variant={message.status === 'not_client' ? 'primary' : 'secondary'} onClick={fileNoClient} disabled={saving || unchanged} title="Ctrl/⌘ + Enter">
            <FolderInput className="h-4 w-4" /> {message.status === 'not_client' ? 'Save' : 'File — no client'}
          </Button>
        )}
        {message.status !== 'unfiled' && (
          <Button size="sm" variant="ghost" onClick={moveToUnfiled} disabled={saving}>Move back to Unfiled</Button>
        )}
      </div>
    </div>
  );
}
