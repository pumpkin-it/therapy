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

    // Logo
    const logoPath = path.join(__dirname, '../../uploads/logo');
    if (fs.existsSync(logoPath)) {
      try { doc.image(logoPath, 50, 40, { height: 40 }); } catch {}
    }

    // Practice header
    const headerX = fs.existsSync(logoPath) ? 100 : 50;
    doc.fontSize(16).font('Helvetica-Bold').text(data.practice_name || '', headerX, 45);
    doc.fontSize(8).font('Helvetica');
    if (data.practice_address) doc.text(data.practice_address, headerX);
    if (data.practice_phone)   doc.text(data.practice_phone, headerX);
    if (data.practice_email)   doc.text(data.practice_email, headerX);
    if (data.practice_abn)     doc.text(`ABN: ${data.practice_abn}`, headerX);

    // Invoice title
    doc.fontSize(18).font('Helvetica-Bold').text('TAX INVOICE', 350, 45, { align: 'right', width: 195 });
    doc.fontSize(9).font('Helvetica');
    doc.text(`Invoice #: ${data.invoice_number}`, 350, 72, { align: 'right', width: 195 });
    doc.text(`Date: ${data.issue_date}`, 350, 86, { align: 'right', width: 195 });
    doc.text(`Due:  ${data.due_date}`, 350, 100, { align: 'right', width: 195 });

    // Bill to
    const billY = Math.max(doc.y + 20, 130);
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
    const detY = doc.y + 12;
    doc.font('Helvetica-Bold').text('CLIENT', 50, detY);
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
    doc.fillColor('#111').font('Helvetica-Bold').fontSize(8.5);
    doc.text('Code',         55, tableY + 4, { width: 60 });
    doc.text('Description', 120, tableY + 4, { width: 190 });
    doc.text('Qty',         315, tableY + 4, { width: 50, align: 'right' });
    doc.text('Rate',        370, tableY + 4, { width: 60, align: 'right' });
    doc.text('Amount',      435, tableY + 4, { width: 60, align: 'right' });

    let rowY = tableY + 20;
    doc.font('Helvetica').fontSize(9);
    for (const item of (data.items || [])) {
      doc.fillColor('#111').text(item.code || item.service_code || '', 55, rowY, { width: 60 });
      doc.text(item.description, 120, rowY, { width: 190 });
      doc.text(String(item.quantity), 315, rowY, { width: 50, align: 'right' });
      doc.text(`$${Number(item.unit_rate).toFixed(2)}`, 370, rowY, { width: 60, align: 'right' });
      doc.text(`$${Number(item.line_total).toFixed(2)}`, 435, rowY, { width: 60, align: 'right' });
      rowY = doc.y + 3;
      doc.moveTo(50, rowY).lineTo(right, rowY).strokeColor('#e5e7eb').stroke();
      rowY += 4;
    }

    // Totals
    const totY = rowY + 10;
    doc.font('Helvetica').fontSize(9).fillColor('#111');
    doc.text('Subtotal', 370, totY, { width: 60, align: 'right' });
    doc.text(`$${Number(data.subtotal).toFixed(2)}`, 435, totY, { width: 60, align: 'right' });
    if (data.tax_rate) {
      doc.text(`GST (${Math.round((data.tax_rate || 0) * 100)}%)`, 370, totY + 15, { width: 60, align: 'right' });
      doc.text(`$${Number(data.tax_amount || 0).toFixed(2)}`, 435, totY + 15, { width: 60, align: 'right' });
    }
    doc.font('Helvetica-Bold').fontSize(11);
    const totalY = data.tax_rate ? totY + 34 : totY + 18;
    doc.text('TOTAL', 370, totalY, { width: 60, align: 'right' });
    doc.text(`$${Number(data.total).toFixed(2)}`, 435, totalY, { width: 60, align: 'right' });

    if (data.notes) {
      doc.font('Helvetica').fontSize(9).fillColor('#555').text(`Notes: ${data.notes}`, 50, totalY + 30);
    }

    doc.end();
  });
}

module.exports = { generateInvoicePdf };
