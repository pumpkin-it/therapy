const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

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

// Strip HTML down to plain paragraphs, preserving line breaks from block elements — same
// approach as the client-side htmlToPlain helper in AppointmentModal.jsx, plus full entity
// decoding since PDF output (unlike a browser) never decodes HTML entities on its own.
function htmlToPlain(html) {
  if (!html) return '';
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Renders an agreement's rendered_html (prose + the {{pricing_table}} placeholder already
// substituted with a real <table>) into a PDF. The embedded table HTML is never parsed back
// out — the pricing rows are always read fresh from agreement.items and rendered with the
// same fixed-column row-loop used for invoices, so the PDF numbers can never drift from the
// structured data even if the HTML table markup ever changes shape.
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

    const [before, after] = htmlToPlain(agreement.rendered_html.replace(/<table[\s\S]*?<\/table>/i, '\n[[PRICING_TABLE]]\n'))
      .split('[[PRICING_TABLE]]');

    doc.font('Helvetica').fontSize(10).fillColor('#111');
    if (before?.trim()) doc.text(before.trim(), 50, doc.y, { width: 495 });

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
    for (const item of (agreement.items || [])) {
      doc.fillColor('#111').text(item.description, 55, rowY, { width: 220 });
      doc.text(item.code || '', 275, rowY, { width: 90 });
      doc.text(Number(item.quantity).toFixed(2), 365, rowY, { width: 40, align: 'right' });
      doc.text(`$${Number(item.unit_rate).toFixed(2)}`, 405, rowY, { width: 60, align: 'right' });
      doc.text(`$${Number(item.line_total).toFixed(2)}`, 465, rowY, { width: 65, align: 'right' });
      rowY = doc.y + 3;
      doc.moveTo(50, rowY).lineTo(right, rowY).strokeColor('#e5e7eb').stroke();
      rowY += 4;
    }

    const grandTotal = (agreement.items || []).reduce((s, i) => s + Number(i.line_total || 0), 0);
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('Grand Total', 365, rowY + 8, { width: 100, align: 'right' });
    doc.text(`$${grandTotal.toFixed(2)}`, 465, rowY + 8, { width: 65, align: 'right' });

    let footerY = rowY + 35;
    doc.font('Helvetica').fontSize(10).fillColor('#111');
    if (after?.trim()) { doc.text(after.trim(), 50, footerY, { width: 495 }); footerY = doc.y + 20; }

    if (agreement.signer_name) {
      doc.moveTo(50, footerY).lineTo(right, footerY).strokeColor('#e5e7eb').stroke();
      footerY += 10;
      doc.font('Helvetica-Bold').fontSize(9).text('SIGNED', 50, footerY);
      footerY += 14;
      doc.font('Helvetica').fontSize(8.5).fillColor('#333');
      doc.text(`Signed by: ${agreement.signer_name}`, 50, footerY); footerY = doc.y + 2;
      if (agreement.signed_at) { doc.text(`Date: ${new Date(agreement.signed_at).toLocaleString('en-AU')}`, 50, footerY); footerY = doc.y + 2; }
      if (agreement.signed_ip) { doc.text(`IP address: ${agreement.signed_ip}`, 50, footerY); footerY = doc.y + 2; }
      doc.text(`Agreement ID: ${agreement.id}`, 50, footerY);
    }

    doc.end();
  });
}

// Renders one or more session notes (already loaded with practitioner_name/created_at) into a
// simple PDF for download or emailing to a client/third party. Notes are plain text (not Quill
// HTML), so no htmlToPlain step is needed.
function generateSessionNotePdf({ client_name, notes }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const right = 545;

    doc.fontSize(16).font('Helvetica-Bold').text('Session Notes', 50, 50);
    doc.fontSize(10).font('Helvetica').fillColor('#555').text(client_name, 50, doc.y + 4);
    doc.moveDown(1.5);

    for (const note of notes || []) {
      const dateLabel = note.created_at ? new Date(note.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#111').text(dateLabel, 50, doc.y);
      if (note.practitioner_name) {
        doc.font('Helvetica').fontSize(9).fillColor('#666').text(note.practitioner_name, 50, doc.y + 2);
      }
      doc.moveDown(0.4);
      doc.font('Helvetica').fontSize(10).fillColor('#111').text(note.note, 50, doc.y, { width: 495 });
      doc.moveDown(0.6);
      const lineY = doc.y;
      doc.moveTo(50, lineY).lineTo(right, lineY).strokeColor('#e5e7eb').stroke();
      doc.moveDown(0.8);
    }

    doc.end();
  });
}

module.exports = { generateInvoicePdf, generateAgreementPdf, generateSessionNotePdf };
