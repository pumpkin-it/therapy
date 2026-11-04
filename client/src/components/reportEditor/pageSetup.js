import Document from '@tiptap/extension-document';
import { Plugin } from '@tiptap/pm/state';
import { PAGE } from './PageGuides';

// Word's Layout › Margins / Orientation, and the document's own header and footer. Kept on the
// document itself (doc attributes), so a report made from a template starts with the template's
// page setup, and the PDF (server/services/docPdf.js) prints it the same.
//   page:   null (A4 portrait, 1.9 cm margins — the original layout) or
//           { orientation: 'portrait' | 'landscape', top, bottom, left, right } (margins in cm)
//   header / footer: null (no header; the standard footer — client · title, Page X of Y) or
//           { content: [...] } — TipTap paragraphs, with page number / page count fields.

export const PX_PER_CM = 96 / 2.54;
const DEFAULT_MARGIN_CM = Math.round((PAGE.margin / PX_PER_CM) * 100) / 100; // 1.9 cm

export const MARGIN_PRESETS = [
  { key: 'standard', label: 'Standard', hint: '1.9 cm all round', m: { top: DEFAULT_MARGIN_CM, bottom: DEFAULT_MARGIN_CM, left: DEFAULT_MARGIN_CM, right: DEFAULT_MARGIN_CM } },
  { key: 'normal', label: 'Normal (Word)', hint: '2.54 cm all round', m: { top: 2.54, bottom: 2.54, left: 2.54, right: 2.54 } },
  { key: 'narrow', label: 'Narrow', hint: '1.27 cm all round', m: { top: 1.27, bottom: 1.27, left: 1.27, right: 1.27 } },
  { key: 'moderate', label: 'Moderate', hint: '2.54 cm top/bottom, 1.91 cm sides', m: { top: 2.54, bottom: 2.54, left: 1.91, right: 1.91 } },
  { key: 'wide', label: 'Wide', hint: '2.54 cm top/bottom, 5.08 cm sides', m: { top: 2.54, bottom: 2.54, left: 5.08, right: 5.08 } },
];

const A4_PX = { width: 793.7, height: 1122.52 }; // 210 x 297 mm

const cm = v => (Number.isFinite(Number(v)) && Number(v) >= 0.5 && Number(v) <= 8 ? Number(v) : DEFAULT_MARGIN_CM);

// The page in px (96 dpi): size and the four margins.
export function pageGeometry(page) {
  const landscape = page?.orientation === 'landscape';
  const px = v => Math.round(cm(v) * PX_PER_CM);
  return {
    width: landscape ? PAGE.height : PAGE.width,
    height: landscape ? PAGE.width : PAGE.height,
    top: page ? px(page.top) : PAGE.margin,
    bottom: page ? px(page.bottom) : PAGE.margin,
    left: page ? px(page.left) : PAGE.margin,
    right: page ? px(page.right) : PAGE.margin,
    landscape,
    // The sheets are drawn in whole pixels; A4 itself, as the PDF is laid out, is a little smaller.
    slackX: (landscape ? PAGE.height - A4_PX.height : PAGE.width - A4_PX.width),
    slackY: (landscape ? PAGE.width - A4_PX.width : PAGE.height - A4_PX.height),
  };
}

// A table wider than the text area (narrower columns weren't needed until the margins grew, or it
// was pasted or dragged that wide) has its dragged column widths shrunk to fit. Left too wide, it
// runs off the page here, and Chrome shrinks the whole PDF, every word, to get it on. Returns the
// factor to multiply them by. Columns with no width set share the rest, about one column's worth
// each. The same sum is in server/services/reportHtml.js, for saved documents not opened again.
const MIN_COLUMN = 24; // the table's cellMinWidth (useDocEditor.js)
export function tableFitFactor(widths, textWidth) {
  const fixed = widths.reduce((sum, w) => sum + (w || 0), 0);
  const unset = widths.filter(w => !w).length;
  if (!fixed || fixed + unset * MIN_COLUMN <= textWidth) return 1;
  return Math.max(0, textWidth - (unset * textWidth) / widths.length) / fixed;
}

function fitTables(doc, tr) {
  const G = pageGeometry(doc.attrs.page);
  const textWidth = Math.floor(G.width - G.slackX - G.left - G.right);
  let changed = false;
  doc.descendants((node, pos) => {
    if (node.isTextblock) return false;
    if (node.type.name !== 'table') return true;
    const widths = [];
    node.firstChild?.forEach(c => widths.push(...(c.attrs.colwidth || Array(c.attrs.colspan || 1).fill(null))));
    const k = tableFitFactor(widths, textWidth);
    if (k < 1) {
      node.descendants((cell, at) => {
        if (!cell.attrs.colwidth) return !cell.type.spec.tableRole?.includes('cell');
        const colwidth = cell.attrs.colwidth.map(w => (w ? Math.max(MIN_COLUMN, Math.floor(w * k)) : w));
        if (colwidth.some((w, i) => w !== cell.attrs.colwidth[i])) {
          tr.setNodeMarkup(pos + 1 + at, null, { ...cell.attrs, colwidth });
          changed = true;
        }
        return false;
      });
    }
    return false; // a table inside a cell has no page width to fit
  });
  return changed;
}

export const PagedDocument = Document.extend({
  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction(trs, _old, state) {
        if (!trs.some(t => t.docChanged)) return null;
        const tr = state.tr;
        return fitTables(state.doc, tr) ? tr : null;
      },
    })];
  },
  addAttributes() {
    return { page: { default: null }, header: { default: null }, footer: { default: null } };
  },
  addCommands() {
    return {
      setPageSetup: changes => ({ state, tr, dispatch }) => {
        const cur = state.doc.attrs.page || { orientation: 'portrait', ...MARGIN_PRESETS[0].m };
        if (dispatch) dispatch(tr.setDocAttribute('page', { ...cur, ...changes }));
        return true;
      },
      // setContent replaces what's in the document, not the document itself, so its page setup,
      // header and footer have to be carried over too (after setContent, in the same chain).
      setDocAttrsFrom: content => ({ tr }) => {
        const attrs = content && typeof content === 'object' && content.type === 'doc' ? content.attrs || {} : {};
        for (const k of ['page', 'header', 'footer']) tr.setDocAttribute(k, attrs[k] ?? null);
        return true;
      },
      setHeaderFooter: (which, value) => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setDocAttribute(which, value));
        return true;
      },
    };
  },
});

// Header and footer: three parts (left, centre, right), as Word's three-column header. Each is text
// with fields in braces, filled in on every page (and by the PDF: server/services/docPdf.js).
export const HF_FIELDS = [
  { token: '{page}', label: 'Page number' },
  { token: '{pages}', label: 'Number of pages' },
  { token: '{client}', label: 'Client name' },
  { token: '{title}', label: 'Report title' },
  { token: '{date}', label: 'Date' },
];
export const DEFAULT_FOOTER = { left: '{client} · {title}', center: '', right: 'Page {page} of {pages}' };
export const HF_SLOTS = ['left', 'center', 'right'];
export const hfEmpty = hf => !hf || HF_SLOTS.every(k => !String(hf[k] || '').trim());

export const todayText = () => new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

// A part with its fields filled in. A separator left dangling by an empty field (" · " with no
// title) is dropped.
export function fillSlot(text, values) {
  return String(text || '')
    .replace(/\{(page|pages|client|title|date)\}/g, (m, k) => String(values[k] ?? ''))
    .replace(/^\s*·\s*|\s*·\s*$/g, '')
    .replace(/\s*·\s*·\s*/g, ' · ');
}
