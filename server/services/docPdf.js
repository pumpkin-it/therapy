const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { renderReportBody, usedFonts, imageSrc } = require('./reportHtml');
const { fontFaceCss, REPORT_FONT_NAMES } = require('./reportFonts');

// Prints a written report to PDF with headless Chrome — the same engine the editor runs in, fed the
// same stylesheet and fonts, so the PDF matches the page on screen (and its page guides).
//
// Runs on the shared 1GB server (measured 2026-09-26: ~250MB for a few seconds on a 20-page,
// picture-heavy report, ~3.5s each), so: Chrome is started only when a PDF is needed and always
// closed straight after, only ONE render happens at a time (the rest queue), and a render that
// hangs is killed after RENDER_TIMEOUT_MS.

const RENDER_TIMEOUT_MS = 90 * 1000;
// The page: A4, with the document's own margins and orientation (client pageSetup.js pageGeometry,
// which the editor's pages use) — by default 72px (1.9 cm) all round, portrait.
const PX_PER_CM = 96 / 2.54;
const A4_PX = { width: 793.7, height: 1122.52 }; // 210 x 297 mm
function pageLayout(page) {
  const cm = v => (Number.isFinite(Number(v)) && Number(v) >= 0.5 && Number(v) <= 8 ? Number(v) : 72 / PX_PER_CM);
  const px = v => (page ? Math.round(cm(v) * PX_PER_CM) : 72);
  return { landscape: page?.orientation === 'landscape', top: px(page?.top), bottom: px(page?.bottom), left: px(page?.left), right: px(page?.right) };
}

// The header and footer (client pageSetup.js): three parts with {fields}. No footer set = the
// standard one; a header or footer with every part empty prints nothing.
const HF_SLOTS = ['left', 'center', 'right'];
const DEFAULT_FOOTER = { left: '{client} · {title}', center: '', right: 'Page {page} of {pages}' };
function hfTemplate(hf, values, layout) {
  if (!hf || HF_SLOTS.every(k => !String(hf[k] || '').trim())) return '<div></div>';
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const fill = text => esc(String(text || '')
    .replace(/\{(client|title|date)\}/g, (m, k) => String(values[k] ?? ''))
    .replace(/^\s*·\s*|\s*·\s*$/g, '')
    .replace(/\s*·\s*·\s*/g, ' · '))
    .replace(/\{page\}/g, '<span class="pageNumber"></span>').replace(/\{pages\}/g, '<span class="totalPages"></span>');
  // With nothing in the centre, the left part may run on to the right part (a long report title).
  const flex = k => (String(hf.center || '').trim() ? '1 1 0' : k === 'left' ? '1 1 auto' : k === 'right' ? '0 0 auto' : '0 0 0');
  const parts = HF_SLOTS.map(k => `<span style="flex:${flex(k)};min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:pre;text-align:${k}">${fill(hf[k])}</span>`).join('');
  return `<div style="width:100%;font-family:Arial,Helvetica,sans-serif;font-size:8pt;color:#6b7280;padding:0 ${layout.right}px 0 ${layout.left}px;display:flex;gap:16px;">${parts}</div>`;
}
const DOC_CSS_FILE = path.join(__dirname, '../../client/src/components/reportEditor/report-doc.css');
// Old-editor (Quill) markup clean-up, shared with the editor — run inside Chrome before printing.
const LEGACY_JS_FILE = path.join(__dirname, '../../client/src/components/reportEditor/legacyHtml.js');

// The editor sits inside Tailwind's preflight reset; the PDF has no Tailwind, so the parts of that
// reset the report styles rely on are repeated here — otherwise default browser margins would
// shift every line and break the match with the editor.
const RESET_CSS = `
  *, ::before, ::after { box-sizing: border-box; border: 0 solid; margin: 0; padding: 0; }
  html { -webkit-text-size-adjust: 100%; }
  body { line-height: inherit; }
  h1, h2, h3, h4, h5, h6 { font-size: inherit; font-weight: inherit; }
  ol, ul { list-style: none; }
  a { color: inherit; text-decoration: inherit; }
  b, strong { font-weight: bolder; }
  table { text-indent: 0; border-color: inherit; border-collapse: collapse; }
  img { display: block; vertical-align: middle; max-width: 100%; height: auto; }
  hr { height: 0; color: inherit; border-top-width: 1px; }
`;
const PDF_CSS = `
  html, body { background: #fff; }
  .report-doc { min-height: 0; }
  .pdf-page-break { break-after: page; height: 0; margin: 0 !important; }
  .pdf-img { display: flex; }
  .pdf-inline-img { display: inline-block; vertical-align: baseline; max-width: 100%; }
  .pdf-logo { display: inline-block; vertical-align: middle; }
  /* Table rows may break across pages (Word's default "Allow row to break across pages"): only the
     lines that don't fit move on. A line, picture or logo is never cut. */
  img, .pdf-img { break-inside: avoid; }
  /* The editor positions cells (for its column-resize handle). In print, a positioned header cell's
     grey background paints over the collapsed border beside it, so header lines went missing. */
  .report-doc td, .report-doc th { position: static; }
  h1, h2, h3 { break-after: avoid; }
  /* Page breaks saved in HTML (notes, templates) — the editor's dashed marker isn't printed. */
  .report-doc .page-break { break-after: page; border: 0; height: 0; margin: 0; }
  .report-doc .page-break::after { content: none; }
  /* Reports: text wraps exactly as in the editor (TipTap's own text settings) — spaces and tabs kept. */
  .report-doc.pm-text { white-space: break-spaces; word-wrap: break-word; font-variant-ligatures: none; }
`;

async function launchBrowser() {
  if (process.platform === 'linux') {
    const chromium = require('@sparticuz/chromium');
    return puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  }
  // Local development on a Mac: use the installed Chrome (or CHROME_PATH).
  const executablePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  return puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
}

let queue = Promise.resolve();

function enqueue(job) {
  const run = queue.then(job);
  queue = run.catch(() => {}); // a failed render mustn't block the ones queued behind it
  return run;
}

// A written report. doc: TipTap JSON; fields: frozen field values; footer: { clientName, title }.
// The document's page setup, header and footer are on doc.attrs (client pageSetup.js).
function renderReportPdf({ doc, fields, footer }) {
  const a = doc.attrs || {};
  const layout = pageLayout(a.page);
  const textWidth = Math.floor((layout.landscape ? A4_PX.height : A4_PX.width) - layout.left - layout.right);
  return enqueue(() => renderNow({ body: renderReportBody(doc, { fields, textWidth }), fonts: usedFonts(doc), footer, page: a.page, header: a.header, footerParts: a.footer }));
}

// Pictures in saved HTML point at /api/report-images/…; Chrome has no network, so embed them.
// Anything else that isn't already embedded is dropped.
const embedImages = html => String(html || '').replace(/(<img\b[^>]*?\ssrc=")([^"]*)(")/gi, (m, a, src, b) => {
  const data = imageSrc(src.replace(/&amp;/g, '&'));
  return data ? `${a}${data}${b}` : `${a}${b}`;
});
const fontsIn = html => ['Arial', ...REPORT_FONT_NAMES.filter(f => f !== 'Arial' && html.includes(f))];

// Stored HTML (session notes, agreements). Old-editor markup is cleaned up the same way the editor
// does (legacyHtml.js) before printing.
function renderHtmlPdf({ html, footer }) {
  const body = embedImages(html);
  return enqueue(() => renderNow({ body, fonts: fontsIn(body), footer, legacy: true }));
}

async function renderNow({ body, fonts, footer, page: pageSetup = null, header = null, footerParts = null, legacy = false }) {
  const layout = pageLayout(pageSetup);
  // No script in the document can run (the legacy clean-up is run by puppeteer itself).
  const html = `<!doctype html><html><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="script-src 'none'"><style>
    ${fontFaceCss(fonts)}
    ${RESET_CSS}
    ${fs.readFileSync(DOC_CSS_FILE, 'utf8')}
    ${PDF_CSS}
    @page { size: A4 ${layout.landscape ? 'landscape' : 'portrait'}; }
  </style></head><body><div class="report-doc${legacy ? '' : ' pm-text'}">${body}</div></body></html>`;

  const values = { client: footer?.clientName || '', title: footer?.title || '', date: new Date().toLocaleDateString('en-AU', { timeZone: 'Australia/Melbourne', day: 'numeric', month: 'long', year: 'numeric' }) };
  const headerTemplate = hfTemplate(header, values, layout);
  const footerTemplate = hfTemplate(footerParts || DEFAULT_FOOTER, values, layout);

  let browser;
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('PDF render timed out')), RENDER_TIMEOUT_MS));
  try {
    const work = (async () => {
      browser = await launchBrowser();
      const page = await browser.newPage();
      // Nothing in the document may reach the network — pictures, logo and fonts are all embedded.
      await page.setRequestInterception(true);
      page.on('request', req => (req.url().startsWith('data:') ? req.continue() : req.abort()));
      await page.setContent(html, { waitUntil: 'load' });
      if (legacy) {
        const fn = fs.readFileSync(LEGACY_JS_FILE, 'utf8').replace(/^export default /m, '');
        await page.evaluate(`(${fn.slice(fn.indexOf('function normaliseLegacyHtml'))})(document.querySelector('.report-doc'))`);
      }
      await page.evaluateHandle('document.fonts.ready');
      return page.pdf({
        format: 'A4', landscape: layout.landscape, printBackground: true,
        margin: { top: `${layout.top}px`, bottom: `${layout.bottom}px`, left: `${layout.left}px`, right: `${layout.right}px` },
        displayHeaderFooter: true, headerTemplate, footerTemplate,
      });
    })();
    // Whatever happens — success, error or timeout (even one that fires while Chrome is still
    // starting) — Chrome is closed once the work settles, so it never lingers using memory.
    work.catch(() => {}).finally(() => browser?.close().catch(() => {}));
    return Buffer.from(await Promise.race([work, timeout]));
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

module.exports = { renderReportPdf, renderHtmlPdf };
