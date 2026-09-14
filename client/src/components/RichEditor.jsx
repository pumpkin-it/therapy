import { useEffect, useRef } from 'react';
import Quill from 'quill';
import 'quill/dist/quill.snow.css';

const TOOLBARS = {
  email: [
    ['bold', 'italic', 'underline', 'strike'],
    [{ header: [1, 2, 3, false] }],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['link'],
    ['clean'],
  ],
  note: [
    ['bold', 'italic', 'underline'],
    [{ list: 'bullet' }],
    ['clean'],
  ],
  'session-note': [
    [{ font: [] }],
    ['bold', 'italic', 'underline'],
    [{ color: [] }],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['clean'],
  ],
};

// insertRef exposes insertText(text) — used to drop a {{variable}} chip at the cursor.
// htmlRef exposes setHTML(html) — a full-content replace (e.g. applying a template), since
// defaultValue is only read once at mount and Quill owns this DOM node from then on.
export default function RichEditor({ defaultValue, onChange, insertRef, htmlRef, toolbar = 'email' }) {
  const containerRef = useRef();
  const quillRef = useRef();

  useEffect(() => {
    const quill = new Quill(containerRef.current, {
      theme: 'snow',
      modules: { toolbar: TOOLBARS[toolbar] || TOOLBARS.email },
    });

    quill.clipboard.dangerouslyPasteHTML(defaultValue || '');

    quill.on('text-change', () => {
      // Quill wraps even empty editors with <p><br></p> — treat as empty
      const html = quill.root.innerHTML;
      onChange(html === '<p><br></p>' ? '' : html);
    });

    quillRef.current = quill;
    return () => {
      quill.off('text-change');
      // Quill's snow theme inserts the toolbar as a sibling before the container and mutates
      // the container itself (adds .ql-container, child nodes, etc). Without undoing that, a
      // remount of this effect (e.g. React StrictMode's dev double-invoke) re-runs `new Quill()`
      // on top of the leftover DOM and produces a duplicate toolbar.
      const toolbarEl = containerRef.current?.previousElementSibling;
      if (toolbarEl?.classList.contains('ql-toolbar')) toolbarEl.remove();
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
        containerRef.current.removeAttribute('class');
      }
    };
  }, []); // intentionally empty — Quill owns this DOM node

  // Expose variable insertion to parent via ref
  if (insertRef) {
    insertRef.current = text => {
      const quill = quillRef.current;
      if (!quill) return;
      const range = quill.getSelection(true);
      quill.insertText(range ? range.index : quill.getLength() - 1, text, 'user');
    };
  }

  // Expose a full-content replace to parent via ref (e.g. applying a template mid-edit)
  if (htmlRef) {
    htmlRef.current = html => {
      const quill = quillRef.current;
      if (!quill) return;
      quill.setText('');
      quill.clipboard.dangerouslyPasteHTML(0, html || '', 'user');
    };
  }

  return (
    <div className="quill-wrapper rounded-lg overflow-hidden border border-gray-300 focus-within:border-indigo-500 transition-colors">
      <div ref={containerRef} />
    </div>
  );
}
