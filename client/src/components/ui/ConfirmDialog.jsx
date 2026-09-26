import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import Modal from './Modal';
import Button from './Button';

// In-app replacement for window.confirm / prompt / alert, so every "are you sure?" looks like the
// rest of the app. Usage:
//   const confirm = useConfirm();
//   if (!await confirm({ title: 'Delete note', message: 'Delete this note?', confirmLabel: 'Delete', danger: true })) return;
//   const reason = await confirm({ title: 'Void entry', input: { label: 'Reason', required: true } }); // string, or null if cancelled
//   await confirm({ title: 'Name needed', message: 'Give this form a name first.', alert: true });   // OK button only
// Options: title, message (line breaks kept), confirmLabel, cancelLabel, danger (red button),
// input { label, placeholder, defaultValue, required, multiline }, alert.

const ConfirmContext = createContext(null);

function ConfirmWindow({ req, done }) {
  const [value, setValue] = useState(req.input?.defaultValue || '');
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const cancel = () => done(req.input ? null : false);
  const ok = () => {
    if (req.input) {
      if (req.input.required && !value.trim()) return;
      done(value.trim());
    } else done(true);
  };
  const inputCls = 'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';

  return (
    <Modal title={req.title || (req.alert ? 'Notice' : 'Are you sure?')} onClose={cancel} size="sm" z="z-[60]">
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); ok(); }}>
        {req.message && <p className="whitespace-pre-line text-sm text-gray-700">{req.message}</p>}
        {req.input && (
          <div className="space-y-1">
            {req.input.label && <label className="block text-sm font-medium text-gray-700">{req.input.label}</label>}
            {req.input.multiline
              ? <textarea ref={inputRef} rows={3} className={inputCls} value={value} placeholder={req.input.placeholder} onChange={e => setValue(e.target.value)} />
              : <input ref={inputRef} className={inputCls} value={value} placeholder={req.input.placeholder} onChange={e => setValue(e.target.value)} />}
          </div>
        )}
        <div className="flex justify-end gap-2">
          {!req.alert && <Button type="button" variant="secondary" size="sm" onClick={cancel}>{req.cancelLabel || 'Cancel'}</Button>}
          <Button type="submit" size="sm" variant={req.danger ? 'danger' : 'primary'} autoFocus={!req.input}
            disabled={!!req.input?.required && !value.trim()}>
            {req.confirmLabel || (req.alert ? 'OK' : 'Confirm')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ConfirmProvider({ children }) {
  const [queue, setQueue] = useState([]);
  const ask = useCallback(opts => new Promise(resolve => {
    setQueue(q => [...q, { ...(typeof opts === 'string' ? { message: opts } : opts), resolve, id: Math.random() }]);
  }), []);
  const current = queue[0];
  const done = result => { current.resolve(result); setQueue(q => q.slice(1)); };

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {current && <ConfirmWindow key={current.id} req={current} done={done} />}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext);
}
