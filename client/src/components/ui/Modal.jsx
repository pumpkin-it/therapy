import { useEffect, useRef } from 'react';

const SIZES = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl', xl: 'max-w-4xl' };

// Open modals, innermost last — Escape closes only the top one (e.g. a confirm over the
// appointment window closes the confirm, not both).
const openStack = [];

export default function Modal({ title, onClose, children, wide = false, size, headerExtra, z = 'z-50' }) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const token = {};
    openStack.push(token);
    const handler = e => {
      if (e.key === 'Escape' && openStack[openStack.length - 1] === token) onCloseRef.current?.();
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      const i = openStack.indexOf(token);
      if (i !== -1) openStack.splice(i, 1);
    };
  }, []);

  const widthClass = SIZES[size] || (wide ? SIZES.lg : SIZES.md);

  return (
    <div className={`fixed inset-0 ${z} flex items-center justify-center bg-black/40 p-4`}>
      <div className={`w-full ${widthClass} max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-xl`}>
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 shrink-0">
          <h2 className="text-base font-semibold">{title}</h2>
          <div className="flex items-center gap-3">
            {headerExtra}
            {onClose && <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none" aria-label="Close">&times;</button>}
          </div>
        </div>
        <div className="px-6 py-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
