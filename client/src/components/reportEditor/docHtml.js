import normaliseLegacyHtml from './legacyHtml';
import { noteHtml } from '../../lib/utils';

// Session notes, note/agreement/email templates are stored as HTML (unlike written reports, which
// are stored as editor JSON) — they're shown in lists, emailed and substituted into on the server.
// These convert between what's stored and what DocEditor loads.

// Stored → editor: plain-text notes from before rich text get line breaks, old-editor markup is
// normalised, and in templates each {{variable}} in the text becomes a field chip. (Variables
// inside attributes — e.g. a link to {{signing_url}} — are left as they are.)
export function toEditorHtml(stored, { vars = false } = {}) {
  const tpl = document.createElement('template');
  tpl.innerHTML = noteHtml(stored || '');
  normaliseLegacyHtml(tpl.content);
  if (vars) {
    const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) {
      const t = walker.currentNode;
      if (/\{\{\w+\}\}/.test(t.nodeValue) && !t.parentElement?.closest('[data-var]')) texts.push(t);
    }
    for (const t of texts) {
      const frag = document.createDocumentFragment();
      t.nodeValue.split(/(\{\{\w+\}\})/).forEach(part => {
        const m = /^\{\{(\w+)\}\}$/.exec(part);
        if (m) {
          const span = document.createElement('span');
          span.setAttribute('data-var', m[1]);
          span.textContent = part;
          frag.appendChild(span);
        } else if (part) frag.appendChild(document.createTextNode(part));
      });
      t.replaceWith(frag);
    }
  }
  return tpl.innerHTML;
}

// Editor → stored. An empty document is stored as '' (so "required" checks still work).
export function fromEditor(editor) {
  return editor.isEmpty ? '' : editor.getHTML();
}
