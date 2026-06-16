const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');
const { generateInvoicePdf } = require('../services/pdf');
const { sendInvoiceEmail } = require('../services/mailer');

function nextInvoiceNumber() {
  const counter = parseInt(db.prepare("SELECT value FROM settings WHERE key='invoice_counter'").get().value);
  const num = `INV-${String(counter).padStart(5, '0')}`;
  db.prepare("UPDATE settings SET value=? WHERE key='invoice_counter'").run(counter + 1);
  return num;
}

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

router.get('/', auth, (req, res) => {
  const { status, client_id } = req.query;
  let where = '1=1';
  const params = [];
  if (status)    { where += ' AND i.status=?';    params.push(status); }
  if (client_id) { where += ' AND i.client_id=?'; params.push(client_id); }

  const invoices = db.prepare(`
    SELECT i.*, c.first_name || ' ' || c.last_name AS client_name
    FROM invoices i JOIN clients c ON c.id = i.client_id
    WHERE ${where} ORDER BY i.created_at DESC
  `).all(...params);
  res.json(invoices);
});

router.get('/:id', auth, (req, res) => {
  const inv = db.prepare(`
    SELECT i.*, c.first_name || ' ' || c.last_name AS client_name, c.email AS client_email, c.address AS client_address
    FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.id=?
  `).get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  inv.items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=?').all(req.params.id);
  res.json(inv);
});

// GET /api/invoices/:id/pdf
router.get('/:id/pdf', auth, async (req, res) => {
  const inv = db.prepare(`
    SELECT i.*, c.first_name || ' ' || c.last_name AS client_name, c.email AS client_email, c.address AS client_address
    FROM invoices i JOIN clients c ON c.id=i.client_id WHERE i.id=?
  `).get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  inv.items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=?').all(req.params.id);

  const settings = getSettings();
  const pdf = await generateInvoicePdf({
    invoice_number: inv.invoice_number,
    issue_date: inv.issue_date,
    due_date: inv.due_date,
    practice_name: settings.practice_name,
    practice_abn: settings.practice_abn,
    practice_email: settings.practice_email,
    practice_phone: settings.practice_phone,
    practice_address: settings.practice_address,
    client_name: inv.client_name,
    client_email: inv.client_email,
    client_address: inv.client_address,
    items: inv.items,
    subtotal: inv.subtotal,
    tax_rate: inv.tax_rate,
    tax_amount: inv.tax_amount,
    total: inv.total,
    notes: inv.notes,
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${inv.invoice_number}.pdf"`);
  res.send(pdf);
});

// POST /api/invoices — create from appointment_ids or manual items
router.post('/', auth, (req, res) => {
  const { client_id, due_date, tax_rate = 0.1, notes, appointment_ids = [], manual_items = [] } = req.body;

  const lineItems = [];

  if (appointment_ids.length) {
    const placeholders = appointment_ids.map(() => '?').join(',');
    const apptItems = db.prepare(`
      SELECT ai.* FROM appointment_items ai
      JOIN appointments a ON a.id = ai.appointment_id
      WHERE a.id IN (${placeholders}) AND a.client_id = ? AND a.is_invoiced = 0
    `).all(...appointment_ids, client_id);

    for (const item of apptItems) {
      lineItems.push({
        description: item.description,
        quantity: item.quantity,
        unit_rate: item.unit_rate,
        line_total: item.quantity * item.unit_rate,
        appointment_item_id: item.id,
      });
    }

    db.prepare(`UPDATE appointments SET is_invoiced=1 WHERE id IN (${placeholders})`).run(...appointment_ids);
  }

  for (const item of manual_items) {
    lineItems.push({
      description: item.description,
      quantity: item.quantity,
      unit_rate: item.unit_rate,
      line_total: item.quantity * item.unit_rate,
      appointment_item_id: null,
    });
  }

  if (!lineItems.length) return res.status(422).json({ error: 'No line items' });

  const subtotal = lineItems.reduce((s, i) => s + i.line_total, 0);
  const tax_amount = subtotal * tax_rate;
  const total = subtotal + tax_amount;
  const invoice_number = nextInvoiceNumber();
  const today = new Date().toISOString().slice(0, 10);

  const result = db.prepare(`
    INSERT INTO invoices (invoice_number, client_id, issue_date, due_date, notes, subtotal, tax_rate, tax_amount, total)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(invoice_number, client_id, today, due_date, notes||null, subtotal, tax_rate, tax_amount, total);

  const invoiceId = result.lastInsertRowid;
  const insertItem = db.prepare(`
    INSERT INTO invoice_items (invoice_id, appointment_item_id, description, quantity, unit_rate, line_total)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const item of lineItems) {
    insertItem.run(invoiceId, item.appointment_item_id, item.description, item.quantity, item.unit_rate, item.line_total);
  }

  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(invoiceId);
  inv.items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=?').all(invoiceId);
  res.status(201).json(inv);
});

// POST /api/invoices/:id/send
router.post('/:id/send', auth, async (req, res) => {
  const inv = db.prepare(`
    SELECT i.*, c.first_name || ' ' || c.last_name AS client_name, c.email AS client_email, c.address AS client_address
    FROM invoices i JOIN clients c ON c.id=i.client_id WHERE i.id=?
  `).get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  if (!inv.client_email) return res.status(422).json({ error: 'Client has no email address' });

  inv.items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=?').all(req.params.id);
  const settings = getSettings();

  const pdf = await generateInvoicePdf({
    invoice_number: inv.invoice_number,
    issue_date: inv.issue_date,
    due_date: inv.due_date,
    practice_name: settings.practice_name,
    practice_abn: settings.practice_abn,
    practice_email: settings.practice_email,
    practice_phone: settings.practice_phone,
    practice_address: settings.practice_address,
    client_name: inv.client_name,
    client_email: inv.client_email,
    client_address: inv.client_address,
    items: inv.items,
    subtotal: inv.subtotal,
    tax_rate: inv.tax_rate,
    tax_amount: inv.tax_amount,
    total: inv.total,
    notes: inv.notes,
  });

  await sendInvoiceEmail(inv.client_email, inv.invoice_number, pdf);

  db.prepare("UPDATE invoices SET status='sent', sent_at=? WHERE id=?").run(new Date().toISOString(), req.params.id);
  res.json(db.prepare('SELECT * FROM invoices WHERE id=?').get(req.params.id));
});

// PATCH /api/invoices/:id/mark-paid
router.patch('/:id/mark-paid', auth, (req, res) => {
  db.prepare("UPDATE invoices SET status='paid', paid_at=? WHERE id=?").run(new Date().toISOString(), req.params.id);
  res.json(db.prepare('SELECT * FROM invoices WHERE id=?').get(req.params.id));
});

module.exports = router;
