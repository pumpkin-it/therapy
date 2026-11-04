import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { TableMap } from '@tiptap/pm/tables';
import { pageGeometry } from './pageSetup';

// Word-style pages for the report editor. The document stays one editable flow; where a page ends,
// a gap is added (a decoration — never saved in the document) so the next line starts at the top
// of the next sheet. PagedSheet.jsx draws the sheets behind the text.
//
// Where pages end follows the same rules Chrome uses when it prints the PDF (docPdf.js), so the
// editor's page 4 is the PDF's page 4:
//   - a line or picture is never cut — it moves to the next page;
//   - a table row may break across pages, as in Word ("Allow row to break across pages"): in each
//     cell, the lines that don't fit carry on at the top of the next page. A row none of whose
//     cells can fit a line moves to the next page whole;
//   - at least two lines of a paragraph stay together at the bottom and the top of a page
//     (orphans/widows 2);
//   - a heading isn't left alone at the bottom of a page (h1–h3 break-after: avoid);
//   - a manual page break (Ctrl+Enter) starts a new page;
// The margin above a block that moves to a new page is dropped, as Chrome does.
//
// A break inside a cell is a gap inside the cell (.pg-gap-cell) before the line that moves. A row
// moved whole has a gap row (<tr>) before it — a cell from above that spans down past it is
// stretched over it (rowspan + 1, a decoration), or the gap row would take one of its rows and the
// cells after it would slide left.

export const PAGE_GAP = 24; // grey gap between sheets, in page pixels
// The page being laid out (pageSetup.js: size and margins, from the document's page setup). Set by
// paginate() before each layout.
let G = pageGeometry(null);
const pageTop = p => p * (G.height + PAGE_GAP) + G.top;
// Where the PDF's text area really ends. (The checks below allow 0.5 for rounding: taken off here,
// so what the PDF would move on is moved on here too.)
const pageBottom = p => p * (G.height + PAGE_GAP) + G.height - G.bottom - G.slackY - 0.5;

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
  // (A page gap already inside the paragraph isn't a line.)
  const gaps = [...dom.querySelectorAll('.pg-gap-line')].map(g => g.getBoundingClientRect());
  const isGap = r => gaps.some(g => Math.abs(g.top - r.top) < 0.5 && Math.abs(g.bottom - r.bottom) < 0.5);
  const rects = [...range.getClientRects()].filter(r => r.height > 0 && !isGap(r)).sort((a, b) => a.top - b.top);
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
      // spanned: a cell from a row above spans down into this row.
      const map = TableMap.get(node);
      const spanned = new Set();
      for (const offset of new Set(map.map)) {
        const rect = map.findCell(offset);
        for (let r = rect.top + 1; r < rect.bottom; r++) spanned.add(r);
      }
      const rows = [];
      node.forEach((row, offset, index) => {
        const rowPos = pos + 1 + offset;
        const dom = view.nodeDOM(rowPos);
        if (!(dom instanceof HTMLElement)) return;
        const r = dom.getBoundingClientRect();
        // (bottom: with half the row's bottom line, which the PDF counts when fitting a row on a page)
        const unit = { kind: 'row', pos: rowPos, top: toY(r.top), bottom: toY(r.bottom) + 0.5, table: pos, row: index, first: offset === 0, spanned: spanned.has(index) };
        rows.push(unit);
        units.push(unit);
      });
      // A repeated header row takes its height at the top of every page the table carries on to
      // (repeat: where the table's text starts below the page top).
      if (node.attrs.repeatHeader && rows.length > 1 && rows[0].row === 0) {
        const h = rows[0].bottom - rows[0].top;
        for (const u of rows.slice(1)) u.repeat = h;
      }
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
// rowFits(row, y): whether any cell starting in the row has its first line ending above y.
// A table row that has to break across the page stops the plan ({ stop }): the cells are split by
// measuring them once everything above is in place (splitRow), and the plan carries on from there
// (from = the unit after that row, page = the page the row ends on).
function planBreaks(units, marginOf, rowFits, { from = 0, page: startPage = 0 } = {}) {
  const breaks = [];
  let shift = 0, page = startPage, forced = false;
  const real = units;
  // Whether the unit comes straight after a heading. (A table's first row isn't split after one: the
  // PDF moves the heading and the row on together.)
  const afterHeading = at => { const prev = real[at - 1]; return !!prev && prev.kind === 'line' && prev.heading && prev.index === prev.count - 1; };
  for (let i = from; i < real.length; i++) {
    const u = real[i];
    if (u.kind === 'forced') { forced = true; continue; }
    const top = u.top + shift, bottom = u.bottom + shift;
    let breakAt = -1, afterForced = false;
    if (forced) { forced = false; afterForced = true; if (top > pageTop(page) + 0.5) breakAt = i; }
    else if (u.kind === 'row' && bottom > pageBottom(page) + 0.5 && !(u.first && afterHeading(i))
      && (top <= pageTop(page) + (u.repeat || 0) + 0.5 || u.spanned || rowFits(u, pageBottom(page) - shift))) {
      return { breaks, stop: { index: i, page } };
    // (A paragraph's line box is worked out from its letters, so it gets the rounding allowance back.)
    } else if (bottom > pageBottom(page) + (u.kind === 'row' ? 0.5 : 1) && top > pageTop(page) + (u.repeat || 0) + 0.5) {
      breakAt = i;
      if (u.kind === 'line' && u.count > 1) {
        const k = u.index, n = u.count;
        if (k === 1) breakAt = i - 1;                                   // don't leave one line behind
        else if (n - k === 1 && k >= 3) breakAt = i - 1;                // don't carry one line over (unless that
        //                                                                 would leave one behind: 3 lines split 2 + 1)
      }
      // Keep a heading (or several in a row) with what follows it.
      const first = real[breakAt];
      if (first && (first.index === 0 || (first.kind === 'row' && first.first))) {
        while (afterHeading(breakAt)) {
          const headStart = breakAt - real[breakAt - 1].count;
          if (!real[headStart] || real[headStart].top + shift <= pageTop(page) + 0.5) break;
          breakAt = headStart;
        }
      }
    }
    if (breakAt >= 0) {
      const b = real[breakAt];
      page++;
      const offset = afterForced && breakAt === i ? marginOf(b) : (b.repeat || 0);
      const move = pageTop(page) + offset - (b.top + shift);
      shift += move;
      breaks.push({ unit: b, move, page, offset });
      i = breakAt; // carry on from the unit that now starts the page
    }
    // A picture taller than a whole page can't fit anywhere; it runs on past the page end and the
    // pages it covers are counted.
    const end = real[i].bottom + shift;
    while (end > pageBottom(page) + G.bottom + G.top + PAGE_GAP) page++;
  }
  const last = [...real].reverse().find(u => u.kind !== 'forced');
  let pages = page + 1;
  if (last) while (last.bottom + shift > pageBottom(pages - 1) + G.bottom + PAGE_GAP) pages++;
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

// For a gap before row `row` of a table: the cells from rows above that span down past it (they
// cover the gap too), and the runs of columns left free for the gap row's own cells.
function spanningAt(table, tablePos, row) {
  const map = TableMap.get(table);
  const cells = new Map(); // cell position → cell node
  const covered = new Set();
  for (let c = 0; c < map.width; c++) {
    const offset = map.map[row * map.width + c];
    const rect = map.findCell(offset);
    if (rect.top < row) {
      covered.add(c);
      cells.set(tablePos + 1 + offset, table.nodeAt(offset));
    }
  }
  const runs = [];
  for (let c = 0; c < map.width; c++) {
    if (covered.has(c)) continue;
    if (runs.length && runs[runs.length - 1].end === c) runs[runs.length - 1].end++;
    else runs.push({ start: c, end: c + 1 });
  }
  return { cells, runs, width: map.width };
}

// The lines of a table cell, top to bottom: those of its paragraphs/headings, and each picture or
// other block that can't be split as one line.
function cellLines(view, cellPos, cell, toY) {
  const lines = [];
  cell.descendants((node, offset) => {
    const blockPos = cellPos + 1 + offset;
    if (node.isTextblock) {
      const ls = linesOf(view, blockPos, node, toY);
      ls.forEach((l, index) => lines.push({ ...l, block: blockPos, index, count: ls.length }));
      return false;
    }
    if (node.isBlock && node.isAtom) {
      const dom = view.nodeDOM(blockPos);
      if (dom instanceof HTMLElement) {
        const r = dom.getBoundingClientRect();
        lines.push({ top: toY(r.top), bottom: toY(r.bottom), pos: blockPos, block: blockPos, index: 0, atom: true });
      }
      return false;
    }
    return true;
  });
  return lines;
}

// The cells starting in a row (unit), with their positions.
function rowCells(doc, rowPos) {
  const row = doc.nodeAt(rowPos);
  const cells = [];
  row?.forEach((cell, offset) => cells.push({ pos: rowPos + 1 + offset, node: cell }));
  return cells;
}

// Splits a table row across the end of page `page`, measured as it now lies (everything above it
// already in place): in every cell crossing the page end, the first line that doesn't fit carries on
// at the top of the next page — cells spanning down from rows above too. If splitting wouldn't keep
// any of the row's own lines on this page (none fits, or only its padding runs over), the row moves
// to the next page whole (a gap row) instead, as Chrome does.
function splitRow(view, toY, row, page) {
  const doc = view.state.doc;
  const table = doc.nodeAt(row.table);
  if (table?.type.name !== 'table') return [];
  const end = pageBottom(page), offset = row.repeat || 0, next = pageTop(page + 1) + offset;
  const rowDom = view.nodeDOM(row.pos);
  const rowTop = rowDom instanceof HTMLElement ? toY(rowDom.getBoundingClientRect().top) : end;
  const own = new Set(rowCells(doc, row.pos).map(c => c.pos));
  const crossing = [];
  const map = TableMap.get(table);
  for (const offset of new Set(map.map)) {
    const cellPos = row.table + 1 + offset;
    const dom = view.nodeDOM(cellPos);
    if (!(dom instanceof HTMLElement)) continue;
    const r = dom.getBoundingClientRect();
    if (!(toY(r.top) < end - 0.5 && toY(r.bottom) > end)) continue;
    const lines = cellLines(view, cellPos, table.nodeAt(offset), toY);
    let i = lines.findIndex(l => l.bottom > end + 0.5);
    // Don't leave a paragraph's first line alone at the bottom of the page (orphans 2), nor carry its
    // last line over alone (widows 2) — unless that would leave one line behind instead (a 3-line
    // paragraph then splits 2 + 1), as Chrome does.
    if (i > 0 && lines[i].index === 1) i--;
    else if (i > 0 && lines[i].count - lines[i].index === 1 && lines[i].index >= 3) i--;
    crossing.push({ cellPos, own: own.has(cellPos), line: i < 0 ? null : lines[i], first: i === 0, spans: (table.nodeAt(offset)?.attrs.rowspan || 1) > 1 });
  }
  const ownCells = crossing.filter(c => c.own);
  // (A row stretched past the page end by a cell from above that is being split stays put.)
  // (A row that starts below the page end, kept in the plan by a cell spanning down into it, has no
  // cells of its own crossing the end: with nothing to split in the spanning cell, it moves too.)
  const below = rowTop >= end - 0.5;
  // (A row starting a cell that spans on down isn't split: it stays if it fits, to within rounding
  // (the spanning cell carries on over the page anyway), or else moves whole. So does the PDF.)
  const rowBottom = rowDom instanceof HTMLElement ? toY(rowDom.getBoundingClientRect().bottom) : end;
  const startsSpan = ownCells.some(c => c.spans);
  const moveRow = rowTop > pageTop(page) + offset + 0.5 && !crossing.some(c => !c.own && c.line)
    && (startsSpan ? rowBottom > end + 1 : below || (ownCells.length > 0 && ownCells.every(c => !c.line || c.first)));
  const out = [];
  if (moveRow) out.push({ unit: row, page: page + 1, offset, move: next - rowTop, size: next - rowTop });
  for (const c of crossing) {
    if ((moveRow && c.own) || !c.line || c.line.top >= next - 0.5) continue;
    const l = c.line;
    const pos = l.pos != null ? l.pos : lineStartPos(view, l.block, doc.nodeAt(l.block), l.clientMid);
    if (pos == null) continue;
    out.push({ unit: { kind: 'line', block: l.block, index: l.index, pos, inCell: true, table: row.table, repeat: offset }, page: page + 1, offset, move: next - l.top, size: next - l.top });
  }
  return out;
}

function buildDecos(doc, breaks) {
  const decos = [];
  // Every cell spanning several rows carries its rowspan as a decoration, plus one for each gap row
  // inside it — always, even with no gap, so the attribute is never removed from under it.
  const rowBreaks = breaks.filter(b => b.unit.kind === 'row');
  doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return true;
    const map = TableMap.get(node);
    const seen = new Set();
    for (const offset of map.map) {
      if (seen.has(offset)) continue;
      seen.add(offset);
      const cell = node.nodeAt(offset);
      if (!cell || (cell.attrs.rowspan || 1) < 2) continue;
      const rect = map.findCell(offset);
      const gaps = rowBreaks.filter(b => b.unit.table === pos && b.unit.row > rect.top && b.unit.row < rect.bottom).length;
      const at = pos + 1 + offset;
      decos.push(Decoration.node(at, at + cell.nodeSize, { rowspan: String(cell.attrs.rowspan + gaps) }));
    }
    return false;
  });
  for (const b of breaks) {
    const u = b.unit, size = Math.max(0, Math.round(b.size * 100) / 100);
    if (u.kind === 'row') {
      const table = doc.nodeAt(u.table);
      const runs = table?.type.name === 'table' ? spanningAt(table, u.table, u.row).runs : [{ start: 0, end: 1 }];
      decos.push(Decoration.widget(u.pos, () => {
        const tr = document.createElement('tr'); tr.className = 'pg-gap-row'; tr.contentEditable = 'false';
        for (const r of runs) {
          const td = document.createElement('td'); td.colSpan = r.end - r.start; td.style.height = `${size}px`;
          tr.appendChild(td);
        }
        return tr;
      }, { side: -1, key: `pgr-${u.pos}-${size}-${runs.map(r => `${r.start}.${r.end}`).join('_')}`, ignoreSelection: true }));
    } else if (u.inCell) {
      // A split spanning cell: the gap sits inside the cell, drawing the cell's bottom line at the
      // page end and its top line at the top of the next page.
      decos.push(Decoration.widget(u.pos, () => {
        const s = document.createElement('span'); s.className = 'pg-gap-line pg-gap-cell'; s.contentEditable = 'false'; s.style.height = `${size}px`; s.dataset.pg = String(u.pos); return s;
      }, { side: -1, key: `pgc-${u.pos}-${size}`, ignoreSelection: true }));
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

// Corrects each gap (in place) so the line/row it moves lands exactly on the top of its page.
// Returns whether any changed. (Gaps in cells side by side don't move each other, so a gap inside a
// cell isn't carried on to the ones after it.)
function correct(view, toY, shown) {
  let carried = 0, changed = false;
  for (const b of shown) {
    const u = b.unit;
    let top = null;
    if (u.kind === 'row') { const d = view.nodeDOM(u.pos); if (d instanceof HTMLElement) top = toY(d.getBoundingClientRect().top); }
    else if (u.index > 0 || u.inCell) {
      // The line after an in-paragraph gap starts where the gap ends.
      const gap = view.dom.querySelector(`.pg-gap-line[data-pg="${u.pos}"]`);
      if (gap) top = toY(gap.getBoundingClientRect().bottom);
    } else {
      const node = view.state.doc.nodeAt(u.block);
      const lines = node ? linesOf(view, u.block, node, toY) : [];
      if (lines[0]) top = lines[0].top;
    }
    if (top == null) continue;
    const delta = pageTop(b.page) + (b.offset || 0) - (top + (u.inCell ? 0 : carried));
    if (Math.abs(delta) > 0.5) { b.size = Math.max(0, b.size + delta); if (!u.inCell) carried += delta; changed = true; }
  }
  return changed;
}

// A table's repeated header row (repeatHeader) drawn at the top of each page the table carries on
// to: a copy of the row laid over the space the breaks left for it. Not part of the document (it
// can't be clicked or typed in); the PDF repeats the row itself (<thead>).
function drawRepeatedHeaders(view, stack, breaks, toY, k) {
  stack.querySelectorAll(':scope > .pg-repeat').forEach(el => el.remove());
  const seen = new Set();
  for (const b of breaks) {
    const u = b.unit;
    if (!u.repeat || u.table == null || seen.has(`${u.table}:${b.page}`)) continue;
    seen.add(`${u.table}:${b.page}`);
    const wrap = view.nodeDOM(u.table);
    const table = wrap instanceof HTMLElement ? (wrap.matches('table') ? wrap : wrap.querySelector('table')) : null;
    const head = table?.querySelector('tr');
    if (!head) continue;
    const r = table.getBoundingClientRect(), sr = stack.getBoundingClientRect();
    const layer = document.createElement('div');
    layer.className = 'report-doc pg-repeat';
    layer.style.cssText = `position:absolute;left:${(r.left - sr.left) / k}px;top:${pageTop(b.page)}px;width:${r.width / k}px;min-height:0;z-index:15;pointer-events:none;`;
    const copy = document.createElement('table');
    copy.style.cssText = 'margin:0;width:100%;';
    const cols = table.querySelector('colgroup');
    if (cols) copy.appendChild(cols.cloneNode(true));
    const body = document.createElement('tbody');
    const row = head.cloneNode(true);
    row.querySelectorAll('.column-resize-handle').forEach(el => el.remove());
    row.querySelectorAll('.selectedCell').forEach(el => el.classList.remove('selectedCell'));
    // Cells spanning down past the header row would run on below it; the copy is just the row.
    row.querySelectorAll('[rowspan]').forEach(el => el.removeAttribute('rowspan'));
    body.appendChild(row);
    copy.appendChild(body);
    layer.appendChild(copy);
    layer.setAttribute('aria-hidden', 'true');
    stack.appendChild(layer);
  }
}

// Which units start pages (not how big the gaps are — those are corrected after measuring).
const signature = breaks => `${G.height}:${G.top}:${G.bottom}|` + breaks.map(b => `${b.unit.kind}:${b.unit.pos}:${b.unit.block ?? ''}:${b.page}`).join('|');

// Works out the pages and applies the gaps. stack = the element the sheets are drawn in (its top is
// the top of page 1). Returns the number of pages.
export function paginate(view, stack) {
  if (!view || view.isDestroyed || !stack) return 1;
  const k = stack.offsetWidth ? stack.getBoundingClientRect().width / stack.offsetWidth : 1;
  const toY = clientY => (clientY - stack.getBoundingClientRect().top) / k;
  const doc = view.state.doc;
  G = pageGeometry(doc.attrs.page);

  // 1. The natural layout, with no gaps (all in one task, so nothing is painted in between).
  stack.classList.remove('pg-on');
  let units = measureUnits(view, toY);
  const marginOf = u => {
    if (u.kind === 'row') return 0;
    const dom = view.nodeDOM(outerBlock(doc, u.block));
    return dom instanceof HTMLElement ? parseFloat(getComputedStyle(dom).marginTop) || 0 : 0;
  };
  const rowFits = (row, y) => rowCells(doc, row.pos).some(c => {
    const first = cellLines(view, c.pos, c.node, toY)[0];
    return first && first.bottom <= y + 0.5;
  });
  // Where each line that starts a page begins (only these need working out), and a first guess at
  // each gap: the distance to move, plus the margin a moved block already had (its margin is
  // replaced by the gap). Measuring afterwards corrects whatever margins collapsing changed.
  const prepare = breaks => breaks.filter(b => {
    const u = b.unit;
    b.size = b.move;
    if (u.kind !== 'row' && u.index === 0) b.size = b.move + marginOf(u);
    if (u.kind !== 'line' || u.index === 0) return true;
    const node = doc.nodeAt(u.block);
    u.pos = node ? lineStartPos(view, u.block, node, u.clientMid) : null;
    return u.pos != null;
  });
  const apply = breaks => {
    view.dispatch(view.state.tr.setMeta(paginationKey, { decos: buildDecos(view.state.doc, breaks), breaks }).setMeta('addToHistory', false));
  };
  // Correct each gap so the line/row it moves lands exactly on the top of its page. A gap in a cell
  // stretches the rows it spans (Chrome shares the extra height among them), so moving a row back
  // onto its page top changes the rows above it again: repeat until settled.
  const settle = breaks => {
    for (let pass = 0; pass < 6 && correct(view, toY, breaks); pass++) apply(breaks.map(b => ({ ...b })));
  };

  let plan = planBreaks(units, marginOf, rowFits);
  if (!plan.stop) {
    // No row breaks across a page: one plan does it.
    plan.breaks = prepare(plan.breaks);
    const current = paginationKey.getState(view.state);
    // Same pages as before: keep the gaps already shown (their sizes were corrected last time);
    // the correction below still fixes them if lines above have changed height.
    if (signature(plan.breaks) !== signature(current?.breaks || [])) apply(plan.breaks);
    stack.classList.add('pg-on');
    const shown = paginationKey.getState(view.state)?.breaks || [];
    if (correct(view, toY, shown)) apply(shown.map(b => ({ ...b })));
    drawRepeatedHeaders(view, stack, paginationKey.getState(view.state)?.breaks || [], toY, k);
    return plan.pages;
  }

  // 2. Rows breaking across pages: lay out the pages up to the row, split its cells as they then
  // lie, and plan on from there with the layout measured again.
  const breaks = [];
  for (let guard = 0; plan.stop && guard < 200; guard++) {
    const { index, page } = plan.stop;
    const row = units[index];
    breaks.push(...prepare(plan.breaks));
    apply(breaks);
    stack.classList.add('pg-on');
    settle(breaks);
    breaks.push(...splitRow(view, toY, row, page));
    apply(breaks);
    settle(breaks);
    units = measureUnits(view, toY);
    const at = units.findIndex(u => u.kind === 'row' && u.pos === row.pos);
    if (at < 0) break;
    const split = units[at];
    // Still running past the next page's end (a row taller than a page): split it there too.
    if (split.bottom > pageBottom(page + 1) + 0.5) { plan = { breaks: [], stop: { index: at, page: page + 1 } }; continue; }
    // Carry on after the row, on the page it now ends on (if it ends in this page's bottom margin,
    // the next row still has to move to the next page).
    plan = planBreaks(units, marginOf, rowFits, { from: at + 1, page: split.bottom > pageTop(page + 1) ? page + 1 : page });
  }
  breaks.push(...prepare(plan.breaks));
  apply(breaks);
  settle(breaks);
  drawRepeatedHeaders(view, stack, breaks, toY, k);
  return plan.pages || 1;
}
