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
      case 'subscript': html = `<sub>${html}</sub>`; break;
      case 'superscript': html = `<sup>${html}</sup>`; break;
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

// A paragraph's alignment, line spacing and space before/after (client wordFormat.js: Word's line
// spacing × 1.15 = CSS line-height; spacing in pt).
const SINGLE_LINE = 1.15;
const ptOk = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 200;
function alignStyle(a = {}) {
  const st = [];
  if (['left', 'center', 'right', 'justify'].includes(a.textAlign)) st.push(`text-align:${a.textAlign}`);
  const ls = Number(a.lineSpacing);
  if (a.lineSpacing && ls > 0 && ls <= 5) st.push(`line-height:${Math.round(ls * SINGLE_LINE * 1000) / 1000}`);
  if (ptOk(a.spaceBefore)) st.push(`margin-top:${Number(a.spaceBefore)}pt`);
  if (ptOk(a.spaceAfter)) st.push(`margin-bottom:${Number(a.spaceAfter)}pt`);
  // Indents in cm (first line negative = hanging).
  const cm = (v, min) => (v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= 30 && Number(v) !== 0 ? Number(v) : null);
  if (cm(a.indentLeft, 0) != null) st.push(`margin-left:${cm(a.indentLeft, 0)}cm`);
  if (cm(a.indentRight, 0) != null) st.push(`margin-right:${cm(a.indentRight, 0)}cm`);
  if (cm(a.indentFirst, -30) != null) st.push(`text-indent:${cm(a.indentFirst, -30)}cm`);
  return st.length ? ` style="${st.join(';')}"` : '';
}

// A table wider than the text area has its column widths shrunk to fit (the same sum as the editor,
// client pageSetup.js tableFitFactor). Left too wide, Chrome shrinks the whole PDF to get it on.
const MIN_COLUMN = 24;
function tableFitFactor(widths, textWidth) {
  if (!textWidth) return 1;
  const fixed = widths.reduce((sum, w) => sum + (w || 0), 0);
  const unset = widths.filter(w => !w).length;
  if (!fixed || fixed + unset * MIN_COLUMN <= textWidth) return 1;
  return Math.max(0, textWidth - (unset * textWidth) / widths.length) / fixed;
}

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
      const k = tableFitFactor(widths.map(Number), ctx.textWidth);
      const colgroup = widths.some(Boolean) ? `<colgroup>${widths.map(w => (w ? `<col style="width:${k < 1 ? Math.max(MIN_COLUMN, Math.floor(w * k)) : Number(w)}px">` : '<col>')).join('')}</colgroup>` : '';
      // A repeated header row goes in <thead>: Chrome prints it again at the top of every page.
      const rows = n.content || [];
      if (a.repeatHeader && rows.length > 1) return `<table>${colgroup}<thead>${renderNode(rows[0], ctx)}</thead><tbody>${renderNodes(rows.slice(1), ctx)}</tbody></table>`;
      return `<table>${colgroup}<tbody>${renderNodes(rows, ctx)}</tbody></table>`;
    }
    // Row height and cell shading set in the editor (client tables.js); colours are checked so
    // nothing but a plain colour value reaches the style attribute.
    case 'tableRow': {
      const h = Number(a.height);
      return `<tr${h > 0 ? ` style="height:${Math.round(h)}px"` : ''}>${renderNodes(n.content, ctx)}</tr>`;
    }
    case 'tableHeader':
    case 'tableCell': {
      const tag = n.type === 'tableHeader' ? 'th' : 'td';
      const span = `${a.colspan > 1 ? ` colspan="${Number(a.colspan)}"` : ''}${a.rowspan > 1 ? ` rowspan="${Number(a.rowspan)}"` : ''}`;
      const st = [];
      if (/^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(String(a.background || '').trim())) st.push(`background-color:${String(a.background).trim()}`);
      if (['middle', 'bottom'].includes(a.valign)) st.push(`vertical-align:${a.valign}`);
      // Sides drawn without a line (client tables.js setBorders).
      if (/^[trbl]{1,4}$/.test(a.borders || '')) for (const k of a.borders) st.push(`border-${{ t: 'top', r: 'right', b: 'bottom', l: 'left' }[k]}:none`);
      return `<${tag}${span}${st.length ? ` style="${st.join(';')}"` : ''}>${renderNodes(n.content, ctx)}</${tag}>`;
    }
    // A picture on its own line (left, centre or right), or in line with the text (images.js).
    case 'image':
    case 'inlineImage': {
      const src = imageSrc(a.src);
      if (!src) return '';
      const inline = n.type === 'inlineImage';
      const size = [a.width && `width:${Number(a.width)}px`, a.height && `height:${Number(a.height)}px`, inline && a.valign === 'middle' && 'vertical-align:middle'].filter(Boolean).join(';');
      const img = `<img${inline ? ' class="pdf-inline-img"' : ''} src="${src}" alt="${esc(a.alt)}"${size ? ` style="${size}"` : ''}>`;
      if (inline) return img;
      const justify = { center: 'center', right: 'flex-end' }[a.align];
      return `<div class="pdf-img"${justify ? ` style="justify-content:${justify}"` : ''}>${img}</div>`;
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

// textWidth: the width between the margins, px (none: tables aren't fitted).
function renderReportBody(doc, { fields, textWidth }) {
  const logo = dataUri(path.join(UPLOADS, 'logo'));
  return renderNodes(trimTrailing(doc).content, { fields, logo, textWidth });
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
