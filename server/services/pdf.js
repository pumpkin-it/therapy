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
    doc.fillColor('#111').font('Helvetica-Bold').fontSize(8);
    doc.text('Code',         55, tableY + 4, { width: 130 });
    doc.text('Description', 190, tableY + 4, { width: 130 });
    doc.text('Qty',         325, tableY + 4, { width: 40, align: 'right' });
    doc.text('Rate',        370, tableY + 4, { width: 60, align: 'right' });
    doc.text('Amount',      435, tableY + 4, { width: 60, align: 'right' });

    let rowY = tableY + 20;
    doc.font('Helvetica').fontSize(8);
    for (const item of (data.items || [])) {
      doc.fillColor('#111').text(item.code || item.service_code || '', 55, rowY, { width: 130 });
      doc.text(item.description, 190, rowY, { width: 130 });
      doc.text(String(item.quantity), 325, rowY, { width: 40, align: 'right' });
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

module.exports = { generateInvoicePdf };
