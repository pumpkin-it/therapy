const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

function generateInvoicePdf(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const right = 545;
    const rCol = 350;
    const rW = 195;

    // Logo (top left)
    const logoPath = path.join(__dirname, '../../uploads/logo');
    if (fs.existsSync(logoPath)) {
      try { doc.image(logoPath, 50, 40, { height: 50 }); } catch {}
    }

    // Invoice title + practice details (top right)
    doc.fontSize(18).font('Helvetica-Bold').text('TAX INVOICE', rCol, 40, { align: 'right', width: rW });
    doc.fontSize(9).font('Helvetica');
    doc.text(`Invoice #: ${data.invoice_number}`, rCol, 65, { align: 'right', width: rW });
    doc.text(`Date: ${data.issue_date}`, rCol, 79, { align: 'right', width: rW });
    doc.text(`Due:  ${data.due_date}`, rCol, 93, { align: 'right', width: rW });

    // Practice details (right column, below invoice info)
    let prY = 115;
    doc.fontSize(8).fillColor('#555');
    if (data.practice_name)    { doc.font('Helvetica-Bold').text(data.practice_name, rCol, prY, { align: 'right', width: rW }); prY = doc.y; doc.font('Helvetica'); }
    if (data.practice_address) { doc.text(data.practice_address, rCol, prY, { align: 'right', width: rW }); prY = doc.y; }
    if (data.practice_phone)   { doc.text(data.practice_phone, rCol, prY, { align: 'right', width: rW }); prY = doc.y; }
    if (data.practice_email)   { doc.text(data.practice_email, rCol, prY, { align: 'right', width: rW }); prY = doc.y; }
    if (data.practice_abn)     { doc.text(`ABN: ${data.practice_abn}`, rCol, prY, { align: 'right', width: rW }); prY = doc.y; }
    doc.fillColor('#111');

    // Bill to (left column)
    const billY = 100;
    doc.font('Helvetica-Bold').fontSize(9).text('BILL TO', 50, billY);
    doc.font('Helvetica');
    if (data.funds_manager_name) {
      doc.text(data.funds_manager_name, 50, billY + 13);
      if (data.funds_manager_email) doc.text(data.funds_manager_email);
    } else {
      doc.text(data.client_name, 50, billY + 13);
      if (data.client_email) doc.text(data.client_email);
      if (data.client_address) doc.text(data.client_address);
    }

    // Client & Practitioner details
    const detY = Math.max(doc.y + 12, prY + 12);
    doc.font('Helvetica-Bold').fontSize(9).text('CLIENT', 50, detY);
    doc.font('Helvetica').text(data.client_name, 50, detY + 13);
    if (data.client_address) doc.text(data.client_address);

    if (data.practitioner_name) {
      doc.font('Helvetica-Bold').text('PRACTITIONER', 300, detY);
      doc.font('Helvetica').text(data.practitioner_name, 300, detY + 13);
      if (data.practitioner_title) doc.text(data.practitioner_title, 300);
      if (data.provider_number) doc.text(`Provider #: ${data.provider_number}`, 300);
    }

    // Table
    const tableY = Math.max(doc.y + 20, detY + 60);
    doc.rect(50, tableY, 495, 18).fill('#f3f4f6');
    doc.fillColor('#111').font('Helvetica-Bold').fontSize(7);
    doc.text('Date',             55, tableY + 5, { width: 48 });
    doc.text('Code',            105, tableY + 5, { width: 95 });
    doc.text('Description',    203, tableY + 5, { width: 100 });
    doc.text('Qty',            306, tableY + 5, { width: 28, align: 'right' });
    doc.text('Rate',           336, tableY + 5, { width: 45, align: 'right' });
    doc.text('GST',            383, tableY + 5, { width: 25, align: 'right' });
    doc.text('Amount (inc GST)', 410, tableY + 5, { width: 85, align: 'right' });

    let rowY = tableY + 20;
    doc.font('Helvetica').fontSize(7);
    for (const item of (data.items || [])) {
      const gstRate = Number(item.gst_rate || 0);
      const lineIncGst = Number(item.line_total) + Number(item.gst_amount || item.line_total * gstRate || 0);
      const svcDate = item.service_date ? item.service_date.split('-').reverse().join('/') : '';
      doc.fillColor('#111').text(svcDate, 55, rowY, { width: 48 });
      doc.text(item.code || item.service_code || '', 105, rowY, { width: 95 });
      doc.text(item.description, 203, rowY, { width: 100 });
      doc.text(String(item.quantity), 306, rowY, { width: 28, align: 'right' });
      doc.text(`$${Number(item.unit_rate).toFixed(2)}`, 336, rowY, { width: 45, align: 'right' });
      const gstLabel = item.gst_type === 'FRE' ? 'FRE' : item.gst_type === 'N-T' ? 'N-T' : `GST ${Math.round(gstRate * 100)}%`;
      doc.text(gstLabel, 383, rowY, { width: 25, align: 'right' });
      doc.text(`$${lineIncGst.toFixed(2)}`, 410, rowY, { width: 85, align: 'right' });
      rowY = doc.y + 3;
      doc.moveTo(50, rowY).lineTo(right, rowY).strokeColor('#e5e7eb').stroke();
      rowY += 4;
    }

    // Totals
    const gstTotal = (data.items || []).reduce((s, i) => s + Number(i.gst_amount || i.line_total * (i.gst_rate || 0) || 0), 0);
    const totY = rowY + 10;
    doc.font('Helvetica').fontSize(9).fillColor('#111');
    doc.text('Subtotal', 410, totY, { width: 40, align: 'right' });
    doc.text(`$${Number(data.subtotal).toFixed(2)}`, 453, totY, { width: 42, align: 'right' });
    doc.text('GST Total', 410, totY + 15, { width: 40, align: 'right' });
    doc.text(`$${gstTotal.toFixed(2)}`, 453, totY + 15, { width: 42, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(11);
    const totalY = totY + 34;
    doc.text('TOTAL', 390, totalY, { width: 50, align: 'right' });
    doc.text(`$${Number(data.total).toFixed(2)}`, 443, totalY, { width: 52, align: 'right' });

    // Notes
    let footerY = totalY + 40;
    if (data.notes) {
      doc.font('Helvetica').fontSize(9).fillColor('#555').text(`Notes: ${data.notes}`, 50, footerY);
      footerY = doc.y + 15;
    }

    // Banking details
    const hasBanking = data.bank_account_name || data.bank_bsb || data.bank_account_number;
    if (hasBanking || data.remittance_email) {
      doc.moveTo(50, footerY).lineTo(right, footerY).strokeColor('#e5e7eb').stroke();
      footerY += 10;
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#111').text('PAYMENT DETAILS', 50, footerY);
      footerY += 14;
      doc.font('Helvetica').fontSize(8.5).fillColor('#333');
      if (data.bank_account_name) { doc.text(`Account Name: ${data.bank_account_name}`, 50, footerY); footerY = doc.y + 2; }
      if (data.bank_bsb)          { doc.text(`BSB: ${data.bank_bsb}`, 50, footerY); footerY = doc.y + 2; }
      if (data.bank_account_number) { doc.text(`Account Number: ${data.bank_account_number}`, 50, footerY); footerY = doc.y + 2; }
      if (data.remittance_email)  { doc.text(`Remittance Email: ${data.remittance_email}`, 50, footerY); }
    }

    doc.end();
  });
}

// Named HTML entities used in agreement template content (typographic punctuation, checkboxes,
// etc.) — the client-side htmlToPlain in AppointmentModal.jsx only needs a handful of these
// since Quill rarely emits them, but the docx-derived agreement templates use them throughout.
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', hellip: '…', copy: '©', reg: '®', trade: '™',
};

// pdfkit's default Helvetica font only covers the WinAnsi glyph set — it can render en-dashes
// and curly quotes fine, but not symbol characters like the ballot-box checkbox (U+2610), which
// would otherwise render as a missing/blank glyph. Substitute those with a PDF-safe equivalent.
const PDF_UNSAFE_CHARS = { '☐': '[ ]', '☑': '[x]' };

function decodeHtmlEntities(str) {
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&(\w+);/g, (m, name) => NAMED_ENTITIES[name] ?? m)
    .replace(/[☐☑]/g, ch => PDF_UNSAFE_CHARS[ch]);
}

// Quill's color picker inserts inline `style="color: rgb(r, g, b);"` (or a hex value if
// configured with one) — pdfkit's fillColor wants a hex string, not raw CSS syntax.
function toHexColor(cssColor) {
  if (!cssColor) return null;
  const rgb = cssColor.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) return '#' + rgb.slice(1, 4).map(n => Number(n).toString(16).padStart(2, '0')).join('');
  if (/^#[0-9a-f]{3,6}$/i.test(cssColor)) return cssColor;
  return null; // unrecognised format — fall back to the default fill colour
}

// Parses a Quill-authored HTML fragment (agreement/session-note body) into block-level chunks
// (paragraphs / list items), each holding an ordered list of inline runs with their
// bold/italic/underline/color/font state — so PDF output can preserve the formatting visible in
// the editor instead of flattening everything to plain text. Color and font (Quill's built-in
// serif/monospace whitelist, carried as a <span class="ql-font-*">) nest via a stack the same
// way bold/italic/underline nest via booleans, since a span can wrap other formatted spans.
function parseInlineRuns(html) {
  const runs = [];
  const withBreaks = html.replace(/<br\s*\/?>/gi, '\n');
  const tagRegex = /<(\/?)(strong|b|em|i|u|span)([^>]*)>/gi;
  let bold = false, italic = false, underline = false;
  const colorStack = [];
  const fontStack = [];
  let lastIndex = 0;
  let m;
  const flush = end => {
    const text = withBreaks.slice(lastIndex, end).replace(/<[^>]+>/g, '');
    if (text) {
      runs.push({
        text: decodeHtmlEntities(text), bold, italic, underline,
        color: colorStack[colorStack.length - 1] || null,
        font: fontStack[fontStack.length - 1] || null,
      });
    }
  };
  while ((m = tagRegex.exec(withBreaks))) {
    flush(m.index);
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] || '';
    if (tag === 'strong' || tag === 'b') bold = !closing;
    else if (tag === 'em' || tag === 'i') italic = !closing;
    else if (tag === 'u') underline = !closing;
    else if (tag === 'span') {
      if (!closing) {
        const colorMatch = attrs.match(/color:\s*([^;"']+)/i);
        const fontMatch = attrs.match(/ql-font-(serif|monospace)/i);
        colorStack.push(colorMatch ? toHexColor(colorMatch[1].trim()) : (colorStack[colorStack.length - 1] || null));
        fontStack.push(fontMatch ? fontMatch[1].toLowerCase() : (fontStack[fontStack.length - 1] || null));
      } else {
        colorStack.pop();
        fontStack.pop();
      }
    }
    lastIndex = tagRegex.lastIndex;
  }
  flush(withBreaks.length);
  return runs.filter(r => r.text.length > 0);
}

function parseRichHtml(html) {
  if (!html) return [];
  const blocks = [];
  const blockRegex = /<li[^>]*>([\s\S]*?)<\/li>|<p[^>]*>([\s\S]*?)<\/p>/gi;
  let match;
  let any = false;
  while ((match = blockRegex.exec(html))) {
    any = true;
    const isListItem = match[0].toLowerCase().startsWith('<li');
    const inner = match[1] !== undefined ? match[1] : match[2];
    const runs = parseInlineRuns(inner);
    if (runs.length) blocks.push({ listItem: isListItem, runs });
  }
  if (!any && html.trim()) {
    const runs = parseInlineRuns(html);
    if (runs.length) blocks.push({ listItem: false, runs });
  }
  return blocks;
}

// pdfkit ships 14 standard fonts including full Times/Courier families — a happy match for
// Quill's built-in font whitelist (default sans, serif, monospace), so "different fonts" needs
// no embedded font files, just picking the right one of the 14 per run.
function pdfFontFor(fontKey, bold, italic) {
  if (fontKey === 'serif') {
    if (bold && italic) return 'Times-BoldItalic';
    if (bold) return 'Times-Bold';
    if (italic) return 'Times-Italic';
    return 'Times-Roman';
  }
  if (fontKey === 'monospace') {
    if (bold && italic) return 'Courier-BoldOblique';
    if (bold) return 'Courier-Bold';
    if (italic) return 'Courier-Oblique';
    return 'Courier';
  }
  if (bold && italic) return 'Helvetica-BoldOblique';
  if (bold) return 'Helvetica-Bold';
  if (italic) return 'Helvetica-Oblique';
  return 'Helvetica';
}

// Draws parsed rich-text blocks at the given position, preserving bold/italic/underline/
// color/font and bullet points (PDFKit has no built-in HTML renderer, so formatting must be
// replayed manually via font/fill-color switching between each inline run within a
// `continued: true` chain).
function drawRichBlocks(doc, blocks, x, y, { width = 495, fontSize = 10 } = {}) {
  doc.x = x;
  doc.y = y;
  doc.fillColor('#111').fontSize(fontSize);
  for (const block of blocks) {
    if (!block.runs.length) continue;
    const prefix = block.listItem ? '•  ' : '';
    block.runs.forEach((run, i) => {
      const text = i === 0 ? prefix + run.text : run.text;
      doc.font(pdfFontFor(run.font, run.bold, run.italic));
      doc.fillColor(run.color || '#111');
      const isLast = i === block.runs.length - 1;
      doc.text(text, { continued: !isLast, underline: run.underline, width });
    });
    doc.moveDown(0.5);
  }
  doc.fillColor('#111');
  return doc.y;
}

// Pulls the pricing rows back out of the <table> embedded in rendered_html (produced by
// templateVars.js's renderPricingTableHtml — fixed 5-cell rows). This is exactly what the
// client sees on the signing link (and, once sent, the frozen snapshot they signed), so the
// PDF always matches it — whether the rows came from manual agreement_items or a linked budget.
function pricingRowsFromHtml(tableHtml) {
  const tbody = tableHtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tbody) return [];
  const cellText = c => decodeHtmlEntities(c.replace(/<[^>]+>/g, '').trim());
  const num = s => Number(String(s).replace(/[$,\s]/g, '')) || 0;
  const rows = [];
  for (const tr of tbody[1].match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []) {
    const cells = (tr.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || []).map(c => cellText(c.replace(/^<td[^>]*>|<\/td>$/gi, '')));
    if (cells.length < 5) continue;
    rows.push({ description: cells[0], code: cells[1], quantity: num(cells[2]), unit_rate: num(cells[3]), line_total: num(cells[4]) });
  }
  return rows;
}

// Renders an agreement's rendered_html (prose + the {{pricing_table}} placeholder already
// substituted with a real <table>) into a PDF, redrawing the table with the same fixed-column
// row-loop used for invoices.
function generateAgreementPdf(agreement) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const right = 545;

    // Logo (top left) — same placement/pattern as the invoice PDF
    const logoPath = path.join(__dirname, '../../uploads/logo');
    let titleY = 50;
    if (fs.existsSync(logoPath)) {
      try { doc.image(logoPath, 50, 40, { height: 50 }); titleY = 110; } catch {}
    }

    doc.fontSize(16).font('Helvetica-Bold').text(agreement.title, 50, titleY);
    doc.moveDown(1);

    const tableMatch = agreement.rendered_html.match(/<table[\s\S]*?<\/table>/i);
    const htmlRows = tableMatch ? pricingRowsFromHtml(tableMatch[0]) : [];
    const pricingRows = htmlRows.length ? htmlRows : (agreement.items || []);

    const [beforeHtml, afterHtml] = agreement.rendered_html
      .replace(/<table[\s\S]*?<\/table>/i, '[[PRICING_TABLE]]')
      .split('[[PRICING_TABLE]]');

    const beforeBlocks = parseRichHtml(beforeHtml);
    if (beforeBlocks.length) drawRichBlocks(doc, beforeBlocks, 50, doc.y, { width: 495 });

    // Pricing table
    const tableY = doc.y + 15;
    doc.rect(50, tableY, 495, 18).fill('#f3f4f6');
    doc.fillColor('#111').font('Helvetica-Bold').fontSize(8);
    doc.text('Service',  55, tableY + 5, { width: 220 });
    doc.text('Code',    275, tableY + 5, { width: 90 });
    doc.text('Qty',     365, tableY + 5, { width: 40, align: 'right' });
    doc.text('Rate',    405, tableY + 5, { width: 60, align: 'right' });
    doc.text('Total',   465, tableY + 5, { width: 65, align: 'right' });

    let rowY = tableY + 20;
    doc.font('Helvetica').fontSize(8);
    for (const item of pricingRows) {
      doc.fillColor('#111').text(item.description, 55, rowY, { width: 220 });
      doc.text(item.code || '', 275, rowY, { width: 90 });
      doc.text(Number(item.quantity).toFixed(2), 365, rowY, { width: 40, align: 'right' });
      doc.text(`$${Number(item.unit_rate).toFixed(2)}`, 405, rowY, { width: 60, align: 'right' });
      doc.text(`$${Number(item.line_total).toFixed(2)}`, 465, rowY, { width: 65, align: 'right' });
      rowY = doc.y + 3;
      doc.moveTo(50, rowY).lineTo(right, rowY).strokeColor('#e5e7eb').stroke();
      rowY += 4;
    }

    const grandTotal = pricingRows.reduce((s, i) => s + Number(i.line_total || 0), 0);
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('Grand Total', 365, rowY + 8, { width: 100, align: 'right' });
    doc.text(`$${grandTotal.toFixed(2)}`, 465, rowY + 8, { width: 65, align: 'right' });

    let footerY = rowY + 35;
    const afterBlocks = parseRichHtml(afterHtml);
    if (afterBlocks.length) { footerY = drawRichBlocks(doc, afterBlocks, 50, footerY, { width: 495 }) + 20; }

    // A full chain-of-custody trail, not just the final signature — sent/viewed/signed
    // timestamps, the IP/device from the FIRST view compared against the IP/device at the actual
    // sign action, a reference to the unique link used (proof of possession, not just a typed
    // name), and a content hash (proof this exact document, unaltered, is what was signed). None
    // of this is airtight proof of identity on its own, but together it's real evidence beyond an
    // assertion — and a mismatch between viewed/signed device is exactly what would need
    // explaining if this were ever challenged.
    if (agreement.signer_name) {
      doc.moveTo(50, footerY).lineTo(right, footerY).strokeColor('#e5e7eb').stroke();
      footerY += 10;
      doc.font('Helvetica-Bold').fontSize(9).text('SIGNING AUDIT TRAIL', 50, footerY);
      footerY += 14;
      doc.font('Helvetica').fontSize(8.5).fillColor('#333');
      const line = text => { doc.text(text, 50, footerY, { width: 495 }); footerY = doc.y + 2; };
      if (agreement.sent_at) line(`Sent: ${new Date(agreement.sent_at).toLocaleString('en-AU')}`);
      if (agreement.viewed_at) {
        line(`Viewed: ${new Date(agreement.viewed_at).toLocaleString('en-AU')}${agreement.viewed_ip ? ` from ${agreement.viewed_ip}` : ''}`);
        if (agreement.viewed_user_agent) line(`  Viewing device/browser: ${agreement.viewed_user_agent}`);
      }
      line(`Signed by: ${agreement.signer_name}${agreement.signer_email ? ` <${agreement.signer_email}>` : ''}`);
      if (agreement.signed_at) line(`Signed: ${new Date(agreement.signed_at).toLocaleString('en-AU')}${agreement.signed_ip ? ` from ${agreement.signed_ip}` : ''}`);
      if (agreement.signed_user_agent) line(`  Signing device/browser: ${agreement.signed_user_agent}`);
      if (agreement.viewed_ip && agreement.signed_ip) {
        const sameIp = agreement.viewed_ip === agreement.signed_ip;
        const sameDevice = agreement.viewed_user_agent === agreement.signed_user_agent;
        line(`Same IP/device as initial view: ${sameIp && sameDevice ? 'Yes' : sameIp ? 'Same IP, different device' : 'No — different IP'}`);
      }
      if (agreement.signing_token) {
        const tokenRef = crypto.createHash('sha256').update(agreement.signing_token).digest('hex');
        line(`Signing link reference (SHA-256 of the unique link token): ${tokenRef}`);
      }
      if (agreement.content_hash) line(`Document content hash (SHA-256): ${agreement.content_hash}`);
      line(`Agreement ID: ${agreement.id}`);
    }

    doc.end();
  });
}

// Renders one or more session notes (already loaded with practitioner_name/created_at) into a
// simple PDF for download or emailing to a client/third party. Notes are Quill-authored HTML —
// parseRichHtml/drawRichBlocks (shared with the agreement PDF) replays bold/italic/underline/
// color/font. A legacy plain-text note (written before rich text existed, no HTML tags at all)
// still renders correctly: parseRichHtml's no-block-match fallback treats it as one plain run,
// identical to the old `doc.text(note.note, ...)` call this replaces.
function generateSessionNotePdf({ client_name, notes }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const right = 545;

    // Logo (top left) — same placement/pattern as the invoice/agreement PDFs
    const logoPath = path.join(__dirname, '../../uploads/logo');
    let titleY = 50;
    if (fs.existsSync(logoPath)) {
      try { doc.image(logoPath, 50, 40, { height: 50 }); titleY = 110; } catch {}
    }

    doc.fontSize(16).font('Helvetica-Bold').text('Session Notes', 50, titleY);
    doc.fontSize(10).font('Helvetica').fillColor('#555').text(client_name, 50, doc.y + 4);
    doc.moveDown(1.5);

    for (const note of notes || []) {
      // Show the actual SESSION date (the linked appointment's start_time), not created_at (when
      // the note was typed) — a note entered days after the session must still show the session
      // date. appointment_time is naive LOCAL Sydney time, parsed with no 'Z'; created_at is naive
      // UTC and needs one appended — see sessionNotes.js's sessionDateOf for the full rationale.
      // A standalone note with no linked appointment falls back to created_at, its only real date.
      const sessionDate = note.appointment_time
        ? new Date(note.appointment_time)
        : note.created_at
          ? new Date(note.created_at.endsWith('Z') ? note.created_at : note.created_at + 'Z')
          : null;
      const dateLabel = sessionDate
        ? sessionDate.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Sydney' })
        : '';
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#111').text(dateLabel, 50, doc.y);
      if (note.practitioner_name) {
        doc.font('Helvetica').fontSize(9).fillColor('#666').text(note.practitioner_name, 50, doc.y + 2);
      }
      doc.moveDown(0.4);
      const blocks = parseRichHtml(note.note);
      doc.y = drawRichBlocks(doc, blocks, 50, doc.y, { width: 495, fontSize: 10 });
      doc.moveDown(0.6);
      const lineY = doc.y;
      doc.moveTo(50, lineY).lineTo(right, lineY).strokeColor('#e5e7eb').stroke();
      doc.moveDown(0.8);
    }

    doc.end();
  });
}

module.exports = { generateInvoicePdf, generateAgreementPdf, generateSessionNotePdf };
