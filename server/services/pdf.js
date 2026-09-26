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

// ─── Agreements and session notes ─────────────────────────────────────────────
// Printed with headless Chrome (docPdf.renderHtmlPdf) from the stored HTML, with the same
// stylesheet and fonts as the document editor they're written in — so page breaks and the
// "Page X of Y" footer match what the editor shows. (Written reports use docPdf.renderReportPdf.)

const escHtml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Notes written before rich text are plain text — keep their line breaks.
const noteBodyHtml = note => (/<[a-z][\s\S]*>/i.test(note || '') ? note : escHtml(note || '').replace(/\n/g, '<br>'));

function logoHtml() {
  const { dataUri } = require('./reportHtml');
  const logo = dataUri(path.join(__dirname, '../../uploads/logo'));
  return logo ? `<p><img src="${logo}" alt="" style="height:64px;width:auto;display:inline-block"></p>` : '';
}

// Renders an agreement's rendered_html (the template with every {{variable}} — including the
// pricing table — already filled in) plus, once signed, the signing audit trail.
function generateAgreementPdf(agreement) {
  const { renderHtmlPdf } = require('./docPdf');
  const fmt = d => new Date(d).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne' });
  // A full chain-of-custody trail, not just the final signature — sent/viewed/signed timestamps,
  // the IP/device from the FIRST view compared against the IP/device at the actual sign action, a
  // reference to the unique link used (proof of possession, not just a typed name), and a content
  // hash (proof this exact document, unaltered, is what was signed). None of this is airtight
  // proof of identity on its own, but together it's real evidence beyond an assertion.
  const trail = [];
  if (agreement.signer_name) {
    const a = agreement;
    if (a.sent_at) trail.push(`Sent: ${fmt(a.sent_at)}`);
    if (a.viewed_at) {
      trail.push(`Viewed: ${fmt(a.viewed_at)}${a.viewed_ip ? ` from ${a.viewed_ip}` : ''}`);
      if (a.viewed_user_agent) trail.push(`Viewing device/browser: ${a.viewed_user_agent}`);
    }
    trail.push(`Signed by: ${a.signer_name}${a.signer_email ? ` <${a.signer_email}>` : ''}`);
    if (a.signed_at) trail.push(`Signed: ${fmt(a.signed_at)}${a.signed_ip ? ` from ${a.signed_ip}` : ''}`);
    if (a.signed_user_agent) trail.push(`Signing device/browser: ${a.signed_user_agent}`);
    if (a.viewed_ip && a.signed_ip) {
      const sameIp = a.viewed_ip === a.signed_ip;
      const sameDevice = a.viewed_user_agent === a.signed_user_agent;
      trail.push(`Same IP/device as initial view: ${sameIp && sameDevice ? 'Yes' : sameIp ? 'Same IP, different device' : 'No — different IP'}`);
    }
    if (a.signing_token) trail.push(`Signing link reference (SHA-256 of the unique link token): ${crypto.createHash('sha256').update(a.signing_token).digest('hex')}`);
    if (a.content_hash) trail.push(`Document content hash (SHA-256): ${a.content_hash}`);
    trail.push(`Agreement ID: ${a.id}`);
  }
  const trailHtml = trail.length ? `
    <div style="break-inside:avoid;margin-top:2em;padding-top:0.8em;border-top:1px solid #e5e7eb;font-size:8.5pt;color:#333">
      <p style="font-weight:700;font-size:9pt">SIGNING AUDIT TRAIL</p>
      ${trail.map(t => `<p style="margin:0.2em 0;word-break:break-all">${escHtml(t)}</p>`).join('')}
    </div>` : '';
  // The template normally places the pricing table via {{pricing_table}}; if it doesn't, the
  // agreement's own items are still listed (as the previous PDF did).
  let body = agreement.rendered_html || '';
  if (!/<table\b/i.test(body) && agreement.items?.length) {
    const { renderPricingTableHtml } = require('./templateVars');
    body += renderPricingTableHtml(agreement.items);
  }
  const html = `${logoHtml()}<h1>${escHtml(agreement.title)}</h1>${body}${trailHtml}`;
  return renderHtmlPdf({ html, footer: { clientName: agreement.client_name, title: agreement.title } });
}

// One or more session notes (already loaded with practitioner_name/appointment_time/created_at),
// one after another, for download or emailing to a client or third party.
function generateSessionNotePdf({ client_name, notes }) {
  const { renderHtmlPdf } = require('./docPdf');
  const parts = (notes || []).map(note => {
    // Show the actual SESSION date (the linked appointment's start_time), not created_at (when the
    // note was typed) — a note entered days after the session must still show the session date.
    // appointment_time is naive LOCAL time, parsed with no 'Z'; created_at is naive UTC and needs
    // one appended — see sessionNotes.js's sessionDateOf. A standalone note (no appointment)
    // falls back to created_at, its only real date.
    const sessionDate = note.appointment_time
      ? new Date(note.appointment_time)
      : note.created_at ? new Date(note.created_at.endsWith('Z') ? note.created_at : note.created_at + 'Z') : null;
    const dateLabel = sessionDate
      ? sessionDate.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Melbourne' })
      : '';
    return `<div class="note-head" style="break-after:avoid;margin-top:1.4em;padding-top:0.6em;border-top:1px solid #e5e7eb">
        <p style="font-weight:700">${escHtml(dateLabel)}</p>
        ${note.practitioner_name ? `<p style="margin:0;font-size:9pt;color:#6b7280">${escHtml(note.practitioner_name)}</p>` : ''}
      </div>
      <div class="note-body">${noteBodyHtml(note.note)}</div>`;
  });
  const html = `${logoHtml()}<h1>Session notes</h1><p style="color:#4b5563">${escHtml(client_name)}</p>${parts.join('')}`;
  return renderHtmlPdf({ html, footer: { clientName: client_name, title: 'Session notes' } });
}

module.exports = { generateInvoicePdf, generateAgreementPdf, generateSessionNotePdf };
