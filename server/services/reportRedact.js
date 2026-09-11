const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');

// mupdf ships as ESM with top-level await, which a CommonJS require() can't load synchronously
// — must go through dynamic import(). Cached so we only pay the import cost once per process.
let mupdfPromise;
function loadMupdf() {
  if (!mupdfPromise) mupdfPromise = import('mupdf');
  return mupdfPromise;
}

// Rasterization DPI — high enough that page 1's letterhead/branding is crisp, low enough that
// a 30+ page report doesn't take forever to process on a t3a.micro.
const RENDER_DPI = 150;
// A plain isotropic Gaussian blur wide enough to destroy letters also merges every line in a
// paragraph into one flat grey rectangle — useless as "proof of a real, finished document".
// Instead we blur only horizontally: squash each page to HORIZONTAL_SQUASH_PX wide (destroying
// per-letter/per-word detail) then stretch it back to full width. The vertical axis is never
// resampled, so line spacing and paragraph breaks stay crisp — it reads as real multi-line
// content, just illegible. A small final isotropic blur only smooths resize aliasing.
const HORIZONTAL_SQUASH_PX = 20;
const FINAL_SMOOTH_SIGMA = 2.5;

const WATERMARK_TILE_SVG = Buffer.from(`
  <svg xmlns='http://www.w3.org/2000/svg' width='420' height='420'>
    <text x='210' y='202' font-size='27' font-family='sans-serif' font-weight='700'
      fill='#dc2626' fill-opacity='0.4' text-anchor='middle'
      transform='rotate(-30 210 210)'>DRAFT ONLY</text>
    <text x='210' y='236' font-size='27' font-family='sans-serif' font-weight='700'
      fill='#dc2626' fill-opacity='0.4' text-anchor='middle'
      transform='rotate(-30 210 210)'>NOT FOR SUBMISSION</text>
  </svg>
`);

// Builds a watermarked, text-free preview PDF from an original PDF buffer. The first
// `visiblePages` pages are rendered in full (still watermarked, so it can never pass for the
// released copy) so the client can confirm the report is genuinely theirs and finished — every
// remaining page is blurred. Always leaves at least one page blurred when there's more than one
// page total, so a mistaken/too-high visiblePages value can never reveal the entire document.
// Every page is rasterized to a bitmap first (via mupdf's WASM renderer) — this is what
// guarantees the preview has no selectable/extractable text layer at all, regardless of how
// the blur is applied. The blur itself is then a pixel transform (sharp), irreversible, not a
// CSS-style overlay that could be stripped back off.
async function generateReportPreview(originalBuffer, visiblePages = 1) {
  const mupdf = await loadMupdf();
  const doc = mupdf.Document.openDocument(originalBuffer, 'application/pdf');
  const pageCount = doc.countPages();
  const safeVisiblePages = Math.max(0, Math.min(visiblePages, pageCount > 1 ? pageCount - 1 : 0));
  const watermarkTile = await sharp(WATERMARK_TILE_SVG).png().toBuffer();

  const previewDoc = await PDFDocument.create();
  const scale = RENDER_DPI / 72;

  for (let i = 0; i < pageCount; i++) {
    const page = doc.loadPage(i);
    const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
    const rawPng = pixmap.asPNG();

    let pageImage;
    if (i < safeVisiblePages) {
      // Shown in full — still watermarked, never bare, so it can't double as the final PDF.
      pageImage = await sharp(rawPng)
        .composite([{ input: watermarkTile, tile: true, blend: 'over' }])
        .png()
        .toBuffer();
    } else {
      const { width, height } = await sharp(rawPng).metadata();
      // sharp doesn't chain two .resize() calls on one pipeline — the second silently replaces
      // the first — so the down-squash must be materialized as its own buffer before upscaling.
      const squashed = await sharp(rawPng)
        .resize({ width: HORIZONTAL_SQUASH_PX, height, fit: 'fill' })
        .toBuffer();
      const horizontallySmeared = await sharp(squashed)
        .resize({ width, height, fit: 'fill' })
        .toBuffer();
      pageImage = await sharp(horizontallySmeared)
        .blur(FINAL_SMOOTH_SIGMA)
        .composite([{ input: watermarkTile, tile: true, blend: 'over' }])
        .png()
        .toBuffer();
    }

    const embeddedImage = await previewDoc.embedPng(pageImage);
    const previewPage = previewDoc.addPage([embeddedImage.width, embeddedImage.height]);
    previewPage.drawImage(embeddedImage, { x: 0, y: 0, width: embeddedImage.width, height: embeddedImage.height });
  }

  return Buffer.from(await previewDoc.save());
}

module.exports = { generateReportPreview };
