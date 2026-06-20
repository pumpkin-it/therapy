const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');
const { generateInvoicePdf } = require('../services/pdf');
const { sendInvoiceEmail } = require('../services/mailer');

function nextInvoiceNumber() {
  const counter = parseInt(db.prepare("SELECT value FROM settings WHERE key='invoice_counter'").get()?.value || '1');
  const num = `INV-${String(counter).padStart(5, '0')}`;
  db.prepare("UPDATE settings SET value=? WHERE key='invoice_counter'").run(counter + 1);
  return num;
}

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

// ─── "To Send": completed, uninvoiced appointments ──────────────────────────
router.get('/to-send', auth, (req, res) => {
  const { client_id, practitioner_id, from, to } = req.query;
  let where = "a.status != 'cancelled' AND a.is_invoiced = 0";
  const params = [];
  if (client_id)       { where += ' AND a.client_id = ?';       params.push(client_id); }
  if (practitioner_id) { where += ' AND a.practitioner_id = ?'; params.push(practitioner_id); }
  if (from)            { where += ' AND a.start_time >= ?';      params.push(from); }
  if (to)              { where += ' AND a.start_time <= ?';      params.push(to + 'T23:59'); }

  const rows = db.prepare(`
    SELECT a.id, a.start_time, a.end_time, a.client_id, a.practitioner_id, a.location, a.notes, a.series_id,
      c.first_name || ' ' || c.last_name AS client_name,
      p.first_name || ' ' || p.last_name AS practitioner_name, p.provider_number, p.color AS practitioner_color,
      fp.funds_manager_id,
      fm.name AS funds_manager_name, fm.email AS funds_manager_email
    FROM appointments a
    JOIN clients c ON c.id = a.client_id
    JOIN practitioners p ON p.id = a.practitioner_id
    LEFT JOIN funding_periods fp ON fp.client_id = a.client_id
      AND (fp.start_date IS NULL OR fp.start_date = '' OR fp.start_date <= DATE(a.start_time)) AND (fp.end_date IS NULL OR fp.end_date = '' OR fp.end_date >= DATE(a.start_time))
    LEFT JOIN funds_managers fm ON fm.id = fp.funds_manager_id
    WHERE ${where}
    ORDER BY a.start_time ASC
  `).all(...params);

  // Attach items to each appointment
  const ids = rows.map(r => r.id);
  const items = ids.length
    ? db.prepare(`
        SELECT ai.*, s.name AS service_name, s.code AS service_code,
          s.travel_rate_per_hour, s.km_rate, s.notes_rate
        FROM appointment_items ai LEFT JOIN services s ON s.id = ai.service_id
        WHERE ai.appointment_id IN (${ids.map(() => '?').join(',')})
      `).all(...ids)
    : [];
  const byAppt = {};
  for (const i of items) (byAppt[i.appointment_id] ||= []).push(i);
  for (const r of rows) r.items = byAppt[r.id] || [];

  res.json(rows);
});

// ─── List invoices (sent / paid / all) ──────────────────────────────────────
router.get('/', auth, (req, res) => {
  const { status, client_id, funds_manager_id } = req.query;
  let where = '1=1';
  const params = [];
  if (status) {
    const statuses = status.split(',');
    where += ` AND i.status IN (${statuses.map(() => '?').join(',')})`;
    params.push(...statuses);
  }
  if (client_id)        { where += ' AND i.client_id=?';        params.push(client_id); }
  if (funds_manager_id) { where += ' AND i.funds_manager_id=?'; params.push(funds_manager_id); }

  const invoices = db.prepare(`
    SELECT i.*,
      c.first_name || ' ' || c.last_name AS client_name,
      p.first_name || ' ' || p.last_name AS practitioner_name,
      fm.name AS funds_manager_name
    FROM invoices i
    JOIN clients c ON c.id = i.client_id
    LEFT JOIN practitioners p ON p.id = i.practitioner_id
    LEFT JOIN funds_managers fm ON fm.id = i.funds_manager_id
    WHERE ${where} ORDER BY i.created_at DESC
  `).all(...params);
  res.json(invoices);
});

// ─── Get single invoice with items ──────────────────────────────────────────
router.get('/:id', auth, (req, res) => {
  const inv = db.prepare(`
    SELECT i.*,
      c.first_name || ' ' || c.last_name AS client_name, c.email AS client_email, c.address AS client_address,
      p.first_name || ' ' || p.last_name AS practitioner_name, p.provider_number, p.title AS practitioner_title,
      fm.name AS funds_manager_name, fm.email AS funds_manager_email
    FROM invoices i
    JOIN clients c ON c.id = i.client_id
    LEFT JOIN practitioners p ON p.id = i.practitioner_id
    LEFT JOIN funds_managers fm ON fm.id = i.funds_manager_id
    WHERE i.id=?
  `).get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  inv.items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=?').all(req.params.id);
  res.json(inv);
});

// ─── Generate invoices from appointment IDs ─────────────────────────────────
router.post('/generate', auth, (req, res) => {
  const { appointment_ids } = req.body;
  if (!appointment_ids?.length) return res.status(400).json({ error: 'No appointments selected' });

  const settings = getSettings();
  const paymentTermsDays = parseInt(settings.invoice_payment_terms_days || '14');
  const taxRate = parseFloat(settings.tax_rate || '0.1');

  const created = [];

  for (const apptId of appointment_ids) {
    const appt = db.prepare(`
      SELECT a.*,
        c.first_name || ' ' || c.last_name AS client_name, c.address AS client_address, c.email AS client_email,
        p.first_name || ' ' || p.last_name AS practitioner_name, p.provider_number, p.title AS practitioner_title,
        fp.funds_manager_id
      FROM appointments a
      JOIN clients c ON c.id = a.client_id
      JOIN practitioners p ON p.id = a.practitioner_id
      LEFT JOIN funding_periods fp ON fp.client_id = a.client_id
        AND (fp.start_date IS NULL OR fp.start_date = '' OR fp.start_date <= DATE(a.start_time)) AND (fp.end_date IS NULL OR fp.end_date = '' OR fp.end_date >= DATE(a.start_time))
      WHERE a.id = ? AND a.is_invoiced = 0
    `).get(apptId);

    if (!appt) continue;

    const items = db.prepare(`
      SELECT ai.*, s.name AS service_name, s.code AS service_code,
        s.travel_rate_per_hour, s.km_rate, s.notes_rate,
        s.travel_code, s.km_code, s.notes_code,
        COALESCE(s.gst_rate, 0) AS service_gst_rate
      FROM appointment_items ai LEFT JOIN services s ON s.id = ai.service_id
      WHERE ai.appointment_id = ?
    `).all(apptId);

    if (!items.length) continue;

    // Build line items including travel/notes with codes and per-line GST
    const lineItems = [];
    for (const item of items) {
      const gst = item.service_gst_rate || 0;
      const addLine = (code, desc, qty, rate) => {
        const lt = qty * rate;
        lineItems.push({ appointment_item_id: item.id, code, description: desc, quantity: qty, unit_rate: rate, line_total: lt, gst_rate: gst, gst_amount: lt * gst });
      };
      addLine(item.service_code || '', item.service_name || item.description, item.quantity, item.unit_rate);
      if (item.travel_time_min) addLine(item.travel_code || '', `Travel time (${item.travel_time_min} min)`, item.travel_time_min / 60, item.travel_rate_per_hour || item.unit_rate);
      if (item.travel_km && item.km_rate) addLine(item.km_code || '', `Travel distance (${item.travel_km} km)`, item.travel_km, item.km_rate);
      if (item.notes_min) addLine(item.notes_code || '', `Clinical notes (${item.notes_min} min)`, item.notes_min / 60, item.notes_rate || item.unit_rate);
    }

    const subtotal = lineItems.reduce((s, i) => s + i.line_total, 0);
    const taxAmount = lineItems.reduce((s, i) => s + i.gst_amount, 0);
    const total = subtotal + taxAmount;

    const invoiceNumber = nextInvoiceNumber();
    const issueDate = new Date().toISOString().slice(0, 10);
    const dueDate = new Date(Date.now() + paymentTermsDays * 86400000).toISOString().slice(0, 10);

    const r = db.prepare(`
      INSERT INTO invoices (invoice_number, client_id, practitioner_id, appointment_id, funds_manager_id,
        issue_date, due_date, subtotal, tax_rate, tax_amount, total, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
    `).run(invoiceNumber, appt.client_id, appt.practitioner_id, apptId,
      appt.funds_manager_id || null, issueDate, dueDate, subtotal, 0, taxAmount, total);

    const insertItem = db.prepare(`
      INSERT INTO invoice_items (invoice_id, appointment_item_id, code, description, quantity, unit_rate, line_total, gst_rate, gst_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const li of lineItems) {
      insertItem.run(r.lastInsertRowid, li.appointment_item_id, li.code || null, li.description, li.quantity, li.unit_rate, li.line_total, li.gst_rate || 0, li.gst_amount || 0);
    }

    db.prepare('UPDATE appointments SET is_invoiced=1 WHERE id=?').run(apptId);
    created.push(r.lastInsertRowid);
  }

  res.status(201).json({ created: created.length, invoice_ids: created });
});

// ─── Send invoice to funder (or client if no funder) ────────────────────────
router.post('/:id/send', auth, async (req, res) => {
  const inv = db.prepare(`
    SELECT i.*,
      c.first_name || ' ' || c.last_name AS client_name, c.email AS client_email, c.address AS client_address,
      p.first_name || ' ' || p.last_name AS practitioner_name, p.provider_number, p.title AS practitioner_title,
      fm.name AS funds_manager_name, fm.email AS funds_manager_email
    FROM invoices i
    JOIN clients c ON c.id = i.client_id
    LEFT JOIN practitioners p ON p.id = i.practitioner_id
    LEFT JOIN funds_managers fm ON fm.id = i.funds_manager_id
    WHERE i.id=?
  `).get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });

  const recipient = inv.funds_manager_email || inv.client_email;
  if (!recipient) return res.status(422).json({ error: 'No email address for funder or client' });

  inv.items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=?').all(req.params.id);
  const settings = getSettings();

  const pdf = await generateInvoicePdf({
    ...inv,
    practice_name: settings.practice_name,
    practice_abn: settings.practice_abn,
    practice_email: settings.practice_email,
    practice_phone: settings.practice_phone,
    practice_address: settings.practice_address,
    bank_account_name: settings.bank_account_name,
    bank_bsb: settings.bank_bsb,
    bank_account_number: settings.bank_account_number,
    remittance_email: settings.remittance_email,
  });

  await sendInvoiceEmail(recipient, inv.invoice_number, pdf);
  db.prepare("UPDATE invoices SET status='sent', sent_at=? WHERE id=?").run(new Date().toISOString(), req.params.id);
  res.json(db.prepare('SELECT * FROM invoices WHERE id=?').get(req.params.id));
});

// ─── PDF download ───────────────────────────────────────────────────────────
router.get('/:id/pdf', auth, async (req, res) => {
  const inv = db.prepare(`
    SELECT i.*,
      c.first_name || ' ' || c.last_name AS client_name, c.email AS client_email, c.address AS client_address,
      p.first_name || ' ' || p.last_name AS practitioner_name, p.provider_number, p.title AS practitioner_title,
      fm.name AS funds_manager_name, fm.email AS funds_manager_email
    FROM invoices i
    JOIN clients c ON c.id = i.client_id
    LEFT JOIN practitioners p ON p.id = i.practitioner_id
    LEFT JOIN funds_managers fm ON fm.id = i.funds_manager_id
    WHERE i.id=?
  `).get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  inv.items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=?').all(req.params.id);
  const settings = getSettings();

  const pdf = await generateInvoicePdf({
    ...inv,
    practice_name: settings.practice_name,
    practice_abn: settings.practice_abn,
    practice_email: settings.practice_email,
    practice_phone: settings.practice_phone,
    practice_address: settings.practice_address,
    bank_account_name: settings.bank_account_name,
    bank_bsb: settings.bank_bsb,
    bank_account_number: settings.bank_account_number,
    remittance_email: settings.remittance_email,
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${inv.invoice_number}.pdf"`);
  res.send(pdf);
});

// ─── Mark paid ──────────────────────────────────────────────────────────────
router.patch('/:id/mark-paid', auth, (req, res) => {
  db.prepare("UPDATE invoices SET status='paid', paid_at=? WHERE id=?").run(req.body.paid_at || new Date().toISOString().slice(0, 10), req.params.id);
  res.json(db.prepare('SELECT * FROM invoices WHERE id=?').get(req.params.id));
});

// ─── Void invoice ───────────────────────────────────────────────────────────
router.patch('/:id/void', auth, (req, res) => {
  const inv = db.prepare('SELECT appointment_id FROM invoices WHERE id=?').get(req.params.id);
  if (inv?.appointment_id) {
    db.prepare('UPDATE appointments SET is_invoiced=0 WHERE id=?').run(inv.appointment_id);
  }
  db.prepare("UPDATE invoices SET status='void' WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// ─── Send reminders for overdue invoices (called by scheduler) ──────────────
async function sendOverdueReminders() {
  const settings = getSettings();
  const intervalDays = parseInt(settings.invoice_reminder_interval_days || '7');
  if (!intervalDays) return 0;

  const cutoff = new Date(Date.now() - intervalDays * 86400000).toISOString();
  const overdue = db.prepare(`
    SELECT i.*, fm.email AS funds_manager_email, c.email AS client_email, i.invoice_number
    FROM invoices i
    LEFT JOIN funds_managers fm ON fm.id = i.funds_manager_id
    JOIN clients c ON c.id = i.client_id
    WHERE i.status = 'sent' AND i.due_date < DATE('now')
      AND (i.last_reminder_at IS NULL OR i.last_reminder_at < ?)
  `).all(cutoff);

  let sent = 0;
  for (const inv of overdue) {
    const recipient = inv.funds_manager_email || inv.client_email;
    if (!recipient) continue;
    try {
      const { sendReminderEmail } = require('../services/mailer');
      await sendReminderEmail(recipient, inv.invoice_number, inv.total, inv.due_date);
      db.prepare('UPDATE invoices SET last_reminder_at=?, reminder_count=reminder_count+1 WHERE id=?')
        .run(new Date().toISOString(), inv.id);
      sent++;
    } catch (e) { console.error(`Reminder failed for ${inv.invoice_number}:`, e.message); }
  }
  return sent;
}

module.exports = router;
module.exports.sendOverdueReminders = sendOverdueReminders;
