const PDFDocument = require('pdfkit');

function generateInvoicePdf(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = 495;
    const right = 545;

    // Practice header
    doc.fontSize(20).font('Helvetica-Bold').text(data.practice_name, 50, 50);
    doc.fontSize(9).font('Helvetica');
    if (data.practice_address) doc.text(data.practice_address);
    if (data.practice_phone)   doc.text(data.practice_phone);
    if (data.practice_email)   doc.text(data.practice_email);
    if (data.practice_abn)     doc.text(`ABN: ${data.practice_abn}`);

    // Invoice title block
    doc.fontSize(18).font('Helvetica-Bold').text('TAX INVOICE', 350, 50, { align: 'right', width: 195 });
    doc.fontSize(9).font('Helvetica');
    doc.text(`Invoice #: ${data.invoice_number}`, 350, 80, { align: 'right', width: 195 });
    doc.text(`Date: ${data.issue_date}`, 350, 94, { align: 'right', width: 195 });
    doc.text(`Due:  ${data.due_date}`, 350, 108, { align: 'right', width: 195 });

    // Bill to
    const billY = Math.max(doc.y + 20, 145);
    doc.font('Helvetica-Bold').text('BILL TO', 50, billY);
    doc.font('Helvetica').text(data.client_name, 50, billY + 14);
    if (data.client_email)   doc.text(data.client_email);
    if (data.client_address) doc.text(data.client_address);

    // Table
    const tableY = doc.y + 24;
    doc.rect(50, tableY, W, 18).fill('#f3f4f6');
    doc.fillColor('#111').font('Helvetica-Bold').fontSize(8.5);
    doc.text('Code',         55, tableY + 4, { width: 60 });
    doc.text('Description', 120, tableY + 4, { width: 170 });
    doc.text('Qty',         295, tableY + 4, { width: 55, align: 'right' });
    doc.text('Rate',        355, tableY + 4, { width: 70, align: 'right' });
    doc.text('Amount',      430, tableY + 4, { width: 65, align: 'right' });

    let rowY = tableY + 20;
    doc.font('Helvetica').fontSize(9);
    for (const item of data.items) {
      doc.fillColor('#111').text(item.code || '', 55, rowY, { width: 60 });
      doc.text(item.description, 120, rowY, { width: 170 });
      doc.text(String(item.quantity), 295, rowY, { width: 55, align: 'right' });
      doc.text(`$${Number(item.unit_rate).toFixed(2)}`, 355, rowY, { width: 70, align: 'right' });
      doc.text(`$${Number(item.line_total).toFixed(2)}`, 430, rowY, { width: 65, align: 'right' });
      rowY = doc.y + 3;
      doc.moveTo(50, rowY).lineTo(right, rowY).strokeColor('#e5e7eb').stroke();
      rowY += 4;
    }

    // Totals
    const totY = rowY + 10;
    doc.font('Helvetica').fontSize(9);
    doc.text('Subtotal', 350, totY, { width: 80, align: 'right' });
    doc.text(`$${Number(data.subtotal).toFixed(2)}`, 430, totY, { width: 65, align: 'right' });
    doc.text(`GST (${Math.round(data.tax_rate * 100)}%)`, 350, totY + 15, { width: 80, align: 'right' });
    doc.text(`$${Number(data.tax_amount).toFixed(2)}`, 430, totY + 15, { width: 65, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('TOTAL', 350, totY + 34, { width: 80, align: 'right' });
    doc.text(`$${Number(data.total).toFixed(2)}`, 430, totY + 34, { width: 65, align: 'right' });

    if (data.notes) {
      doc.font('Helvetica').fontSize(9).fillColor('#555').text(`Notes: ${data.notes}`, 50, totY + 60);
    }

    doc.end();
  });
}

module.exports = { generateInvoicePdf };
