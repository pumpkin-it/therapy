import { useEffect, useState } from 'react';

// A4 at 96dpi, with the margins the PDF will use. The editor's page is laid out with exactly these
// numbers (see ReportEditor.jsx) so the guides land where the PDF's pages will break — give or take
// a line where a paragraph, picture or table row sits right on the edge.
export const PAGE = { width: 794, height: 1123, margin: 72 };
const CONTENT_HEIGHT = PAGE.height - PAGE.margin * 2;

// Where each page ends, in the sheet's own coordinates. Content flows from one page to the next;
// a manual page break ends the current page early (its own dashed line is already shown, so no
// extra guide is drawn for it).
function computeGuides(sheet) {
  const pm = sheet.querySelector('.ProseMirror');
  if (!pm) return { guides: [], pages: 1 };
  // The sheet may be shown scaled down (a note in the appointment window) — measure in the
  // sheet's own, unscaled coordinates.
  const rect = sheet.getBoundingClientRect();
  const k = sheet.offsetHeight ? rect.height / sheet.offsetHeight : 1;
  const breaks = [...pm.querySelectorAll(':scope > .page-break')].map(el => (el.getBoundingClientRect().bottom - rect.top) / k);
  const end = (pm.getBoundingClientRect().bottom - rect.top) / k;
  const guides = [];
  let pageStart = PAGE.margin, pages = 1, b = 0;
  for (let guard = 0; guard < 500; guard++) {
    const naturalEnd = pageStart + CONTENT_HEIGHT;
    if (b < breaks.length && breaks[b] <= naturalEnd) { pageStart = breaks[b++]; pages++; continue; }
    if (naturalEnd >= end) break;
    pages++;
    guides.push({ y: naturalEnd, page: pages });
    pageStart = naturalEnd;
  }
  return { guides, pages };
}

export default function PageGuides({ editor, sheetRef, onPageCount }) {
  const [guides, setGuides] = useState([]);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!editor || !sheet) return;
    let timer = null;
    const update = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const r = computeGuides(sheet);
        setGuides(r.guides);
        onPageCount?.(r.pages);
      }, 60);
    };
    // Re-measure whenever the document or anything that changes its height does (images loading,
    // fonts, window size). The sheet itself is watched, not the editor element — the editor
    // attaches that after this runs — and it grows and shrinks with the document.
    const ro = new ResizeObserver(update);
    ro.observe(sheet);
    editor.on('update', update);
    update();
    return () => { ro.disconnect(); editor.off('update', update); clearTimeout(timer); };
  }, [editor, sheetRef, onPageCount]);

  return guides.map(g => (
    <div key={g.page} className="pointer-events-none absolute inset-x-0 z-0" style={{ top: g.y }}>
      <div className="border-t border-dashed border-sky-300" />
      <span className="absolute -top-2.5 left-full ml-2 whitespace-nowrap rounded bg-sky-50 px-1.5 text-[10px] font-medium text-sky-700 ring-1 ring-sky-200">
        Page {g.page}
      </span>
    </div>
  ));
}
