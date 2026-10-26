import { Extension } from '@tiptap/core';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { TableMap, CellSelection, columnResizing, tableEditing } from '@tiptap/pm/tables';

// Word-style table extras: cell shading (any colour), a set row height (drag a row's bottom edge,
// or type it), and a set column width (drag the column edge — built in — or type it). Saved in the
// document as ordinary attributes, so the PDF (server/services/reportHtml.js) and stored HTML
// (notes, templates) show them too.

const PX_PER_CM = 96 / 2.54;
export const cmToPx = cm => Math.round(Number(cm) * PX_PER_CM);
export const pxToCm = px => Math.round((Number(px) / PX_PER_CM) * 100) / 100;

const background = {
  background: {
    default: null,
    parseHTML: el => el.getAttribute('data-background') || el.style.backgroundColor || null,
    renderHTML: attrs => (attrs.background ? { 'data-background': attrs.background, style: `background-color: ${attrs.background}` } : {}),
  },
};
export const ShadedCell = TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...background }; } });
export const ShadedHeader = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...background }; } });
export const SizedRow = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      height: {
        default: null,
        parseHTML: el => { const h = parseFloat(el.getAttribute('data-height') || el.style.height); return Number.isFinite(h) && h > 0 ? Math.round(h) : null; },
        renderHTML: attrs => (attrs.height ? { 'data-height': attrs.height, style: `height: ${attrs.height}px` } : {}),
      },
    };
  },
});

// The built-in table only turns on column dragging if the editor is editable at the moment it's
// created. Reports open read-only for an instant while they load, so dragging never worked there.
// This version always adds it; dragging still only happens while the report can be edited.
export const ResizableTable = Table.extend({
  addProseMirrorPlugins() {
    return [
      columnResizing({
        handleWidth: this.options.handleWidth,
        cellMinWidth: this.options.cellMinWidth,
        defaultCellMinWidth: this.options.cellMinWidth,
        View: this.options.View,
        lastColumnResizable: this.options.lastColumnResizable,
      }),
      tableEditing({ allowTableNodeSelection: this.options.allowTableNodeSelection }),
    ];
  },
  // columnResizing draws the table (and its column widths) itself.
  addNodeView() { return null; },
});

// True when a toolbar colour should go on the cell rather than the words: cells are selected, or
// the cursor is in a cell with no words selected.
export function wantsCellColour(state) {
  if (state.selection instanceof CellSelection) return true;
  return state.selection.empty && !!tableContext(state);
}

// ── commands used by the toolbar ─────────────────────────────────────────────

// The table around the cursor (or cell selection), and the cells it covers.
function tableContext(state) {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'table') {
      const table = $from.node(d), start = $from.start(d), map = TableMap.get(table);
      let rect;
      if (state.selection instanceof CellSelection) {
        rect = map.rectBetween(state.selection.$anchorCell.pos - start, state.selection.$headCell.pos - start);
      } else {
        let cellPos = null;
        for (let e = $from.depth; e > d; e--) if (['tableCell', 'tableHeader'].includes($from.node(e).type.name)) { cellPos = $from.before(e); break; }
        if (cellPos == null) return null;
        rect = map.findCell(cellPos - start);
      }
      return { table, start, map, rect, pos: $from.before(d) };
    }
  }
  return null;
}

// Shade the selected cells (or the cell the cursor is in). colour null = no shading.
export function shadeCells(editor, colour) {
  const ctx = tableContext(editor.state);
  if (!ctx) return;
  const tr = editor.state.tr;
  for (const rel of ctx.map.cellsInRect(ctx.rect)) {
    const pos = ctx.start + rel, node = tr.doc.nodeAt(pos);
    if (node) tr.setNodeMarkup(pos, null, { ...node.attrs, background: colour || null });
  }
  editor.view.dispatch(tr);
  editor.commands.focus();
}

// Height (px, null = automatic) for the rows the selection covers.
export function setRowHeight(editor, px) {
  const ctx = tableContext(editor.state);
  if (!ctx) return;
  const tr = editor.state.tr;
  ctx.table.forEach((row, offset, index) => {
    if (index >= ctx.rect.top && index < ctx.rect.bottom) tr.setNodeMarkup(ctx.start + offset, null, { ...row.attrs, height: px ? Math.max(12, Math.round(px)) : null });
  });
  editor.view.dispatch(tr);
  editor.commands.focus();
}

// Width (px) for the columns the selection covers — every cell in those columns. A merged cell
// keeps one width per column it spans, so only its covered columns change.
export function setColumnWidth(editor, px) {
  const ctx = tableContext(editor.state);
  if (!ctx) return;
  const width = Math.max(24, Math.round(px));
  const changes = new Map(); // cell offset → widths
  for (let row = 0; row < ctx.map.height; row++) {
    for (let col = ctx.rect.left; col < ctx.rect.right; col++) {
      const rel = ctx.map.map[row * ctx.map.width + col];
      const node = ctx.table.nodeAt(rel);
      if (!node) continue;
      const widths = changes.get(rel) || [...(node.attrs.colwidth || Array(node.attrs.colspan || 1).fill(null))];
      widths[col - ctx.map.colCount(rel)] = width;
      changes.set(rel, widths);
    }
  }
  const tr = editor.state.tr;
  for (const [rel, colwidth] of changes) {
    const pos = ctx.start + rel;
    tr.setNodeMarkup(pos, null, { ...tr.doc.nodeAt(pos).attrs, colwidth });
  }
  editor.view.dispatch(tr);
  editor.commands.focus();
}

// Make every column the same width, filling the page width.
export function evenColumns(editor, totalPx) {
  const ctx = tableContext(editor.state);
  if (!ctx) return;
  const width = Math.max(24, Math.floor(totalPx / ctx.map.width));
  const tr = editor.state.tr;
  ctx.table.descendants((node, rel) => {
    if (!['tableCell', 'tableHeader'].includes(node.type.name)) return true;
    tr.setNodeMarkup(ctx.start + rel, null, { ...node.attrs, colwidth: Array(node.attrs.colspan || 1).fill(width) });
    return false;
  });
  editor.view.dispatch(tr);
  editor.commands.focus();
}

// What the toolbar shows for the current table position: the cell's shading, row height and
// column width (null when automatic).
export function tableInfo(state) {
  const ctx = tableContext(state);
  if (!ctx) return null;
  const rel = ctx.map.map[ctx.rect.top * ctx.map.width + ctx.rect.left];
  const cell = ctx.table.nodeAt(rel);
  const row = ctx.table.child(ctx.rect.top);
  const first = ctx.map.colCount(rel);
  return {
    background: cell?.attrs.background || null,
    rowHeight: row?.attrs.height || null,
    colWidth: cell?.attrs.colwidth?.[ctx.rect.left - first] || null,
  };
}

// ── dragging a row's bottom edge ─────────────────────────────────────────────
// Like the built-in column resizing: point at the line under a row, the cursor changes, drag.
const rowResizeKey = new PluginKey('rowResize');
const EDGE = 5;

// A blue bar along the row edge, like the column handle: shown when pointing at the edge and
// while dragging. Fixed to the window, placed from the row's position on screen (works at any zoom).
let bar = null;
function placeBar(left, width, y) {
  if (!bar) {
    bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;height:4px;background:#6366f1;pointer-events:none;z-index:40;border-radius:1px;';
    document.body.appendChild(bar);
  }
  bar.style.left = `${left}px`;
  bar.style.width = `${width}px`;
  bar.style.top = `${y - 2}px`;
  bar.style.display = 'block';
}
function showBar(tr) {
  const table = tr.closest('table');
  if (!table) return hideBar();
  const r = tr.getBoundingClientRect(), t = table.getBoundingClientRect();
  placeBar(t.left, t.width, r.bottom);
}
function hideBar() { if (bar) bar.style.display = 'none'; }

export const RowResize = Extension.create({
  name: 'rowResize',
  addProseMirrorPlugins() {
    let drag = null;
    const rowAt = (view, event) => {
      const cell = event.target?.closest?.('td, th');
      if (!cell || !view.dom.contains(cell)) return null;
      const tr = cell.parentElement;
      const r = tr.getBoundingClientRect();
      if (Math.abs(event.clientY - r.bottom) > EDGE) return null;
      return tr;
    };
    return [new Plugin({
      key: rowResizeKey,
      props: {
        handleDOMEvents: {
          mousemove(view, event) {
            if (drag || !view.editable) return false;
            const tr = rowAt(view, event);
            view.dom.classList.toggle('row-resize-cursor', !!tr);
            if (tr) showBar(tr); else hideBar();
            return false;
          },
          mouseleave(view) { if (!drag) { view.dom.classList.remove('row-resize-cursor'); hideBar(); } return false; },
          mousedown(view, event) {
            if (!view.editable || event.button !== 0) return false;
            const tr = rowAt(view, event);
            if (!tr) return false;
            event.preventDefault();
            // The page may be shown scaled (zoom), so movement is converted to page pixels.
            const rect = tr.getBoundingClientRect();
            const k = tr.offsetHeight ? rect.height / tr.offsetHeight : 1;
            let pos;
            try { pos = view.posAtDOM(tr, 0) - 1; } catch { return false; }
            const node = view.state.doc.nodeAt(pos);
            if (!node || node.type.name !== 'tableRow') return false;
            // The row itself isn't touched until the mouse is released (the editor owns that DOM and
            // would redraw it); the bar follows the mouse to show the new bottom edge.
            const table = tr.closest('table').getBoundingClientRect();
            drag = { pos, startY: event.clientY, startH: tr.offsetHeight, k, top: rect.top, left: table.left, width: table.width };
            placeBar(drag.left, drag.width, rect.bottom);
            const move = e => {
              const h = Math.max(12, drag.startH + (e.clientY - drag.startY) / drag.k);
              drag.h = h;
              placeBar(drag.left, drag.width, drag.top + h * drag.k);
            };
            const up = () => {
              window.removeEventListener('mousemove', move);
              window.removeEventListener('mouseup', up);
              const d = drag; drag = null;
              view.dom.classList.remove('row-resize-cursor');
              hideBar();
              if (!d.h) return;
              const row = view.state.doc.nodeAt(d.pos);
              if (row?.type.name === 'tableRow') view.dispatch(view.state.tr.setNodeMarkup(d.pos, null, { ...row.attrs, height: Math.round(d.h) }));
            };
            window.addEventListener('mousemove', move);
            window.addEventListener('mouseup', up);
            return true;
          },
        },
      },
    })];
  },
});
