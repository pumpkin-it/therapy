import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PAGE } from './PageGuides';
import { PAGE_GAP, paginate } from './pagination';

// Word-style pages for the report editor (and report templates): separate A4 sheets with a gap
// between them, each with the PDF's footer. The text is one editable flow laid over the sheets;
// pagination.js works out where each page ends (using the PDF's rules) and moves the rest down.
//   editor      — the TipTap editor (with the Pagination extension)
//   zoom        — 'fit' (shrink to the space, never enlarge) or a number (1 = 100%)
//   footer      — { left } text shown bottom-left of every page (the PDF shows client · title)
//   onPageCount — told the number of pages
//   onScale     — told the scale the pages are shown at
//   onLaidOut   — called after each time the pages have been worked out (e.g. to scroll to a place)
export default function PagedSheet({ editor, zoom = 'fit', footer, onPageCount, onScale, onLaidOut, children }) {
  const areaRef = useRef(null);
  const stackRef = useRef(null);
  const [areaWidth, setAreaWidth] = useState(PAGE.width);
  const [pages, setPages] = useState(1);
  const onPageCountRef = useRef(onPageCount);
  onPageCountRef.current = onPageCount;
  const onLaidOutRef = useRef(onLaidOut);
  onLaidOutRef.current = onLaidOut;

  const scale = zoom === 'fit' ? Math.min(1, areaWidth / PAGE.width) : Number(zoom) || 1;
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
  // other reason (pictures or fonts loading). Changing the zoom doesn't change the layout.
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

  const stackHeight = pages * (PAGE.height + PAGE_GAP) - PAGE_GAP;
  const focusEnd = e => { if (e.target === e.currentTarget && editor?.isEditable) { e.preventDefault(); editor.commands.focus('end'); } };

  return (
    <div ref={areaRef} className={`w-full ${scale * PAGE.width > areaWidth + 1 ? 'overflow-x-auto' : ''}`}>
      <div className="mx-auto" style={{ width: PAGE.width * scale, height: stackHeight * scale }}>
        <div style={{ width: PAGE.width, transform: scale !== 1 ? `scale(${scale})` : undefined, transformOrigin: 'top left' }}>
          <div ref={stackRef} className="pg-stack pg-on relative" style={{ width: PAGE.width, height: stackHeight }}>
            {Array.from({ length: pages }, (_, i) => (
              <div key={i} className="pointer-events-none absolute inset-x-0 bg-white shadow-sm ring-1 ring-gray-200"
                style={{ top: i * (PAGE.height + PAGE_GAP), height: PAGE.height }}>
                <div className="absolute inset-x-0 flex justify-between text-gray-500"
                  style={{ bottom: PAGE.margin / 2 - 6, paddingLeft: PAGE.margin, paddingRight: PAGE.margin, fontSize: '8pt', fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  <span className="truncate">{footer?.left || ''}</span>
                  <span>Page {i + 1} of {pages}</span>
                </div>
              </div>
            ))}
            <div className="pg-content relative z-10" onMouseDown={focusEnd}
              style={{ padding: `${PAGE.margin}px ${PAGE.margin}px 0`, minHeight: stackHeight - PAGE.margin }}>
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
