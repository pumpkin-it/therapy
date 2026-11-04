import { Extension } from '@tiptap/core';

// Word's paragraph and character tools that TipTap doesn't have: line spacing, space before/after
// a paragraph, change case, the format painter, growing/shrinking the font and Word's keyboard
// shortcuts. Anything saved here must also print the same — server/services/reportHtml.js renders
// the same attributes (lineSpacing, spaceBefore, spaceAfter).

// Word's line spacing ("1.0", "1.15", "1.5"…) is a multiple of a font's single line, which for the
// report fonts is about 1.15 × the font size; CSS line-height is a multiple of the font size.
export const LINE_SPACINGS = ['1.0', '1.15', '1.5', '2.0', '2.5', '3.0'];
export const SPACINGS_PT = [0, 6, 8, 12, 18, 24];
export const SINGLE = 1.15;
export const cssLineHeight = v => Math.round(Number(v) * SINGLE * 1000) / 1000;

const ptFrom = value => {
  const m = /^(-?[\d.]+)(pt|px|cm|mm|in)?$/.exec(String(value || '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  const pt = { pt: n, px: n * 0.75, cm: n * 28.3465, mm: n * 2.83465, in: n * 72 }[m[2] || 'px'];
  return Number.isFinite(pt) && pt >= 0 && pt <= 200 ? Math.round(pt * 10) / 10 : null;
};

// Indents, in cm as on Word's ruler: left and right of the paragraph, and the first line relative
// to the left indent (negative = a hanging indent).
const cmFrom = value => {
  const pt = ptFrom(value);
  return pt == null ? null : Math.round((pt / 28.3465) * 100) / 100;
};
const signedCm = value => {
  const v = String(value || '').trim();
  if (!v) return null;
  const neg = v.startsWith('-');
  const cm = cmFrom(neg ? v.slice(1) : v);
  return cm == null || cm === 0 ? null : neg ? -cm : cm;
};
export const TAB_CM = 1.27; // Word's default tab stops and indent step

export const ParagraphFormat = Extension.create({
  name: 'paragraphFormat',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        // Pasting from Word brings its spacing in too (line-height: 107%, margin-bottom: 8pt…).
        lineSpacing: {
          default: null,
          parseHTML: el => {
            if (el.dataset.lineSpacing) return el.dataset.lineSpacing;
            const lh = el.style.lineHeight;
            if (!lh) return null;
            const n = lh.endsWith('%') ? parseFloat(lh) / 100 : /^[\d.]+$/.test(lh) ? Number(lh) : null;
            return n && n > 0.5 && n <= 5 ? String(Math.round((n / (lh.endsWith('%') ? 1 : SINGLE)) * 100) / 100) : null;
          },
          renderHTML: a => (a.lineSpacing ? { 'data-line-spacing': a.lineSpacing, style: `line-height: ${cssLineHeight(a.lineSpacing)}` } : {}),
        },
        spaceBefore: {
          default: null,
          parseHTML: el => (el.dataset.spaceBefore != null ? ptFrom(`${el.dataset.spaceBefore}pt`) : ptFrom(el.style.marginTop)),
          renderHTML: a => (a.spaceBefore != null ? { 'data-space-before': a.spaceBefore, style: `margin-top: ${a.spaceBefore}pt` } : {}),
        },
        indentLeft: {
          default: null,
          parseHTML: el => (el.dataset.indentLeft != null ? Number(el.dataset.indentLeft) || null : cmFrom(el.style.marginLeft) || null),
          renderHTML: a => (a.indentLeft ? { 'data-indent-left': a.indentLeft, style: `margin-left: ${a.indentLeft}cm` } : {}),
        },
        indentRight: {
          default: null,
          parseHTML: el => (el.dataset.indentRight != null ? Number(el.dataset.indentRight) || null : cmFrom(el.style.marginRight) || null),
          renderHTML: a => (a.indentRight ? { 'data-indent-right': a.indentRight, style: `margin-right: ${a.indentRight}cm` } : {}),
        },
        indentFirst: {
          default: null,
          parseHTML: el => (el.dataset.indentFirst != null ? Number(el.dataset.indentFirst) || null : signedCm(el.style.textIndent)),
          renderHTML: a => (a.indentFirst ? { 'data-indent-first': a.indentFirst, style: `text-indent: ${a.indentFirst}cm` } : {}),
        },
        spaceAfter: {
          default: null,
          parseHTML: el => (el.dataset.spaceAfter != null ? ptFrom(`${el.dataset.spaceAfter}pt`) : ptFrom(el.style.marginBottom)),
          renderHTML: a => (a.spaceAfter != null ? { 'data-space-after': a.spaceAfter, style: `margin-bottom: ${a.spaceAfter}pt` } : {}),
        },
      },
    }];
  },
  addCommands() {
    const set = attrs => ({ commands }) => ['paragraph', 'heading'].map(t => commands.updateAttributes(t, attrs)).some(Boolean);
    return {
      setLineSpacing: v => set({ lineSpacing: v }),
      setParagraphSpacing: attrs => set(attrs),
      setIndent: attrs => set(attrs),
      // Word's Increase/Decrease Indent for ordinary paragraphs: the left indent moves a tab stop.
      shiftIndent: dir => ({ state, tr, dispatch }) => {
        const { from, to } = state.selection;
        let changed = false;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (!['paragraph', 'heading'].includes(node.type.name)) return true;
          // To the next tab stop to the right, or back to the one before.
          const cur = Number(node.attrs.indentLeft) || 0;
          const stops = dir > 0 ? Math.floor(cur / TAB_CM + 1e-6) + 1 : Math.ceil(cur / TAB_CM - 1e-6) - 1;
          const value = Math.round(Math.max(0, stops) * TAB_CM * 100) / 100;
          if (value !== cur) { tr.setNodeMarkup(pos, null, { ...node.attrs, indentLeft: value || null }); changed = true; }
          return false;
        });
        if (changed && dispatch) dispatch(tr);
        return changed;
      },
    };
  },
});

// The paragraph(s) the selection is in: their spacing, for the toolbar.
export function paragraphFormat(state) {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === 'paragraph' || n.type.name === 'heading') return n.attrs;
  }
  return {};
}

// ---- Change case (Word: Home › Aa, or Shift+F3 to cycle) ----

const CASES = {
  lower: s => s.toLowerCase(),
  upper: s => s.toUpperCase(),
  title: s => s.toLowerCase().replace(/(^|[\s\-‐/(“"'‘])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()),
  toggle: s => [...s].map(c => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join(''),
};

// Sentence case runs across the text nodes of the selection (a sentence can span bold and plain
// words), so it keeps track of whether the next letter starts a sentence.
function sentenceCase(texts) {
  let start = true;
  return texts.map(t => [...t.toLowerCase()].map(c => {
    if (/\p{L}/u.test(c)) { const out = start ? c.toUpperCase() : c; start = false; return out; }
    if (/[.!?]/.test(c)) start = true;
    return c;
  }).join(''));
}

// The mode Shift+F3 moves to next, from what the selection looks like now (Word cycles
// lowercase → UPPERCASE → Capitalise Each Word).
function nextCase(text) {
  if (text === text.toLowerCase()) return 'upper';
  if (text === text.toUpperCase()) return 'title';
  return 'lower';
}

export function changeCase(editor, mode) {
  const { state } = editor;
  const { from, to, empty } = state.selection;
  if (empty) return false;
  const parts = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true;
    const a = Math.max(from, pos), b = Math.min(to, pos + node.text.length);
    if (b > a) parts.push({ from: a, to: b, text: node.text.slice(a - pos, b - pos), marks: node.marks });
    return false;
  });
  if (!parts.length) return false;
  const m = mode === 'cycle' ? nextCase(parts.map(p => p.text).join('')) : mode;
  const out = m === 'sentence' ? sentenceCase(parts.map(p => p.text)) : parts.map(p => CASES[m](p.text));
  let tr = state.tr;
  // Same length (letter for letter), so positions don't move — but go from the end to be safe.
  for (let i = parts.length - 1; i >= 0; i--) {
    if (out[i] === parts[i].text) continue;
    tr = tr.replaceWith(parts[i].from, parts[i].to, state.schema.text(out[i], parts[i].marks));
  }
  tr.setSelection(state.selection.map(tr.doc, tr.mapping));
  editor.view.dispatch(tr);
  return true;
}

// ---- Grow / shrink font (Ctrl+Shift+> / <, Ctrl+] / [) ----

export const FONT_STEPS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];
const DEFAULT_PT = 11;
export function stepFont(editor, dir, exact = false) {
  const cur = parseFloat(editor.getAttributes('textStyle').fontSize) || DEFAULT_PT;
  let next;
  if (exact) next = Math.max(1, cur + dir);
  else next = dir > 0 ? FONT_STEPS.find(s => s > cur) ?? cur + 10 : [...FONT_STEPS].reverse().find(s => s < cur) ?? Math.max(1, cur - 1);
  return editor.chain().focus().setFontSize(`${next}pt`).run();
}

// ---- Format painter ----
// Copy: the marks at the cursor and the paragraph's alignment/spacing. Paste: onto the next
// selection, replacing that text's formatting — and, as in Word, the paragraph's formatting too
// only when whole paragraphs are selected.

const PARA_KEYS = ['textAlign', 'lineSpacing', 'spaceBefore', 'spaceAfter'];

export function copyFormat(editor) {
  const { state } = editor;
  const marks = (state.storedMarks || state.selection.$from.marks()).filter(m => m.type.name !== 'link');
  const para = paragraphFormat(state);
  return { marks: marks.map(m => ({ type: m.type.name, attrs: m.attrs })), para: Object.fromEntries(PARA_KEYS.map(k => [k, para[k] ?? null])) };
}

export function pasteFormat(editor, fmt) {
  if (!fmt) return false;
  const { $from, $to } = editor.state.selection;
  const wholeParagraphs = $from.parentOffset === 0 && $to.parentOffset === $to.parent.content.size;
  const chain = editor.chain().focus().unsetAllMarks();
  for (const m of fmt.marks) chain.setMark(m.type, m.attrs);
  if (wholeParagraphs) chain.updateAttributes('paragraph', fmt.para).updateAttributes('heading', fmt.para);
  return chain.run();
}

// ---- Word's keyboard shortcuts ----
// Before TipTap's own (priority), so Ctrl+E centres as in Word rather than marking code. Left out on
// purpose: Ctrl+Shift+V (the browser's paste as plain text), Ctrl+0 (browser zoom reset).
// Ctrl+K asks the toolbar to open its link box (an 'openLink' editor event).
export const WordKeys = Extension.create({
  name: 'wordKeys',
  priority: 1000,
  addKeyboardShortcuts() {
    const e = () => this.editor;
    const align = a => () => e().chain().focus().setTextAlign(a).run();
    return {
      'Mod-e': align('center'),
      'Mod-l': align('left'),
      'Mod-r': align('right'),
      'Mod-j': align('justify'),
      'Mod-Shift-.': () => stepFont(e(), 1),
      'Mod-Shift->': () => stepFont(e(), 1),
      'Mod-Shift-,': () => stepFont(e(), -1),
      'Mod-Shift-<': () => stepFont(e(), -1),
      'Mod-]': () => stepFont(e(), 1, true),
      'Mod-[': () => stepFont(e(), -1, true),
      'Mod-=': () => e().chain().focus().toggleSubscript().run(),
      'Mod-Shift-=': () => e().chain().focus().toggleSuperscript().run(),
      'Mod-Shift-+': () => e().chain().focus().toggleSuperscript().run(),
      'Mod-Shift-n': () => e().chain().focus().setParagraph().run(),
      'Mod-Space': () => e().chain().focus().unsetAllMarks().run(),
      'Shift-F3': () => changeCase(e(), 'cycle'),
      'Mod-k': () => { this.editor.emit('openLink'); return true; },
      // Tab in ordinary text types a tab (to the next tab stop, every 1.27 cm); in a list it
      // indents the item and in a table it moves to the next cell (handled first by those).
      Tab: () => {
        const ed = e();
        if (ed.isActive('listItem') || ed.isActive('table')) return false;
        return ed.commands.insertContent('\t');
      },
      'Mod-m': () => e().commands.shiftIndent(1),
      'Mod-Shift-m': () => e().commands.shiftIndent(-1),
    };
  },
});
