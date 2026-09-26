const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { renderReportBody, usedFonts } = require('./reportHtml');
const { fontFaceCss } = require('./reportFonts');

// Prints a written report to PDF with headless Chrome — the same engine the editor runs in, fed the
// same stylesheet and fonts, so the PDF matches the page on screen (and its page guides).
//
// Runs on the shared 1GB server (measured 2026-09-26: ~250MB for a few seconds on a 20-page,
// picture-heavy report, ~3.5s each), so: Chrome is started only when a PDF is needed and always
// closed straight after, only ONE render happens at a time (the rest queue), and a render that
// hangs is killed after RENDER_TIMEOUT_MS.

const RENDER_TIMEOUT_MS = 90 * 1000;
const MARGIN = '19.05mm'; // 72px at 96dpi — the editor page's padding (PageGuides.jsx PAGE.margin)
const DOC_CSS_FILE = path.join(__dirname, '../../client/src/components/reportEditor/report-doc.css');

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
  @page { size: A4; }
  html, body { background: #fff; }
  .report-doc { min-height: 0; }
  .pdf-page-break { break-after: page; height: 0; margin: 0 !important; }
  .pdf-img { display: flex; }
  .pdf-logo { display: inline-block; vertical-align: middle; }
  tr, img, .pdf-img { break-inside: avoid; }
  h1, h2, h3 { break-after: avoid; }
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

// doc: TipTap JSON; fields: frozen field values; footer: { clientName, title }.
function renderReportPdf({ doc, fields, footer }) {
  const job = queue.then(() => renderNow({ doc, fields, footer }));
  queue = job.catch(() => {}); // a failed render mustn't block the ones queued behind it
  return job;
}

async function renderNow({ doc, fields, footer }) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    ${fontFaceCss(usedFonts(doc))}
    ${RESET_CSS}
    ${fs.readFileSync(DOC_CSS_FILE, 'utf8')}
    ${PDF_CSS}
  </style></head><body><div class="report-doc">${renderReportBody(doc, { fields })}</div></body></html>`;

  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const footerTemplate = `<div style="width:100%;font-family:Arial,Helvetica,sans-serif;font-size:8pt;color:#6b7280;padding:0 ${MARGIN};display:flex;justify-content:space-between;">
    <span>${esc(footer.clientName)} · ${esc(footer.title)}</span>
    <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;

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
      await page.evaluateHandle('document.fonts.ready');
      return page.pdf({
        format: 'A4', printBackground: true,
        margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
        displayHeaderFooter: true, headerTemplate: '<div></div>', footerTemplate,
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

module.exports = { renderReportPdf };
