const nodemailer = require('nodemailer');
const db = require('../database');

function getSmtpConfig() {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'smtp_%'").all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

async function sendInvoiceEmail(toEmail, invoiceNumber, pdfBuffer) {
  const cfg = getSmtpConfig();
  if (!cfg.smtp_host) throw new Error('SMTP not configured — go to Settings to set it up');

  const transporter = nodemailer.createTransport({
    host: cfg.smtp_host,
    port: Number(cfg.smtp_port) || 587,
    secure: cfg.smtp_secure === '1',
    auth: { user: cfg.smtp_user, pass: cfg.smtp_pass },
  });

  await transporter.sendMail({
    from: `"${cfg.smtp_from_name}" <${cfg.smtp_from_email}>`,
    to: toEmail,
    subject: `Invoice ${invoiceNumber}`,
    text: `Please find your invoice ${invoiceNumber} attached. Thank you.`,
    html: `<p>Please find your invoice <strong>${invoiceNumber}</strong> attached.</p><p>Thank you.</p>`,
    attachments: [{ filename: `${invoiceNumber}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }],
  });
}

module.exports = { sendInvoiceEmail };
