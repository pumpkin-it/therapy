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
// a 30+ page report doesn't take forever to process on a t3a.micro. Every point off this
// directly shrinks the pixel count every sharp operation below has to churn through, so this is
// the main lever if generation ever needs to get faster again.
const RENDER_DPI = 100;
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

  const scale = RENDER_DPI / 72;

  // Pass 1: rasterize every page via mupdf. This is synchronous WASM work — cheap relative to
  // what follows — so it stays a plain loop.
  const rasterized = [];
  for (let i = 0; i < pageCount; i++) {
    const pixmap = doc.loadPage(i).toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
    rasterized.push({ rawPng: pixmap.asPNG(), width: pixmap.getWidth(), height: pixmap.getHeight() });
  }

  // Pass 2: the actual expensive work (resize/blur/composite/encode) runs on sharp's own
  // libvips thread pool, not Node's single JS thread — kicking off every page at once instead
  // of awaiting them one by one lets libvips genuinely parallelize across pages.
  const pageImages = await Promise.all(rasterized.map(({ rawPng, width, height }, i) => {
    if (i < safeVisiblePages) {
      // Shown in full — still watermarked, never bare, so it can't double as the final PDF.
      return sharp(rawPng).composite([{ input: watermarkTile, tile: true, blend: 'over' }]).png().toBuffer();
    }
    // sharp doesn't chain two .resize() calls on one pipeline — the second silently replaces
    // the first — so the down-squash must be materialized as its own buffer before upscaling.
    return sharp(rawPng)
      .resize({ width: HORIZONTAL_SQUASH_PX, height, fit: 'fill' })
      .toBuffer()
      .then(squashed => sharp(squashed).resize({ width, height, fit: 'fill' }).toBuffer())
      .then(smeared => sharp(smeared).blur(FINAL_SMOOTH_SIGMA).composite([{ input: watermarkTile, tile: true, blend: 'over' }]).png().toBuffer());
  }));

  const previewDoc = await PDFDocument.create();
  for (const pageImage of pageImages) {
    const embeddedImage = await previewDoc.embedPng(pageImage);
    const previewPage = previewDoc.addPage([embeddedImage.width, embeddedImage.height]);
    previewPage.drawImage(embeddedImage, { x: 0, y: 0, width: embeddedImage.width, height: embeddedImage.height });
  }

  return Buffer.from(await previewDoc.save());
}

// Image sharing has no "pages" concept — a single photo/scan is either fully blurred (pending)
// or fully visible (released), no partial reveal. The horizontal-smear trick above exists
// specifically to preserve text-line structure, which doesn't apply to a continuous-tone photo
// — a plain strong isotropic blur reads more naturally there (still shows general shape/colour,
// destroys any readable detail) and is cheaper besides. Format (jpeg/png) is preserved.
const IMAGE_BLUR_SIGMA = 25;

async function generateImagePreview(originalBuffer, mimeType) {
  // sharp's tiled composite requires the tile to be no larger than the base image — the fixed
  // 420x420 watermark (sized for full-page PDF renders) can exceed a small photo, so shrink it
  // to fit rather than let composite() throw.
  const { width, height } = await sharp(originalBuffer).metadata();
  const tileSize = Math.max(60, Math.min(420, width, height));
  const watermarkTile = await sharp(WATERMARK_TILE_SVG).resize(tileSize, tileSize).png().toBuffer();
  const blurred = sharp(originalBuffer).blur(IMAGE_BLUR_SIGMA).composite([{ input: watermarkTile, tile: true, blend: 'over' }]);
  return mimeType === 'image/png' ? blurred.png().toBuffer() : blurred.jpeg({ quality: 85 }).toBuffer();
}

module.exports = { generateReportPreview, generateImagePreview };
