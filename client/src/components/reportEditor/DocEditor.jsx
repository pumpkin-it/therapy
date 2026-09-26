import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EditorContent } from '@tiptap/react';
import { Maximize2, Minimize2 } from 'lucide-react';
import Toolbar from './Toolbar';
import PageGuides, { PAGE } from './PageGuides';
import useDocEditor from './useDocEditor';
import { toEditorHtml, fromEditor } from './docHtml';

// The Word-style editor for everything stored as HTML: session notes, and session-note, agreement
// and email templates. Same editor, fonts and toolbar as written reports (useDocEditor).
//
//   value      — the stored HTML to start from (read once, like a defaultValue; remount with a
//                `key` to load something else, or use apiRef.current.setHTML)
//   onChange   — called with the HTML on every change ('' when empty)
//   layout     — 'page': an A4 sheet with page guides and a page count, shrunk to fit the space
//                available, with an Expand button to write full size. 'plain': a box (emails).
//   vars       — template variable keys for the Insert field menu (templates only)
//   uploadUrl  — where pictures are uploaded; without one, pictures can't be added
//   apiRef     — gets { setHTML(html), focus() }
//   htmlRef    — gets setHTML itself (the old RichEditor's htmlRef, used to apply a template or clear)
export default function DocEditor({ value, onChange, layout = 'page', vars = null, uploadUrl = null, placeholder, apiRef, htmlRef, maxHeight = 520 }) {
  const isPage = layout === 'page';
  const [notice, setNotice] = useState('');
  const [pages, setPages] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const [scale, setScale] = useState(1);
  const [sheetHeight, setSheetHeight] = useState(PAGE.height);
  const loadedRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const fileInputRef = useRef();
  const areaRef = useRef();
  const sheetRef = useRef();

  const onUpdate = useCallback(ed => { if (loadedRef.current) onChangeRef.current?.(fromEditor(ed)); }, []);
  const { editor, uploadImages } = useDocEditor({
    uploadUrl, onUpdate, onNotice: setNotice, placeholder: placeholder || 'Start writing…',
    templateVars: !!vars, editable: true, pageBreaks: isPage,
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed || loadedRef.current) return;
    editor.commands.setContent(toEditorHtml(value, { vars: !!vars }), { emitUpdate: false });
    loadedRef.current = true;
  }, [editor]); // value is read once, like a defaultValue

  const setHTML = html => editor?.commands.setContent(toEditorHtml(html, { vars: !!vars }), { emitUpdate: true });
  if (apiRef) apiRef.current = { setHTML, focus: () => editor?.commands.focus('end') };
  if (htmlRef) htmlRef.current = setHTML;

  // Page layout: fit the A4 sheet to the width available (the appointment window is narrower than
  // a page) by scaling it — lines wrap exactly as they will in the PDF either way.
  useLayoutEffect(() => {
    if (!isPage) return;
    const area = areaRef.current, sheet = sheetRef.current;
    if (!area || !sheet) return;
    const measure = () => {
      setScale(Math.min(1, (area.clientWidth - 32) / PAGE.width));
      setSheetHeight(sheet.offsetHeight);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(area);
    ro.observe(sheet);
    measure();
    return () => ro.disconnect();
  }, [isPage, expanded]);

  // Expanded fills the window; Escape shrinks it back rather than closing the window underneath.
  useEffect(() => {
    if (!expanded) return;
    const onKey = e => { if (e.key === 'Escape') { e.stopImmediatePropagation(); setExpanded(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [expanded]);

  const toolbar = editor && (
    <Toolbar editor={editor} vars={vars} noFields={!vars} pageBreaks={isPage}
      onPickImage={uploadUrl ? () => fileInputRef.current.click() : undefined} />
  );
  const noticeBar = notice && (
    <div className="flex items-start gap-3 border-b border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
      <span className="flex-1">{notice}</span>
      <button type="button" className="text-blue-700 hover:text-blue-900" onClick={() => setNotice('')}>Dismiss</button>
    </div>
  );
  const fileInput = uploadUrl && (
    <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple className="hidden"
      onChange={e => { const files = [...e.target.files]; e.target.value = ''; uploadImages(files); }} />
  );

  if (!isPage) {
    return (
      <div className="doc-plain overflow-hidden rounded-lg border border-gray-300 bg-white focus-within:border-indigo-500">
        {toolbar}
        {noticeBar}
        {fileInput}
        <div className="px-4 py-3"><EditorContent editor={editor} /></div>
      </div>
    );
  }

  return (
    <div className={expanded
      ? 'fixed inset-0 z-[55] flex flex-col bg-gray-100'
      : 'overflow-hidden rounded-lg border border-gray-300 bg-gray-100'}>
      <div className={expanded ? 'shadow-sm' : ''}>{toolbar}</div>
      {noticeBar}
      {fileInput}
      <div ref={areaRef} className={`overflow-auto px-4 py-4 ${expanded ? 'flex-1' : ''}`} style={expanded ? undefined : { maxHeight }}>
        <div className="mx-auto" style={{ width: PAGE.width * scale, height: sheetHeight * scale }}>
          <div style={{ width: PAGE.width, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
            <div ref={sheetRef} className="doc-page relative bg-white shadow-sm ring-1 ring-gray-200"
              style={{ width: PAGE.width, minHeight: PAGE.height, padding: PAGE.margin }}>
              <PageGuides editor={editor} sheetRef={sheetRef} onPageCount={setPages} />
              <div className="relative"><EditorContent editor={editor} /></div>
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-500">
        <span>{pages} page{pages === 1 ? '' : 's'}{scale < 0.99 ? ` · shown at ${Math.round(scale * 100)}%` : ''}</span>
        <button type="button" className="inline-flex items-center gap-1 rounded px-2 py-1 font-medium text-gray-700 hover:bg-gray-100"
          onMouseDown={e => e.preventDefault()} onClick={() => setExpanded(x => !x)}>
          {expanded ? <><Minimize2 className="h-3.5 w-3.5" /> Done</> : <><Maximize2 className="h-3.5 w-3.5" /> Expand</>}
        </button>
      </div>
    </div>
  );
}
