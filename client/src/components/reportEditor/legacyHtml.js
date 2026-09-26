// Turns markup saved by the old editor (Quill) into the plain HTML the document editor and the PDF
// understand: Quill 2 stores every list as one flat <ol> whose items carry data-list and
// ql-indent-N, and alignment, indents, fonts and sizes as ql-* classes.
//
// Deliberately one self-contained function with no imports: the server runs this exact source
// inside Chrome when it prints session notes and agreements (server/services/docPdf.js reads this
// file), so an old note or a signed agreement prints the same as it shows in the editor.
export default function normaliseLegacyHtml(root) {
  root.querySelectorAll('span.ql-ui').forEach(el => el.remove());

  root.querySelectorAll('ol, ul').forEach(list => {
    const items = [...list.children].filter(li => li.tagName === 'LI' && li.hasAttribute('data-list'));
    if (!items.length || !list.parentNode) return;
    const doc = list.ownerDocument;
    const frag = doc.createDocumentFragment();
    const stack = []; // open lists, outermost first: { el, type, level }
    for (const li of items) {
      const type = li.getAttribute('data-list') === 'ordered' ? 'OL' : 'UL';
      const level = Number((li.className.match(/ql-indent-(\d+)/) || [])[1] || 0);
      while (stack.length) {
        const t = stack[stack.length - 1];
        if (t.level > level || (t.level === level && t.type !== type)) stack.pop();
        else break;
      }
      let top = stack[stack.length - 1];
      if (!top || top.level < level) {
        const el = doc.createElement(type);
        if (top) (top.el.lastElementChild || top.el).appendChild(el);
        else frag.appendChild(el);
        top = { el, type, level };
        stack.push(top);
      }
      li.removeAttribute('data-list');
      top.el.appendChild(li);
    }
    list.replaceWith(frag);
  });

  const sizes = { small: '0.75em', large: '1.5em', huge: '2.5em' };
  root.querySelectorAll('[class*="ql-"]').forEach(el => {
    const c = el.getAttribute('class') || '';
    let m;
    if ((m = c.match(/ql-align-(center|right|justify)/))) el.style.textAlign = m[1];
    if ((m = c.match(/ql-indent-(\d+)/)) && el.tagName !== 'LI') el.style.paddingLeft = `${Number(m[1]) * 3}em`;
    if ((m = c.match(/ql-font-(serif|monospace)/))) el.style.fontFamily = m[1] === 'serif' ? 'Georgia' : 'Courier New';
    if ((m = c.match(/ql-size-(small|large|huge)/))) el.style.fontSize = sizes[m[1]];
    const rest = c.split(/\s+/).filter(x => x && !x.startsWith('ql-')).join(' ');
    if (rest) el.setAttribute('class', rest);
    else el.removeAttribute('class');
  });
}
