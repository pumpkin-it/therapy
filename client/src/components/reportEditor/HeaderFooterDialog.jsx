import { useRef, useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { DEFAULT_FOOTER, HF_FIELDS, HF_SLOTS, fillSlot } from './pageSetup';

// Word's Header & Footer: the text at the top and bottom of every page, in three parts (left,
// centre, right), with fields that fill in on each page — page number, number of pages, client,
// report title, date. Saved with the document (doc attributes header / footer, pageSetup.js), so
// a report started from a template gets the template's header and footer.
const LABELS = { left: 'Left', center: 'Centre', right: 'Right' };
const blank = { left: '', center: '', right: '' };

export default function HeaderFooterDialog({ editor, which: initial, fields, onClose }) {
  const attrs = editor.state.doc.attrs;
  const [which, setWhich] = useState(initial);
  const [values, setValues] = useState({
    header: { ...blank, ...(attrs.header || {}) },
    footer: { ...blank, ...(attrs.footer || DEFAULT_FOOTER) },
  });
  const focused = useRef({ slot: 'left', el: null });
  const cur = values[which];
  const set = (slot, text) => setValues(v => ({ ...v, [which]: { ...v[which], [slot]: text } }));

  // Puts a field where the cursor was in the last box used.
  const insert = token => {
    const { slot, el } = focused.current;
    const text = cur[slot] || '';
    const at = el && el.dataset.slot === slot && el.dataset.which === which ? el.selectionStart : text.length;
    const end = el && el.dataset.slot === slot && el.dataset.which === which ? el.selectionEnd : at;
    set(slot, text.slice(0, at) + token + text.slice(end));
    requestAnimationFrame(() => { if (el && el.dataset.which === which) { el.focus(); el.setSelectionRange(at + token.length, at + token.length); } });
  };

  const save = () => {
    const tidy = hf => Object.fromEntries(HF_SLOTS.map(k => [k, String(hf[k] || '').replace(/\s+/g, ' ').trim().slice(0, 200)]));
    const header = tidy(values.header), footer = tidy(values.footer);
    const isDefault = HF_SLOTS.every(k => footer[k] === DEFAULT_FOOTER[k]);
    editor.chain().setHeaderFooter('header', HF_SLOTS.some(k => header[k]) ? header : null)
      .setHeaderFooter('footer', isDefault ? null : footer).run();
    onClose();
  };

  const preview = { ...fields, page: 1 };
  return (
    <Modal title="Header & footer" onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
          {['header', 'footer'].map(w => (
            <button key={w} onClick={() => setWhich(w)}
              className={`flex-1 rounded-md px-3 py-1.5 font-medium ${which === w ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600 hover:text-gray-900'}`}>
              {w === 'header' ? 'Header' : 'Footer'}
            </button>
          ))}
        </div>
        <p className="text-gray-600">
          Shown at the {which === 'header' ? 'top' : 'bottom'} of every page, here and in the PDF. Click into a box, then add a field — it fills in on each page.
        </p>
        <div className="grid grid-cols-3 gap-2">
          {HF_SLOTS.map(slot => (
            <label key={`${which}-${slot}`} className="space-y-1">
              <span className="block text-xs font-medium text-gray-600">{LABELS[slot]}</span>
              <input value={cur[slot]} data-slot={slot} data-which={which} maxLength={200}
                onChange={e => set(slot, e.target.value)}
                onFocus={e => { focused.current = { slot, el: e.target }; }}
                onSelect={e => { focused.current = { slot, el: e.target }; }}
                className={`block w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${slot === 'center' ? 'text-center' : slot === 'right' ? 'text-right' : ''}`} />
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium text-gray-600">Add a field:</span>
          {HF_FIELDS.map(f => (
            <button key={f.token} onMouseDown={e => e.preventDefault()} onClick={() => insert(f.token)}
              className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100">
              {f.label}
            </button>
          ))}
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-gray-600">Page 1 will show</span>
          <div className="flex gap-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-gray-600" style={{ fontSize: '8pt', fontFamily: 'Arial, Helvetica, sans-serif' }}>
            {HF_SLOTS.map(k => (
              <span key={k} className={`min-w-0 flex-1 truncate whitespace-pre ${k === 'center' ? 'text-center' : k === 'right' ? 'text-right' : ''}`}>
                {fillSlot(cur[k], preview) || ' '}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setValues(v => ({ ...v, [which]: { ...blank } }))}>Clear the {which}</Button>
            {which === 'footer' && <Button size="sm" variant="ghost" onClick={() => setValues(v => ({ ...v, footer: { ...DEFAULT_FOOTER } }))}>Standard footer</Button>}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={save}>Save</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
