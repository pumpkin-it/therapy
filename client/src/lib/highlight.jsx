// Highlighting searched words: the same words the search matched (each as the start of a word).
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function searchTerms(q) {
  return [...new Set((String(q || '').match(/[\p{L}\p{N}@._'-]+/gu) || []).filter(w => w.length >= 2).map(w => w.toLowerCase()))];
}

export function termsRegex(terms) {
  if (!terms?.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])((?:${terms.map(escapeRe).join('|')})[\\p{L}\\p{N}]*)`, 'giu');
}

// Text with the searched words wrapped in <mark>.
export function Highlight({ text, terms }) {
  const re = termsRegex(terms);
  if (!re || !text) return text || null;
  const parts = String(text).split(re);
  return parts.map((part, i) => (i % 2 === 1 ? <mark key={i} className="rounded-sm bg-yellow-200 px-0.5 text-inherit">{part}</mark> : part));
}

// The same inside an email's HTML (a same-origin frame): wraps matches in text nodes, returns the
// first <mark> so the page can bring it into view.
export function highlightDocument(doc, terms) {
  const re = termsRegex(terms);
  if (!re || !doc?.body) return null;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.parentNode && ['SCRIPT', 'STYLE', 'MARK'].includes(n.parentNode.nodeName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  let first = null;
  for (const node of nodes) {
    const parts = node.nodeValue.split(re);
    if (parts.length < 2) continue;
    const frag = doc.createDocumentFragment();
    parts.forEach((part, i) => {
      if (i % 2 === 1) {
        const m = doc.createElement('mark');
        m.style.cssText = 'background:#fef08a;color:inherit;border-radius:2px;padding:0 1px';
        m.textContent = part;
        frag.appendChild(m);
        if (!first) first = m;
      } else if (part) frag.appendChild(doc.createTextNode(part));
    });
    node.parentNode.replaceChild(frag, node);
  }
  return first;
}
