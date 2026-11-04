import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEditorState } from '@tiptap/react';
import { PAGE_GAP, paginate } from './pagination';
import { pageGeometry, DEFAULT_FOOTER, HF_SLOTS, fillSlot, todayText } from './pageSetup';
import Ruler from './Ruler';
import HeaderFooterDialog from './HeaderFooterDialog';

// Word-style pages for the report editor (and report templates): separate sheets with a gap
// between them, each with the document's header and footer. The text is one editable flow laid
// over the sheets; pagination.js works out where each page ends (using the PDF's rules) and moves
// the rest down. The page size, margins, header and footer are the document's own (pageSetup.js).
//   editor      — the TipTap editor (with the Pagination extension)
//   zoom        — 'fit' (shrink to the space, never enlarge) or a number (1 = 100%)
//   fields      — { client, title } for the header and footer fields
//   pageSetup   — true: the document has its own page setup, header and footer (saved as JSON);
//                 shows the ruler and lets the header and footer be edited (double-click them)
//   rulerTop    — keeps the ruler in view at this distance from the top when scrolling
//   onPageCount — told the number of pages
//   onScale     — told the scale the pages are shown at
//   onLaidOut   — called after each time the pages have been worked out (e.g. to scroll to a place)
export default function PagedSheet({ editor, zoom = 'fit', fields, pageSetup = false, rulerTop, onPageCount, onScale, onLaidOut, children }) {
  const areaRef = useRef(null);
  const stackRef = useRef(null);
  const doc = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const a = e?.state.doc.attrs || {};
      return { page: a.page || null, header: a.header || null, footer: a.footer || null, editable: !!e?.isEditable };
    },
    equalityFn: (a, b) => a && b && a.page === b.page && a.header === b.header && a.footer === b.footer && a.editable === b.editable,
  }) || {};
  const G = pageGeometry(doc.page);
  const [areaWidth, setAreaWidth] = useState(G.width);
  const [pages, setPages] = useState(1);
  const [hfOpen, setHfOpen] = useState(null); // 'header' | 'footer'
  const onPageCountRef = useRef(onPageCount);
  onPageCountRef.current = onPageCount;
  const onLaidOutRef = useRef(onLaidOut);
  onLaidOutRef.current = onLaidOut;

  const scale = zoom === 'fit' ? Math.min(1, areaWidth / G.width) : Number(zoom) || 1;
  useEffect(() => { onScale?.(scale); }, [scale]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return undefined;
    const ro = new ResizeObserver(() => setAreaWidth(area.clientWidth));
    ro.observe(area);
    setAreaWidth(area.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Re-work the pages shortly after the text changes, and whenever its height changes for any
  // other reason (pictures or fonts loading, a new page setup). Changing the zoom doesn't change
  // the layout.
  useEffect(() => {
    const stack = stackRef.current;
    if (!editor || !stack) return undefined;
    let timer = null;
    const run = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (editor.isDestroyed) return;
        const n = paginate(editor.view, stack);
        setPages(n);
        onPageCountRef.current?.(n);
        onLaidOutRef.current?.();
      }, 120);
    };
    editor.on('update', run);
    const content = stack.querySelector('.pg-content');
    const ro = new ResizeObserver(run);
    if (content) ro.observe(content);
    const onLoad = e => { if (e.target?.tagName === 'IMG') run(); };
    stack.addEventListener('load', onLoad, true);
    document.fonts?.ready.then(run);
    run();
    return () => { editor.off('update', run); ro.disconnect(); stack.removeEventListener('load', onLoad, true); clearTimeout(timer); };
  }, [editor]);

  // The toolbar's Layout menu opens the header/footer editor.
  useEffect(() => {
    if (!editor || !pageSetup) return undefined;
    const open = which => setHfOpen(which || 'header');
    editor.on('openHeaderFooter', open);
    return () => editor.off('openHeaderFooter', open);
  }, [editor, pageSetup]);

  const stackHeight = pages * (G.height + PAGE_GAP) - PAGE_GAP;
  const focusEnd = e => { if (e.target === e.currentTarget && editor?.isEditable) { e.preventDefault(); editor.commands.focus('end'); } };
  const header = pageSetup ? doc.header : null;
  const footer = pageSetup && doc.footer ? doc.footer : DEFAULT_FOOTER;
  const values = { client: fields?.client || '', title: fields?.title || '', date: todayText(), pages };
  const canEditHf = pageSetup && doc.editable;
  const band = (which, hf, page) => (
    <div className={`absolute inset-x-0 flex items-baseline gap-4 text-gray-500 ${canEditHf ? 'pointer-events-auto cursor-default' : ''}`}
      style={{ [which === 'header' ? 'top' : 'bottom']: HF_EDGE[which],
        paddingLeft: G.left, paddingRight: G.right, fontSize: '8pt', lineHeight: 'normal', fontFamily: 'Arial, Helvetica, sans-serif' }}
      onDoubleClick={canEditHf ? () => setHfOpen(which) : undefined}
      title={canEditHf ? `Double-click to edit the ${which}` : undefined}>
      {HF_SLOTS.map(k => (
        // With nothing in the centre, the left part may run on to the right part (as in the PDF).
        <span key={k} className={`min-w-0 truncate whitespace-pre ${k === 'center' ? 'text-center' : k === 'right' ? 'text-right' : ''}`}
          style={{ flex: hf && String(hf.center || '').trim() ? '1 1 0' : { left: '1 1 auto', center: '0 0 0', right: '0 0 auto' }[k] }}>
          {hf ? fillSlot(hf[k], { ...values, page }) : ''}
        </span>
      ))}
    </div>
  );

  return (
    <div ref={areaRef} className={`w-full ${scale * G.width > areaWidth + 1 ? 'overflow-x-auto' : ''}`}>
      {pageSetup && editor && (
        <div className={rulerTop != null ? 'sticky z-10' : ''} style={rulerTop != null ? { top: rulerTop } : undefined}>
          <div className="mx-auto mb-2" style={{ width: G.width * scale }}>
            <Ruler editor={editor} geometry={G} scale={scale} />
          </div>
        </div>
      )}
      {/* isolate: the pages' layers (text, header/footer covers) stay under the editor's sticky
          toolbar and the ruler when scrolling. */}
      <div className="isolate mx-auto" style={{ width: G.width * scale, height: stackHeight * scale }}>
        <div style={{ width: G.width, transform: scale !== 1 ? `scale(${scale})` : undefined, transformOrigin: 'top left' }}>
          <div ref={stackRef} className="pg-stack pg-on relative" style={{ width: G.width, height: stackHeight }}>
            {Array.from({ length: pages }, (_, i) => (
              <div key={i} className="pointer-events-none absolute inset-x-0 bg-white shadow-sm ring-1 ring-gray-200"
                style={{ top: i * (G.height + PAGE_GAP), height: G.height }} />
            ))}
            <div className="pg-content relative z-10" onMouseDown={focusEnd}
              style={{ padding: `${G.top}px ${G.right + G.slackX}px 0 ${G.left}px`, minHeight: stackHeight - G.top }}>
              {children}
            </div>
            {/* Page 1's header (nothing runs over its top margin). */}
            <div className="pointer-events-none absolute inset-x-0 top-0 z-20" style={{ height: G.top }}>{band('header', header, 1)}</div>
            {/* Over the text, as in Word: each page's bottom margin (with the footer), the gap and
                the next page's top margin (with its header) — anything running past a page end
                (the borders of a cell split across pages) doesn't show between the pages. */}
            {Array.from({ length: pages }, (_, i) => {
              const top = i * (G.height + PAGE_GAP) + G.height - G.bottom;
              const last = i === pages - 1;
              return (
                <div key={`m${i}`} className="pointer-events-none absolute inset-x-0 z-20"
                  style={{ top, height: last ? G.bottom : G.bottom + PAGE_GAP + G.top }}>
                  <div className="relative border-x border-b border-gray-200 bg-white" style={{ height: G.bottom, marginLeft: -1, marginRight: -1 }}>
                    {band('footer', footer, i + 1)}
                  </div>
                  {!last && <>
                    <div className="pg-gap-cover" style={{ height: PAGE_GAP }} />
                    <div className="relative border-x border-t border-gray-200 bg-white" style={{ height: G.top, marginLeft: -1, marginRight: -1 }}>
                      {band('header', header, i + 2)}
                    </div>
                  </>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {hfOpen && <HeaderFooterDialog editor={editor} which={hfOpen} fields={values} onClose={() => setHfOpen(null)} />}
    </div>
  );
}

// Where Chrome prints the header and footer in the PDF: a fixed distance from the edge of the
// page, whatever the margins (measured: the text 20px from the top and from the bottom).
const HF_EDGE = { header: 20, footer: 18.5 }; // the footer's box ends 1.5px below its text
