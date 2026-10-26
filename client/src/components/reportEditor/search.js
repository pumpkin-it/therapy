import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { revealPos } from './reveal';

// Find and replace in the report (Ctrl+F / Ctrl+H, FindBar.jsx). Matches are found within each
// paragraph's text, so a word that's partly bold still matches; case is ignored. Matches are only
// highlighted (decorations), never saved.

export const searchKey = new PluginKey('search');

// Every match of `query` in the document, as { from, to }.
export function findMatches(doc, query) {
  const q = String(query || '').toLowerCase();
  if (!q) return [];
  const out = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // The paragraph's text, with each character's document position. Fields and pictures count as
    // one character that matches nothing.
    let text = '';
    const at = [];
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      if (child.isText) { for (let i = 0; i < child.text.length; i++) { text += child.text[i]; at.push(start + i); } }
      else { text += '￼'; at.push(start); }
    });
    const low = text.toLowerCase();
    for (let i = low.indexOf(q); i !== -1; i = low.indexOf(q, i + q.length)) {
      out.push({ from: at[i], to: at[i + q.length - 1] + 1 });
    }
    return false;
  });
  return out;
}

const decorate = (doc, matches, current) => DecorationSet.create(doc,
  matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === current ? 'search-match is-current' : 'search-match' })));

export const Search = Extension.create({
  name: 'search',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: searchKey,
      state: {
        init: () => ({ query: '', matches: [], current: -1, decos: DecorationSet.empty }),
        apply(tr, value) {
          const meta = tr.getMeta(searchKey);
          let { query, current } = value;
          if (meta) { query = meta.query ?? query; current = meta.current ?? current; }
          if (!meta && !tr.docChanged) return value;
          const matches = findMatches(tr.doc, query);
          if (current >= matches.length) current = matches.length - 1;
          if (current < 0 && matches.length) current = 0;
          return { query, matches, current, decos: query ? decorate(tr.doc, matches, current) : DecorationSet.empty };
        },
      },
      props: { decorations: state => searchKey.getState(state)?.decos },
    })];
  },
});

export const searchState = editor => (editor ? searchKey.getState(editor.state) : null) || { query: '', matches: [], current: -1 };

// Show `query`'s matches and move to the one at/after the cursor (or the current one).
export function setQuery(editor, query) {
  const from = editor.state.selection.from;
  const matches = findMatches(editor.state.doc, query);
  const next = matches.findIndex(m => m.from >= from);
  editor.view.dispatch(editor.state.tr.setMeta(searchKey, { query, current: matches.length ? (next === -1 ? 0 : next) : -1 }).setMeta('addToHistory', false));
  revealCurrent(editor);
}

function revealCurrent(editor) {
  const s = searchState(editor);
  const m = s.matches[s.current];
  if (!m) return;
  editor.chain().setTextSelection({ from: m.from, to: m.to }).run();
  // The find box keeps focus, so the editor won't scroll by itself — bring the match to the middle.
  revealPos(editor.view, m.from, 'center');
}

export function step(editor, dir) {
  const s = searchState(editor);
  if (!s.matches.length) return;
  const current = (s.current + dir + s.matches.length) % s.matches.length;
  editor.view.dispatch(editor.state.tr.setMeta(searchKey, { current }).setMeta('addToHistory', false));
  revealCurrent(editor);
}

export function replaceCurrent(editor, text) {
  const s = searchState(editor);
  const m = s.matches[s.current];
  if (!m) return;
  // Keeps the formatting of the text being replaced.
  const marks = editor.state.doc.resolve(m.from + 1).marks();
  const tr = editor.state.tr;
  if (text) tr.replaceWith(m.from, m.to, editor.schema.text(text, marks)); else tr.delete(m.from, m.to);
  editor.view.dispatch(tr);
  revealCurrent(editor);
}

export function replaceAll(editor, text) {
  const s = searchState(editor);
  if (!s.matches.length) return 0;
  const tr = editor.state.tr;
  // From the end backwards, so earlier positions stay valid.
  for (const m of [...s.matches].reverse()) {
    const marks = editor.state.doc.resolve(m.from + 1).marks();
    if (text) tr.replaceWith(m.from, m.to, editor.schema.text(text, marks)); else tr.delete(m.from, m.to);
  }
  editor.view.dispatch(tr);
  return s.matches.length;
}

export function clearSearch(editor) {
  if (!editor || editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setMeta(searchKey, { query: '', current: -1 }).setMeta('addToHistory', false));
}
