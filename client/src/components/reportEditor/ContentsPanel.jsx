import { useEffect, useState } from 'react';
import { ListTree } from 'lucide-react';
import { revealPos } from './reveal';

// The report's headings (Heading 1–3 from the style menu), for jumping between sections. The
// section the cursor is in is highlighted.
function headingsOf(editor) {
  const out = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') { out.push({ pos, level: node.attrs.level, text: node.textContent.trim() || '(empty heading)' }); return false; }
    return !node.isTextblock;
  });
  return out;
}

export default function ContentsPanel({ editor }) {
  const [heads, setHeads] = useState(() => (editor ? headingsOf(editor) : []));
  const [cursor, setCursor] = useState(0);
  useEffect(() => {
    if (!editor) return undefined;
    let timer = null;
    const update = () => { clearTimeout(timer); timer = setTimeout(() => setHeads(headingsOf(editor)), 200); };
    const moved = () => setCursor(editor.state.selection.head);
    editor.on('update', update); editor.on('selectionUpdate', moved);
    update(); moved();
    return () => { editor.off('update', update); editor.off('selectionUpdate', moved); clearTimeout(timer); };
  }, [editor]);

  const currentIdx = heads.reduce((idx, h, i) => (h.pos <= cursor ? i : idx), -1);
  // The heading goes just under the pinned toolbar, whichever way the jump is.
  const go = h => { editor.chain().focus().setTextSelection(h.pos + 1).run(); revealPos(editor.view, h.pos + 1, 'top'); };

  return (
    <nav className="space-y-0.5 text-sm">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500"><ListTree className="h-3.5 w-3.5" /> Contents</p>
      {heads.length === 0 && <p className="text-xs leading-relaxed text-gray-400">No headings yet. Use Heading 1, 2 or 3 from the style menu (where it says “Normal”) for section titles and they’ll be listed here.</p>}
      {heads.map((h, i) => (
        <button key={h.pos} type="button" onClick={() => go(h)} title={h.text}
          className={`block w-full truncate rounded px-2 py-1 text-left ${i === currentIdx ? 'bg-indigo-50 font-medium text-indigo-700' : 'text-gray-700 hover:bg-gray-100'}`}
          style={{ paddingLeft: 8 + (h.level - 1) * 12 }}>
          {h.text}
        </button>
      ))}
    </nav>
  );
}
