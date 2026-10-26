import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { setQuery, step, replaceCurrent, replaceAll, clearSearch, searchState } from './search';

// Find (Ctrl+F) and replace (Ctrl+H) bar for the report editor. Enter = next match, Shift+Enter =
// previous, Escape closes. Replace is only offered when the report can be edited.
export default function FindBar({ editor, withReplace, canEdit, onClose }) {
  const [query, setQ] = useState('');
  const [replacement, setReplacement] = useState('');
  const [, force] = useState(0);
  const [notice, setNotice] = useState('');
  const findRef = useRef(null);

  useEffect(() => {
    // Start with the selected text, like Word.
    const { from, to } = editor.state.selection;
    const picked = from !== to ? editor.state.doc.textBetween(from, to, ' ').slice(0, 100) : '';
    if (picked && !picked.includes('\n')) { setQ(picked); setQuery(editor, picked); }
    findRef.current?.focus(); findRef.current?.select();
    const refresh = () => force(n => n + 1);
    editor.on('transaction', refresh);
    return () => { editor.off('transaction', refresh); clearSearch(editor); };
  }, [editor]);

  const s = searchState(editor);
  const change = v => { setQ(v); setNotice(''); setQuery(editor, v); };
  const close = () => { onClose(); editor.commands.focus(); };
  const keys = e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter') { e.preventDefault(); step(editor, e.shiftKey ? -1 : 1); }
  };
  const showReplace = withReplace && canEdit;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-4 py-2 text-sm">
      <input ref={findRef} value={query} onChange={e => change(e.target.value)} onKeyDown={keys} placeholder="Find in report"
        className="w-56 rounded-md border border-gray-300 px-2 py-1 focus:border-indigo-500 focus:outline-none" />
      <span className="w-20 text-xs text-gray-500">{query ? (s.matches.length ? `${s.current + 1} of ${s.matches.length}` : 'No matches') : ''}</span>
      <button type="button" title="Previous (Shift+Enter)" onClick={() => step(editor, -1)} disabled={!s.matches.length} className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-40"><ChevronUp className="h-4 w-4" /></button>
      <button type="button" title="Next (Enter)" onClick={() => step(editor, 1)} disabled={!s.matches.length} className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-40"><ChevronDown className="h-4 w-4" /></button>
      {showReplace && (
        <>
          <input value={replacement} onChange={e => setReplacement(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); close(); } else if (e.key === 'Enter') { e.preventDefault(); replaceCurrent(editor, replacement); } }}
            placeholder="Replace with" className="w-56 rounded-md border border-gray-300 px-2 py-1 focus:border-indigo-500 focus:outline-none" />
          <button type="button" onClick={() => replaceCurrent(editor, replacement)} disabled={!s.matches.length} className="rounded-md border border-gray-300 px-2 py-1 text-gray-700 hover:bg-gray-50 disabled:opacity-40">Replace</button>
          <button type="button" onClick={() => { const n = replaceAll(editor, replacement); setNotice(n ? `Replaced ${n}.` : ''); }} disabled={!s.matches.length} className="rounded-md border border-gray-300 px-2 py-1 text-gray-700 hover:bg-gray-50 disabled:opacity-40">Replace all</button>
        </>
      )}
      {notice && <span className="text-xs text-green-700">{notice}</span>}
      <button type="button" title="Close (Esc)" onClick={close} className="ml-auto rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X className="h-4 w-4" /></button>
    </div>
  );
}
