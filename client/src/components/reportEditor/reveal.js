// Loading a document into the editor without it becoming an undo step — otherwise pressing undo
// enough times empties the editor (and autosave would save the empty report).
export function loadContent(editor, content) {
  return editor.chain()
    .command(({ tr }) => { tr.setMeta('addToHistory', false); return true; })
    .setContent(content, { emitUpdate: false })
    .run();
}

// The element the editor page scrolls in (the app's main area), and the height of the editor's
// pinned header (marked data-editor-header), so a position can be shown below it rather than
// hidden under it.
function scroller(el) {
  for (let n = el?.parentElement; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return document.scrollingElement;
}

// Scrolls so document position `pos` is in view: 'top' puts it just under the pinned header (a
// heading jumped to from Contents), 'center' in the middle of what's visible (a find match, or the
// place a report was left). Works for positions far off screen and while focus is elsewhere.
export function revealPos(view, pos, where = 'center') {
  if (!view || view.isDestroyed) return;
  let rect;
  try { rect = view.coordsAtPos(Math.max(0, Math.min(pos, view.state.doc.content.size))); } catch { return; }
  const box = scroller(view.dom);
  const boxTop = box === document.scrollingElement ? 0 : box.getBoundingClientRect().top;
  const header = document.querySelector('[data-editor-header]');
  const headerBottom = header ? header.getBoundingClientRect().bottom : boxTop;
  const visibleTop = Math.max(boxTop, headerBottom);
  const visibleH = (box === document.scrollingElement ? window.innerHeight : box.getBoundingClientRect().bottom) - visibleTop;
  const target = where === 'top' ? visibleTop + 24 : visibleTop + visibleH / 2;
  box.scrollTop += rect.top - target;
}
