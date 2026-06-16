import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Plus } from 'lucide-react';

/**
 * Searchable dropdown with optional inline "Add new" capability.
 *
 * Props:
 *   options       — array of { value, label }
 *   value         — current value
 *   onChange      — (value) => void
 *   placeholder   — string
 *   onAddNew      — (name) => Promise<{ value, label }>  — if provided, shows "Add new" option
 *   addNewLabel   — string (default "Add new…")
 */
export default function SearchSelect({ options = [], value, onChange, placeholder = 'Select…', onAddNew, addNewLabel = 'Add new…' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  const selected = options.find(o => String(o.value) === String(value));

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const handler = e => {
      if (!containerRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = query
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  const handleAddNew = async () => {
    if (!onAddNew || !query.trim()) return;
    setAdding(true);
    try {
      const newOpt = await onAddNew(query.trim());
      onChange(newOpt.value);
      setOpen(false);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className="w-full flex items-center justify-between rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white text-left hover:border-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        onClick={() => setOpen(o => !o)}
      >
        <span className={selected ? 'text-gray-900' : 'text-gray-400'}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="p-1.5 border-b border-gray-100">
            <input
              ref={inputRef}
              className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none"
              placeholder="Type to search…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
            />
          </div>
          <ul className="max-h-48 overflow-y-auto py-1">
            <li>
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm text-gray-500 hover:bg-gray-50"
                onClick={() => { onChange(''); setOpen(false); }}
              >
                {placeholder}
              </button>
            </li>
            {filtered.map(o => (
              <li key={o.value}>
                <button
                  type="button"
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 hover:text-indigo-700 ${String(o.value) === String(value) ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-900'}`}
                  onClick={() => { onChange(o.value); setOpen(false); }}
                >
                  {o.label}
                </button>
              </li>
            ))}
            {onAddNew && query.trim() && !filtered.some(o => o.label.toLowerCase() === query.toLowerCase()) && (
              <li>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm text-indigo-600 hover:bg-indigo-50 flex items-center gap-1.5"
                  onClick={handleAddNew}
                  disabled={adding}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {adding ? 'Adding…' : `${addNewLabel} "${query.trim()}"`}
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
