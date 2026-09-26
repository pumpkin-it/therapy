const fs = require('fs');
const path = require('path');

// Turns a saved report (TipTap JSON, as written by client/src/pages/ReportEditor.jsx) into the
// HTML the PDF is printed from. Written by hand rather than with TipTap's own generateHTML so the
// server needs none of the editor's (browser/React) code — and so every node type is spelled out:
// if the editor gains a new one, it must be added here or it's left out of the PDF.

const UPLOADS = path.join(__dirname, '../../uploads');
const IMAGE_DIR = path.join(UPLOADS, 'report-images');

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Only simple, known-safe CSS values make it into a style attribute.
const safeCss = v => (typeof v === 'string' && /^[#\w\s.,'"%()-]{1,60}$/.test(v) && !/url|expression|;/.test(v) ? v : null);

function mimeFromMagic(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.slice(0, 3).toString() === 'GIF') return 'image/gif';
  if (buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.slice(0, 5).toString().includes('<svg') || buf.slice(0, 5).toString() === '<?xml') return 'image/svg+xml';
  return 'application/octet-stream';
}
const dataUri = file => {
  try { const b = fs.readFileSync(file); return `data:${mimeFromMagic(b)};base64,${b.toString('base64')}`; } catch { return null; }
};

// Pictures are embedded, never fetched — the PDF renderer has no network access to the app.
function imageSrc(src) {
  const m = /^\/api\/report-images\/([a-f0-9]{48}\.(png|jpe?g|gif|webp))$/.exec(src || '');
  if (m) return dataUri(path.join(IMAGE_DIR, m[1]));
  if (/^data:image\/(png|jpeg|gif|webp);base64,/.test(src || '')) return src;
  return null;
}

const LOGO_WIDTHS = { small: 110, medium: 180, large: 260 };

function marksToHtml(text, marks = []) {
  let html = esc(text);
  const styles = [];
  for (const m of marks) {
    const a = m.attrs || {};
    switch (m.type) {
      case 'bold': html = `<strong>${html}</strong>`; break;
      case 'italic': html = `<em>${html}</em>`; break;
      case 'underline': html = `<u>${html}</u>`; break;
      case 'strike': html = `<s>${html}</s>`; break;
      case 'code': html = `<code>${html}</code>`; break;
      case 'link': if (/^(https?:|mailto:)/i.test(a.href || '')) html = `<a href="${esc(a.href)}">${html}</a>`; break;
      case 'highlight': html = `<mark style="background-color:${safeCss(a.color) || '#ffff00'}">${html}</mark>`; break;
      case 'textStyle':
        if (safeCss(a.color)) styles.push(`color:${a.color}`);
        if (safeCss(a.fontFamily)) styles.push(`font-family:${a.fontFamily}`);
        if (safeCss(a.fontSize)) styles.push(`font-size:${a.fontSize}`);
        break;
      default: break;
    }
  }
  return styles.length ? `<span style="${esc(styles.join(';'))}">${html}</span>` : html;
}

const alignStyle = a => (['left', 'center', 'right', 'justify'].includes(a?.textAlign) ? ` style="text-align:${a.textAlign}"` : '');

function renderNodes(nodes, ctx) { return (nodes || []).map(n => renderNode(n, ctx)).join(''); }

function renderNode(n, ctx) {
  const a = n.attrs || {};
  switch (n.type) {
    case 'doc': return renderNodes(n.content, ctx);
    case 'text': return marksToHtml(n.text, n.marks);
    case 'paragraph': return `<p${alignStyle(a)}>${renderNodes(n.content, ctx) || '<br>'}</p>`;
    case 'heading': { const l = Math.min(6, Math.max(1, Number(a.level) || 1)); return `<h${l}${alignStyle(a)}>${renderNodes(n.content, ctx)}</h${l}>`; }
    case 'bulletList': return `<ul>${renderNodes(n.content, ctx)}</ul>`;
    case 'orderedList': return `<ol${a.start && a.start !== 1 ? ` start="${Number(a.start)}"` : ''}>${renderNodes(n.content, ctx)}</ol>`;
    case 'listItem': return `<li>${renderNodes(n.content, ctx)}</li>`;
    case 'blockquote': return `<blockquote>${renderNodes(n.content, ctx)}</blockquote>`;
    case 'codeBlock': return `<pre><code>${esc((n.content || []).map(c => c.text).join(''))}</code></pre>`;
    case 'hardBreak': return '<br>';
    case 'horizontalRule': return '<hr>';
    case 'pageBreak': return '<div class="pdf-page-break"></div>';
    case 'table': {
      // Column widths set by dragging in the editor live on the first row's cells.
      const firstRow = n.content?.[0]?.content || [];
      const widths = firstRow.flatMap(c => (c.attrs?.colwidth || Array(c.attrs?.colspan || 1).fill(null)));
      const colgroup = widths.some(Boolean) ? `<colgroup>${widths.map(w => (w ? `<col style="width:${Number(w)}px">` : '<col>')).join('')}</colgroup>` : '';
      return `<table>${colgroup}<tbody>${renderNodes(n.content, ctx)}</tbody></table>`;
    }
    case 'tableRow': return `<tr>${renderNodes(n.content, ctx)}</tr>`;
    case 'tableHeader':
    case 'tableCell': {
      const tag = n.type === 'tableHeader' ? 'th' : 'td';
      const span = `${a.colspan > 1 ? ` colspan="${Number(a.colspan)}"` : ''}${a.rowspan > 1 ? ` rowspan="${Number(a.rowspan)}"` : ''}`;
      return `<${tag}${span}>${renderNodes(n.content, ctx)}</${tag}>`;
    }
    case 'image': {
      const src = imageSrc(a.src);
      if (!src) return '';
      const size = [a.width && `width:${Number(a.width)}px`, a.height && `height:${Number(a.height)}px`].filter(Boolean).join(';');
      return `<div class="pdf-img"><img src="${src}" alt="${esc(a.alt)}"${size ? ` style="${size}"` : ''}></div>`;
    }
    // Fields print as plain text with the values frozen when the version was committed.
    case 'clientField': return esc(ctx.fields?.[a.key] ?? '');
    case 'practiceLogo': return ctx.logo ? `<img class="pdf-logo" src="${ctx.logo}" alt="" style="width:${LOGO_WIDTHS[a.size] || LOGO_WIDTHS.medium}px">` : '';
    default: return renderNodes(n.content, ctx);
  }
}

// Trailing empty lines and page breaks (e.g. a row of Enter presses at the end) would otherwise
// print as blank pages.
function trimTrailing(doc) {
  const content = [...(doc.content || [])];
  const isBlank = n => (n.type === 'paragraph' && !(n.content || []).length) || n.type === 'pageBreak';
  while (content.length && isBlank(content[content.length - 1])) content.pop();
  return { ...doc, content };
}

function renderReportBody(doc, { fields }) {
  const logo = dataUri(path.join(UPLOADS, 'logo'));
  return renderNodes(trimTrailing(doc).content, { fields, logo });
}

// Every font family a document uses (the default is Arial) — only those get embedded.
function usedFonts(doc) {
  const found = new Set(['Arial']);
  const walk = n => {
    for (const m of n.marks || []) if (m.type === 'textStyle' && m.attrs?.fontFamily) found.add(m.attrs.fontFamily.replace(/['"]/g, '').split(',')[0].trim());
    (n.content || []).forEach(walk);
  };
  walk(doc);
  return [...found];
}

module.exports = { renderReportBody, usedFonts, imageSrc, dataUri };
