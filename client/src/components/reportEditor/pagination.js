import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { PAGE } from './PageGuides';

// Word-style pages for the report editor. The document stays one editable flow; where a page ends,
// a gap is added (a decoration — never saved in the document) so the next line starts at the top
// of the next sheet. PagedSheet.jsx draws the sheets behind the text.
//
// Where pages end follows the same rules Chrome uses when it prints the PDF (docPdf.js), so the
// editor's page 4 is the PDF's page 4:
//   - a line, table row (tr break-inside: avoid) or picture is never cut — it moves to the next page;
//   - at least two lines of a paragraph stay together at the bottom and the top of a page
//     (orphans/widows 2);
//   - a heading isn't left alone at the bottom of a page (h1–h3 break-after: avoid);
//   - a manual page break (Ctrl+Enter) starts a new page.
// The margin above a block that moves to a new page is dropped, as Chrome does.

export const PAGE_GAP = 24; // grey gap between sheets, in page pixels
const CONTENT = PAGE.height - PAGE.margin * 2;
const pageTop = p => p * (PAGE.height + PAGE_GAP) + PAGE.margin;
const pageBottom = p => pageTop(p) + CONTENT;

export const paginationKey = new PluginKey('pagination');

export const Pagination = Extension.create({
  name: 'pagination',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: paginationKey,
      state: {
        init: () => ({ decos: DecorationSet.empty, breaks: [] }),
        apply(tr, value) {
          const meta = tr.getMeta(paginationKey);
          if (meta) return meta;
          // Until the next measurement, keep the gaps attached to the text they were before.
          return tr.docChanged ? { ...value, decos: value.decos.map(tr.mapping, tr.doc) } : value;
        },
      },
      props: { decorations: state => paginationKey.getState(state)?.decos },
    })];
  },
});

// The lines of one paragraph/heading, top to bottom, in the stack's (unscaled) coordinates.
// A line's box is its text's height widened to the paragraph's line-height (text rects only cover
// the letters, not the line spacing the PDF lays out).
function linesOf(view, pos, node, toY) {
  const dom = view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) return [];
  const lh = parseFloat(getComputedStyle(dom).lineHeight) || 0;
  const range = document.createRange();
  range.selectNodeContents(dom);
  const rects = [...range.getClientRects()].filter(r => r.height > 0).sort((a, b) => a.top - b.top);
  const lines = [];
  for (const r of rects) {
    const top = toY(r.top), bottom = toY(r.bottom), left = r.left;
    const last = lines[lines.length - 1];
    if (last && top < last.bottom - 1) {
      last.bottom = Math.max(last.bottom, bottom); last.top = Math.min(last.top, top);
      if (left < last.left) { last.left = left; last.mid = (r.top + r.bottom) / 2; }
    } else lines.push({ top, bottom, left, mid: (r.top + r.bottom) / 2 });
  }
  if (!lines.length) {
    const r = dom.getBoundingClientRect();
    return [{ top: toY(r.top), bottom: toY(r.bottom), pos: pos + 1 }];
  }
  return lines.map((l, i) => {
    const centre = (l.top + l.bottom) / 2;
    const half = Math.max((l.bottom - l.top) / 2, lh / 2);
    return { top: centre - half, bottom: centre + half, pos: i === 0 ? pos + 1 : null, clientMid: l.mid };
  });
}

// The document position where a line starts: the first letter (or picture/field) whose box is on
// that line. Measured from the text itself, so it works for lines scrolled out of view too.
const ATOM_SELECTOR = 'img, .client-field, .practice-logo, [data-resize-container]';
function lineStartPos(view, blockPos, node, clientMid) {
  const dom = view.nodeDOM(blockPos);
  if (!(dom instanceof HTMLElement)) return null;
  const range = document.createRange();
  const onOrAfter = rect => rect && rect.height > 0 && rect.bottom > clientMid;
  const walker = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: n => {
      if (n.nodeType === Node.ELEMENT_NODE) {
        if (n.matches?.('.pg-gap-line')) return NodeFilter.FILTER_REJECT;
        return n.matches?.(ATOM_SELECTOR) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
      return n.textContent ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.ELEMENT_NODE) {
      if (onOrAfter(n.getBoundingClientRect())) {
        try { return view.posAtDOM(n, 0); } catch { return null; }
      }
      continue;
    }
    const len = n.textContent.length;
    const charRect = i => { range.setStart(n, i); range.setEnd(n, i + 1); return range.getBoundingClientRect(); };
    if (!onOrAfter(charRect(len - 1))) continue;
    // First character on or below the line (characters run top to bottom, so binary search).
    let lo = 0, hi = len - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (onOrAfter(charRect(mid))) hi = mid; else lo = mid + 1; }
    try {
      const at = view.posAtDOM(n, lo);
      return Math.max(blockPos + 1, Math.min(at, blockPos + node.nodeSize - 1));
    } catch { return null; }
  }
  return null;
}

// Everything that can't be split, in document (= reading) order.
function measureUnits(view, toY) {
  const units = [];
  view.state.doc.descendants((node, pos) => {
    const name = node.type.name;
    if (name === 'table') {
      node.forEach((row, offset) => {
        const rowPos = pos + 1 + offset;
        const dom = view.nodeDOM(rowPos);
        if (!(dom instanceof HTMLElement)) return;
        const r = dom.getBoundingClientRect();
        units.push({ kind: 'row', pos: rowPos, top: toY(r.top), bottom: toY(r.bottom), cols: row.childCount, first: offset === 0 });
      });
      return false;
    }
    if (name === 'pageBreak') { units.push({ kind: 'forced', pos }); return false; }
    if (node.isTextblock) {
      const lines = linesOf(view, pos, node, toY);
      lines.forEach((l, i) => units.push({ kind: 'line', block: pos, index: i, count: lines.length, heading: name === 'heading', ...l }));
      return false;
    }
    if (node.isBlock && node.isAtom) {
      const dom = view.nodeDOM(pos);
      if (dom instanceof HTMLElement) { const r = dom.getBoundingClientRect(); units.push({ kind: 'block', block: pos, index: 0, pos, top: toY(r.top), bottom: toY(r.bottom) }); }
      return false;
    }
    return true;
  });
  return units;
}

// Which units start a new page, and how far each has to move down.
// marginOf(unit): the top margin a block keeps at the top of a page after a manual page break
// (Chrome keeps it there, but drops it after an automatic break).
function planBreaks(units, marginOf) {
  const breaks = [];
  let shift = 0, page = 0, forced = false;
  const real = units;
  for (let i = 0; i < real.length; i++) {
    const u = real[i];
    if (u.kind === 'forced') { forced = true; continue; }
    const top = u.top + shift, bottom = u.bottom + shift;
    let breakAt = -1, afterForced = false;
    if (forced) { forced = false; afterForced = true; if (top > pageTop(page) + 0.5) breakAt = i; }
    else if (bottom > pageBottom(page) + 0.5 && top > pageTop(page) + 0.5) {
      breakAt = i;
      if (u.kind === 'line' && u.count > 1) {
        const k = u.index, n = u.count;
        if (k === 1) breakAt = i - 1;                                   // don't leave one line behind
        else if (n - k === 1 && k >= 2) breakAt = k - 1 >= 2 ? i - 1 : i - k; // don't carry one line over
      }
      // Keep a heading with what follows it.
      const first = real[breakAt];
      if (first && (first.index === 0 || (first.kind === 'row' && first.first))) {
        const prev = real[breakAt - 1];
        if (prev && prev.kind === 'line' && prev.heading && prev.index === prev.count - 1) {
          const headStart = breakAt - prev.count;
          if (real[headStart] && real[headStart].top + shift > pageTop(page) + 0.5) breakAt = headStart;
        }
      }
    }
    if (breakAt >= 0) {
      const b = real[breakAt];
      page++;
      const offset = afterForced && breakAt === i ? marginOf(b) : 0;
      const move = pageTop(page) + offset - (b.top + shift);
      shift += move;
      breaks.push({ unit: b, move, page, offset });
      i = breakAt; // carry on from the unit that now starts the page
    }
    // A row or picture taller than a whole page can't fit anywhere; it runs on past the page end
    // and the pages it covers are counted.
    const end = real[i].bottom + shift;
    while (end > pageBottom(page) + PAGE.margin * 2 + PAGE_GAP) page++;
  }
  const last = [...real].reverse().find(u => u.kind !== 'forced');
  let pages = page + 1;
  if (last) while (last.bottom + shift > pageBottom(pages - 1) + PAGE.margin + PAGE_GAP) pages++;
  return { breaks, pages };
}

// The block whose top margin moves a whole paragraph down: the paragraph itself, or the list /
// list item / quote it starts.
function outerBlock(doc, blockPos) {
  const $p = doc.resolve(blockPos);
  let target = blockPos;
  for (let d = $p.depth; d >= 1; d--) {
    if ($p.index(d) !== 0) break;
    target = $p.before(d);
  }
  return target;
}

function buildDecos(doc, breaks) {
  const decos = [];
  for (const b of breaks) {
    const u = b.unit, size = Math.max(0, Math.round(b.size * 100) / 100);
    if (u.kind === 'row') {
      decos.push(Decoration.widget(u.pos, () => {
        const tr = document.createElement('tr'); tr.className = 'pg-gap-row'; tr.contentEditable = 'false';
        const td = document.createElement('td'); td.colSpan = Math.max(1, u.cols || 1); td.style.height = `${size}px`;
        tr.appendChild(td); return tr;
      }, { side: -1, key: `pgr-${u.pos}-${size}`, ignoreSelection: true }));
    } else if (u.index === 0) {
      const at = outerBlock(doc, u.block);
      const node = doc.nodeAt(at);
      if (node) decos.push(Decoration.node(at, at + node.nodeSize, { class: 'pg-break-block', style: `--pg-mt: ${size}px` }));
    } else {
      decos.push(Decoration.widget(u.pos, () => {
        const s = document.createElement('span'); s.className = 'pg-gap-line'; s.contentEditable = 'false'; s.style.height = `${size}px`; s.dataset.pg = String(u.pos); return s;
      }, { side: -1, key: `pgl-${u.pos}-${size}`, ignoreSelection: true }));
    }
  }
  return DecorationSet.create(doc, decos);
}

// Which units start pages (not how big the gaps are — those are corrected after measuring).
const signature = breaks => breaks.map(b => `${b.unit.kind}:${b.unit.pos}:${b.unit.block ?? ''}:${b.page}`).join('|');

// Works out the pages and applies the gaps. stack = the element the sheets are drawn in (its top is
// the top of page 1). Returns the number of pages.
export function paginate(view, stack) {
  if (!view || view.isDestroyed || !stack) return 1;
  const k = stack.offsetWidth ? stack.getBoundingClientRect().width / stack.offsetWidth : 1;
  const toY = clientY => (clientY - stack.getBoundingClientRect().top) / k;

  // 1. The natural layout, with no gaps (all in one task, so nothing is painted in between).
  stack.classList.remove('pg-on');
  const units = measureUnits(view, toY);
  const marginOf = u => {
    if (u.kind === 'row') return 0;
    const dom = view.nodeDOM(outerBlock(view.state.doc, u.block));
    return dom instanceof HTMLElement ? parseFloat(getComputedStyle(dom).marginTop) || 0 : 0;
  };
  const plan = planBreaks(units, marginOf);
  // Where each line that starts a page begins (only these need working out).
  plan.breaks = plan.breaks.filter(b => {
    const u = b.unit;
    if (u.kind !== 'line' || u.index === 0) return true;
    const node = view.state.doc.nodeAt(u.block);
    u.pos = node ? lineStartPos(view, u.block, node, u.clientMid) : null;
    return u.pos != null;
  });

  // First guess at each gap: the distance to move, plus the margin a moved block already had (its
  // margin is replaced by the gap). Then measure and correct whatever margins collapsing changed.
  for (const b of plan.breaks) {
    b.size = b.move;
    if (b.unit.kind !== 'row' && b.unit.index === 0) b.size = b.move + marginOf(b.unit);
  }
  const current = paginationKey.getState(view.state);
  const apply = breaks => {
    view.dispatch(view.state.tr.setMeta(paginationKey, { decos: buildDecos(view.state.doc, breaks), breaks }).setMeta('addToHistory', false));
  };
  // Same pages as before: keep the gaps already shown (their sizes were corrected last time);
  // the correction below still fixes them if lines above have changed height.
  if (signature(plan.breaks) !== signature(current?.breaks || [])) apply(plan.breaks);
  stack.classList.add('pg-on');

  // 2. Correct each gap so the line/row it moves lands exactly on the top of its page.
  const shown = paginationKey.getState(view.state)?.breaks || [];
  let carried = 0, changed = false;
  for (const b of shown) {
    const u = b.unit;
    let top = null;
    if (u.kind === 'row') { const d = view.nodeDOM(u.pos); if (d instanceof HTMLElement) top = toY(d.getBoundingClientRect().top); }
    else if (u.index > 0) {
      // The line after an in-paragraph gap starts where the gap ends.
      const gap = view.dom.querySelector(`.pg-gap-line[data-pg="${u.pos}"]`);
      if (gap) top = toY(gap.getBoundingClientRect().bottom);
    } else {
      const node = view.state.doc.nodeAt(u.block);
      const lines = node ? linesOf(view, u.block, node, toY) : [];
      if (lines[0]) top = lines[0].top;
    }
    if (top == null) continue;
    const delta = pageTop(b.page) + (b.offset || 0) - (top + carried);
    if (Math.abs(delta) > 0.5) { b.size = Math.max(0, b.size + delta); carried += delta; changed = true; }
  }
  if (changed) apply(shown.map(b => ({ ...b })));
  return plan.pages;
}
