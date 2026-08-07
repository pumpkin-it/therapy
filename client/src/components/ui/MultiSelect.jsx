import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

/**
 * Searchable multi-select dropdown, styled to match SearchSelect.
 *
 * Props:
 *   options   — array of { value, label }
 *   values    — array of currently-selected values
 *   onChange  — (values: array) => void
 *   placeholder — string shown when nothing is selected
 *   disabled  — locks the trigger (still shows the current selection)
 */
export default function MultiSelect({ options = [], values = [], onChange, placeholder = 'All', disabled = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { if (!open) setQuery(''); }, [open]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => {
    const handler = e => { if (!containerRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectedSet = new Set(values.map(String));
  const filtered = query ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase())) : options;

  const toggle = v => {
    const sv = String(v);
    onChange(selectedSet.has(sv) ? values.filter(x => String(x) !== sv) : [...values, v]);
  };

  const summary = () => {
    if (values.length === 0) return placeholder;
    if (values.length === 1) {
      const opt = options.find(o => String(o.value) === String(values[0]));
      return opt?.label || placeholder;
    }
    return `${values.length} selected`;
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        className="w-full flex items-center justify-between rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white text-left hover:border-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
        onClick={() => !disabled && setOpen(o => !o)}
      >
        <span className={values.length ? 'text-gray-900' : 'text-gray-400'}>{summary()}</span>
        <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
      </button>

      {open && !disabled && (
        <div className="absolute z-50 mt-1 w-full min-w-[14rem] rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="p-1.5 border-b border-gray-100 flex items-center gap-1.5">
            <input
              ref={inputRef}
              className="flex-1 rounded border border-gray-200 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none"
              placeholder="Type to search…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
            />
            {values.length > 0 && (
              <button type="button" onClick={() => onChange([])} className="text-xs text-gray-400 hover:text-gray-600 px-1.5 shrink-0">
                Clear
              </button>
            )}
          </div>
          <ul className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 && <li className="px-3 py-2 text-sm text-gray-400">No matches</li>}
            {filtered.map(o => {
              const checked = selectedSet.has(String(o.value));
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-indigo-50 ${checked ? 'text-indigo-700 font-medium' : 'text-gray-900'}`}
                    onClick={() => toggle(o.value)}
                  >
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300'}`}>
                      {checked && <Check className="h-3 w-3 text-white" />}
                    </span>
                    {o.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
