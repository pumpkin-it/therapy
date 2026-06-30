const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

function generateReportPdf(data) {
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

    // Practice info (top right)
    let prY = 40;
    doc.fontSize(8).fillColor('#555');
    if (data.practice_name)  { doc.font('Helvetica-Bold').text(data.practice_name, rCol, prY, { align: 'right', width: rW }); prY = doc.y; doc.font('Helvetica'); }
    if (data.practice_phone) { doc.text(data.practice_phone, rCol, prY, { align: 'right', width: rW }); prY = doc.y; }
    if (data.practice_email) { doc.text(data.practice_email, rCol, prY, { align: 'right', width: rW }); prY = doc.y; }
    if (data.practice_abn)   { doc.text(`ABN: ${data.practice_abn}`, rCol, prY, { align: 'right', width: rW }); prY = doc.y; }
    doc.fillColor('#111');

    // Report title
    const titleY = Math.max(prY + 20, 110);
    doc.font('Helvetica-Bold').fontSize(16).text(data.title || 'Client Report', 50, titleY);
    doc.moveTo(50, doc.y + 4).lineTo(right, doc.y + 4).strokeColor('#e5e7eb').stroke();

    // Meta info (client, practitioner, date)
    let metaY = doc.y + 14;
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#555');
    doc.text('CLIENT', 50, metaY);
    doc.font('Helvetica').fillColor('#111').text(data.client_name || '—', 50, metaY + 13);

    if (data.practitioner_name) {
      doc.font('Helvetica-Bold').fillColor('#555').text('PRACTITIONER', 220, metaY);
      doc.font('Helvetica').fillColor('#111').text(data.practitioner_name, 220, metaY + 13);
    }

    const dateStr = data.report_date || new Date().toLocaleDateString('en-AU');
    doc.font('Helvetica-Bold').fillColor('#555').text('DATE', rCol, metaY, { align: 'right', width: rW });
    doc.font('Helvetica').fillColor('#111').text(dateStr, rCol, metaY + 13, { align: 'right', width: rW });

    doc.moveDown(2);

    // Sections
    for (const section of (data.sections || [])) {
      if (!section.title && !section.content) continue;
      const secY = doc.y + 10;

      // Section heading background
      doc.rect(50, secY, 495, 18).fill('#f3f4f6');
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#111').text(section.title || '', 57, secY + 4, { width: 481 });

      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(9).fillColor('#222');
      const content = section.content || '';
      if (content.trim()) {
        doc.text(content, 50, doc.y + 6, { width: 495, lineGap: 2 });
      } else {
        doc.fillColor('#aaa').text('(No content)', 50, doc.y + 6);
        doc.fillColor('#222');
      }
      doc.moveDown(1);
    }

    doc.end();
  });
}

module.exports = { generateReportPdf };
