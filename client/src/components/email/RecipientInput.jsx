import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import api from '../../lib/api';

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

// "Name <address>", "address", or several separated by , or ;
function parseTyped(text) {
  return text.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean).map(s => {
    const m = /^(.*?)<\s*([^>]+)\s*>$/.exec(s);
    return m ? { name: m[1].trim().replace(/^"|"$/g, ''), address: m[2].trim().toLowerCase() } : { name: '', address: s.toLowerCase() };
  });
}

// To / Cc / Bcc box: recipients as chips; typing suggests the chosen clients' contacts first,
// then anyone on file or who has emailed the practice.
export default function RecipientInput({ label, value, onChange, clientIds = [], autoFocus = false }) {
  const [text, setText] = useState('');
  const [options, setOptions] = useState([]);
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);
  const key = clientIds.join(',');

  useEffect(() => {
    if (!focused) return undefined;
    let live = true;
    const t = setTimeout(() => {
      api.get('/email/recipients', { params: { q: text.trim() || undefined, client_ids: key || undefined } })
        .then(r => { if (live) { setOptions(r.data.filter(o => !value.some(v => v.address === o.address))); setActive(0); } }).catch(() => {});
    }, 150);
    return () => { live = false; clearTimeout(t); };
  }, [text, key, focused, value]);

  const add = list => {
    const next = [...value];
    for (const r of list) if (r.address && !next.some(v => v.address === r.address)) next.push(r);
    onChange(next);
    setText('');
  };
  const commitTyped = () => { if (text.trim()) add(parseTyped(text)); };

  const onKeyDown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' || e.key === 'Tab' || e.key === ',' || e.key === ';') {
      if (options[active] && text.trim()) { e.preventDefault(); add([options[active]]); }
      else if (text.trim()) { e.preventDefault(); commitTyped(); }
      else if (e.key === 'Enter' && options[active] && !text) { e.preventDefault(); add([options[active]]); }
    } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
  };

  return (
    <div className="flex items-start gap-2 border-b border-gray-200 py-1.5">
      <span className="w-10 shrink-0 pt-1 text-sm text-gray-500">{label}</span>
      <div className="relative flex min-w-0 flex-1 flex-wrap items-center gap-1" onClick={() => inputRef.current?.focus()}>
        {value.map(r => {
          const bad = !EMAIL_RE.test(r.address);
          return (
            <span key={r.address} title={r.address}
              className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs ${bad ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}>
              <span className="truncate">{r.name || r.address}</span>
              <button type="button" onClick={e => { e.stopPropagation(); onChange(value.filter(v => v.address !== r.address)); }}><X className="h-3 w-3" /></button>
            </span>
          );
        })}
        <input ref={inputRef} value={text} autoFocus={autoFocus} onChange={e => setText(e.target.value)} onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)} onBlur={() => { setTimeout(() => setFocused(false), 150); commitTyped(); }}
          onPaste={e => { const t = e.clipboardData.getData('text'); if (/[,;\n]/.test(t)) { e.preventDefault(); add(parseTyped(t)); } }}
          className="min-w-[8rem] flex-1 border-0 p-1 text-sm focus:outline-none focus:ring-0" />
        {focused && options.length > 0 && (
          <ul className="absolute left-0 top-full z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
            {options.map((o, i) => (
              <li key={o.address}>
                <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => add([o])}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm ${i === active ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}>
                  <span className="min-w-0 truncate">{o.name ? <>{o.name} <span className="text-gray-400">&lt;{o.address}&gt;</span></> : o.address}</span>
                  <span className="shrink-0 text-xs text-gray-400">{o.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export { EMAIL_RE };
