const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');

// mupdf ships as ESM with top-level await, which a CommonJS require() can't load synchronously
// — must go through dynamic import(). Cached so we only pay the import cost once per process.
let mupdfPromise;
function loadMupdf() {
  if (!mupdfPromise) mupdfPromise = import('mupdf');
  return mupdfPromise;
}

// Rasterization DPI — readable on screen, small enough that a 30+ page report is quick to make
// on the small server.
const RENDER_DPI = 100;
// "DRAFT ONLY" repeated diagonally across every page — light enough to read the report through,
// so the client can review all of it, but on every part of every page so no page can pass for
// the released copy.
const WATERMARK_TILE_SVG = Buffer.from(`
  <svg xmlns='http://www.w3.org/2000/svg' width='380' height='300'>
    <text x='190' y='162' font-size='40' font-family='sans-serif' font-weight='700'
      fill='#dc2626' fill-opacity='0.22' text-anchor='middle'
      transform='rotate(-30 190 150)'>DRAFT ONLY</text>
  </svg>
`);

// Builds the draft preview PDF: every page watermarked "DRAFT ONLY", readable in full. Each page
// is rasterized first (mupdf WASM) and the watermark is drawn into the pixels (sharp), so the
// preview has no text layer to copy or extract and the watermark can't be taken off — the clean,
// searchable original is only served once the report is released.
async function generateReportPreview(originalBuffer) {
  const mupdf = await loadMupdf();
  const doc = mupdf.Document.openDocument(originalBuffer, 'application/pdf');
  const pageCount = doc.countPages();
  const watermarkTile = await sharp(WATERMARK_TILE_SVG).png().toBuffer();
  const scale = RENDER_DPI / 72;

  const rasterized = [];
  for (let i = 0; i < pageCount; i++) {
    const pixmap = doc.loadPage(i).toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
    rasterized.push(pixmap.asPNG());
  }
  // sharp runs on libvips' own thread pool — starting every page at once lets it work in parallel.
  const pageImages = await Promise.all(rasterized.map(png =>
    sharp(png).composite([{ input: watermarkTile, tile: true, blend: 'over' }]).png().toBuffer()));

  const previewDoc = await PDFDocument.create();
  for (const pageImage of pageImages) {
    const embeddedImage = await previewDoc.embedPng(pageImage);
    const previewPage = previewDoc.addPage([embeddedImage.width, embeddedImage.height]);
    previewPage.drawImage(embeddedImage, { x: 0, y: 0, width: embeddedImage.width, height: embeddedImage.height });
  }
  // visiblePages: every page is readable now (the column is kept for older rows).
  return { buffer: Buffer.from(await previewDoc.save()), pageCount, visiblePages: pageCount };
}

// A shared photo or scan: the same watermark, otherwise unchanged. The tile is shrunk to fit a
// small image (sharp's tiled composite needs the tile no bigger than the image).
async function generateImagePreview(originalBuffer, mimeType) {
  const { width, height } = await sharp(originalBuffer).metadata();
  const scale = Math.min(1, width / 380, height / 300);
  const watermarkTile = await sharp(WATERMARK_TILE_SVG).resize(Math.max(60, Math.round(380 * scale)), Math.max(48, Math.round(300 * scale))).png().toBuffer();
  const marked = sharp(originalBuffer).composite([{ input: watermarkTile, tile: true, blend: 'over' }]);
  return mimeType === 'image/png' ? marked.png().toBuffer() : marked.jpeg({ quality: 85 }).toBuffer();
}

module.exports = { generateReportPreview, generateImagePreview };
