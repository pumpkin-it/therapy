const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const db = new Database(path.join(__dirname, 'pm.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS practitioners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    title TEXT,
    email TEXT,
    phone TEXT,
    color TEXT DEFAULT '#6366f1',
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    date_of_birth TEXT,
    address TEXT,
    ndis_number TEXT,
    funding_type TEXT,
    notes TEXT,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    default_rate REAL NOT NULL,
    unit TEXT DEFAULT 'hour',
    default_duration INTEGER DEFAULT 60,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    practitioner_id INTEGER NOT NULL,
    client_id INTEGER NOT NULL,
    location TEXT,
    title TEXT,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    status TEXT DEFAULT 'scheduled',
    notes TEXT,
    is_invoiced INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (practitioner_id) REFERENCES practitioners(id),
    FOREIGN KEY (client_id) REFERENCES clients(id)
  );

  CREATE TABLE IF NOT EXISTS appointment_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id INTEGER NOT NULL,
    service_id INTEGER,
    description TEXT NOT NULL,
    quantity REAL DEFAULT 1,
    unit_rate REAL NOT NULL,
    travel_time_min INTEGER,
    travel_km REAL,
    prep_time_min INTEGER,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
    FOREIGN KEY (service_id) REFERENCES services(id)
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT UNIQUE NOT NULL,
    client_id INTEGER NOT NULL,
    status TEXT DEFAULT 'draft',
    issue_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    notes TEXT,
    subtotal REAL DEFAULT 0,
    tax_rate REAL DEFAULT 0.1,
    tax_amount REAL DEFAULT 0,
    total REAL DEFAULT 0,
    sent_at TEXT,
    paid_at TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id)
  );

  CREATE TABLE IF NOT EXISTS invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    appointment_item_id INTEGER,
    description TEXT NOT NULL,
    quantity REAL DEFAULT 1,
    unit_rate REAL NOT NULL,
    line_total REAL NOT NULL,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
    FOREIGN KEY (appointment_item_id) REFERENCES appointment_items(id)
  );
`);

// Migrations for existing databases
try { db.exec(`
  CREATE TABLE IF NOT EXISTS funds_managers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`); } catch {}
try { db.exec(`ALTER TABLE clients ADD COLUMN funds_manager_id INTEGER REFERENCES funds_managers(id)`); } catch {}
try { db.exec(`ALTER TABLE funds_managers ADD COLUMN phone TEXT`); } catch {}
try { db.exec(`ALTER TABLE clients ADD COLUMN plan_start_date TEXT`); } catch {}
try { db.exec(`ALTER TABLE clients ADD COLUMN plan_end_date TEXT`); } catch {}

try { db.exec(`ALTER TABLE services ADD COLUMN code TEXT`); } catch {}
try { db.exec(`ALTER TABLE services ADD COLUMN travel_code TEXT`); } catch {}
try { db.exec(`ALTER TABLE services ADD COLUMN km_code TEXT`); } catch {}
try { db.exec(`ALTER TABLE services ADD COLUMN notes_code TEXT`); } catch {}
try { db.exec(`ALTER TABLE invoice_items ADD COLUMN code TEXT`); } catch {}
try { db.exec(`ALTER TABLE invoices ADD COLUMN voided_at TEXT`); } catch {}

try { db.exec(`
  CREATE TABLE IF NOT EXISTS gst_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rate REAL NOT NULL,
    effective_from TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`); } catch {}

try { db.exec(`ALTER TABLE services ADD COLUMN gst_type TEXT DEFAULT 'GST'`); } catch {}
try { db.exec(`ALTER TABLE appointment_items ADD COLUMN travel_time_to INTEGER`); } catch {}
try { db.exec(`ALTER TABLE appointment_items ADD COLUMN travel_time_from INTEGER`); } catch {}

try { db.exec(`
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    entity_ref TEXT,
    action TEXT NOT NULL,
    details TEXT,
    snapshot TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`); } catch {}
try { db.exec(`ALTER TABLE invoice_items ADD COLUMN service_date TEXT`); } catch {}
try { db.exec(`ALTER TABLE invoice_items ADD COLUMN gst_rate REAL DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE invoice_items ADD COLUMN gst_amount REAL DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE invoice_items ADD COLUMN gst_type TEXT DEFAULT 'GST'`); } catch {}
try { db.exec(`ALTER TABLE services ADD COLUMN travel_rate_per_hour REAL`); } catch {}
try { db.exec(`ALTER TABLE services ADD COLUMN km_rate REAL`); } catch {}

try { db.exec(`
  CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`); } catch {}
try { db.exec(`ALTER TABLE appointments ADD COLUMN location_id INTEGER REFERENCES locations(id)`); } catch {}

// Emergency contact + medical info
try { db.exec(`ALTER TABLE clients ADD COLUMN emergency_contact_name TEXT`); } catch {}
try { db.exec(`ALTER TABLE clients ADD COLUMN emergency_contact_phone TEXT`); } catch {}
try { db.exec(`ALTER TABLE clients ADD COLUMN emergency_contact_relationship TEXT`); } catch {}
try { db.exec(`ALTER TABLE clients ADD COLUMN diagnosis TEXT`); } catch {}
try { db.exec(`ALTER TABLE clients ADD COLUMN allergies TEXT`); } catch {}
try { db.exec(`ALTER TABLE clients ADD COLUMN regular_medication TEXT`); } catch {}

try { db.exec(`
  CREATE TABLE IF NOT EXISTS funding_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    funding_type TEXT NOT NULL,
    funds_manager_id INTEGER REFERENCES funds_managers(id),
    client_identifier TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`); } catch {}
try { db.exec(`
  CREATE TABLE IF NOT EXISTS funding_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT DEFAULT 'gray',
    has_ndis_management INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`); } catch {}
try { db.exec(`ALTER TABLE funding_periods ADD COLUMN ndis_management TEXT`); } catch {}
try { db.exec(`ALTER TABLE funding_periods ADD COLUMN self_managed_email TEXT`); } catch {}
try { db.exec(`ALTER TABLE services ADD COLUMN gst_rate REAL`); } catch {}
try { db.exec(`ALTER TABLE practitioners ADD COLUMN provider_number TEXT`); } catch {}
try { db.exec(`ALTER TABLE appointments ADD COLUMN late_cancel_pct REAL`); } catch {}
try { db.exec(`ALTER TABLE appointments ADD COLUMN late_cancel_billable INTEGER DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE practitioners ADD COLUMN role TEXT DEFAULT 'practitioner'`); } catch {}
try { db.exec(`ALTER TABLE clients ADD COLUMN gender TEXT`); } catch {}
try { db.exec(`ALTER TABLE practitioners ADD COLUMN gender TEXT`); } catch {}
try { db.exec(`ALTER TABLE practitioners ADD COLUMN password_hash TEXT`); } catch {}
try { db.exec(`ALTER TABLE practitioners ADD COLUMN cal_token TEXT`); } catch {}
try { db.exec(`
  CREATE TABLE IF NOT EXISTS push_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    practitioner_id INTEGER NOT NULL REFERENCES practitioners(id),
    token TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`); } catch {}
try { db.exec(`
  CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    practitioner_id INTEGER NOT NULL REFERENCES practitioners(id),
    token TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`); } catch {}

try { db.exec(`
  CREATE TABLE IF NOT EXISTS disciplines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`); } catch {}
try { db.exec(`ALTER TABLE practitioners ADD COLUMN discipline_id INTEGER REFERENCES disciplines(id)`); } catch {}
try { db.exec(`ALTER TABLE services ADD COLUMN discipline_id INTEGER REFERENCES disciplines(id)`); } catch {}
try { db.exec(`ALTER TABLE invoices ADD COLUMN appointment_id INTEGER REFERENCES appointments(id)`); } catch {}
try { db.exec(`ALTER TABLE invoices ADD COLUMN funds_manager_id INTEGER REFERENCES funds_managers(id)`); } catch {}
try { db.exec(`ALTER TABLE invoices ADD COLUMN practitioner_id INTEGER REFERENCES practitioners(id)`); } catch {}
try { db.exec(`ALTER TABLE invoices ADD COLUMN last_reminder_at TEXT`); } catch {}
try { db.exec(`ALTER TABLE invoices ADD COLUMN self_managed_email TEXT`); } catch {}
try { db.exec(`ALTER TABLE invoices ADD COLUMN reminder_count INTEGER DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE invoices ADD COLUMN myob_exported_at TEXT`); } catch {}
try { db.exec(`ALTER TABLE appointments ADD COLUMN myob_exported_at TEXT`); } catch {}
try { db.exec(`ALTER TABLE appointments ADD COLUMN series_id INTEGER REFERENCES recurring_series(id)`); } catch {}

try { db.exec(`
  CREATE TABLE IF NOT EXISTS recurring_series (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    practitioner_id INTEGER NOT NULL REFERENCES practitioners(id),
    client_id INTEGER NOT NULL REFERENCES clients(id),
    location TEXT,
    location_id INTEGER,
    location_other TEXT,
    title TEXT,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    notes TEXT,
    freq TEXT NOT NULL,
    day_of_week INTEGER NOT NULL,
    end_type TEXT DEFAULT 'never',
    end_date TEXT,
    end_occurrences INTEGER,
    items_json TEXT,
    active INTEGER DEFAULT 1,
    generated_until TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`); } catch {}

try { db.exec(`
  CREATE TABLE IF NOT EXISTS recurring_series_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    series_id INTEGER NOT NULL REFERENCES recurring_series(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`); } catch {}
try { db.exec(`ALTER TABLE clients ADD COLUMN emergency_contact_email TEXT`); } catch {}
try { db.exec(`ALTER TABLE appointment_items ADD COLUMN notes_min INTEGER`); } catch {}
try { db.exec(`ALTER TABLE clients ADD COLUMN alert TEXT`); } catch {}
try { db.exec(`ALTER TABLE appointments ADD COLUMN location_other TEXT`); } catch {}
try { db.exec(`ALTER TABLE appointments ADD COLUMN funding_period_id INTEGER REFERENCES funding_periods(id)`); } catch {}
try { db.exec(`ALTER TABLE appointment_items ADD COLUMN item_notes TEXT`); } catch {}
try { db.exec(`ALTER TABLE services ADD COLUMN notes_rate REAL`); } catch {}
try { db.exec(`UPDATE services SET gst_type='FRE' WHERE gst_type='GST' OR gst_type IS NULL`); } catch {}
try { db.exec(`
  CREATE TABLE IF NOT EXISTS client_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    size INTEGER,
    mime_type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`); } catch {}

try { db.exec(`
  CREATE TABLE IF NOT EXISTS session_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    practitioner_id INTEGER REFERENCES practitioners(id),
    note TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`); } catch {}

// Migrate case_notes → session_notes if the old table still exists
try {
  const hasOld = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='case_notes'").get();
  if (hasOld) {
    db.exec(`
      INSERT OR IGNORE INTO session_notes (id, appointment_id, client_id, practitioner_id, note, created_at)
      SELECT id, appointment_id, client_id, practitioner_id, note, created_at FROM case_notes;
      DROP TABLE case_notes;
    `);
  }
} catch {}

// Seed default settings
const defaults = {
  practice_name: 'My Therapy Practice',
  practice_email: '',
  practice_phone: '',
  practice_address: '',
  practice_abn: '',
  smtp_host: 'smtp.office365.com',
  smtp_port: '587',
  smtp_secure: '0',
  smtp_user: '',
  smtp_pass: '',
  smtp_from_name: '',
  smtp_from_email: '',
  invoice_counter: '1',
  tax_rate: '0.1',
  graph_tenant_id: '',
  graph_client_id: '',
  graph_client_secret: '',
  graph_mailbox: '',
  google_maps_api_key: '',
  bank_account_name: '',
  bank_bsb: '',
  bank_account_number: '',
  remittance_email: '',
  invoice_payment_terms_days: '14',
  invoice_reminder_interval_days: '7',
  invoicing_mode: 'generate',
  role_permissions: JSON.stringify({
    owner:        { calendar:true, clients:true, users:true, funds_managers:true, locations:true, services:true, invoices:true, settings:true },
    admin:        { calendar:true, clients:true, users:true, funds_managers:true, locations:true, services:true, invoices:true, settings:false },
    practitioner: { calendar:true, clients:true, users:false, funds_managers:false, locations:true, services:true, invoices:false, settings:false },
    finance:      { calendar:false, clients:true, users:false, funds_managers:true, locations:false, services:true, invoices:true, settings:false },
  }),
};

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(defaults)) {
  insertSetting.run(key, value);
}

// Seed default funding types
const ftCount = db.prepare('SELECT COUNT(*) as c FROM funding_types').get().c;
if (ftCount === 0) {
  const ins = db.prepare('INSERT INTO funding_types (name, color, has_ndis_management) VALUES (?, ?, ?)');
  ins.run('NDIS', 'blue', 1);
  ins.run('Medicare', 'green', 0);
  ins.run('Private', 'purple', 0);
  ins.run('Aged Care', 'orange', 0);
  ins.run('Other', 'gray', 0);
}

// Seed default GST rate
const gstCount = db.prepare('SELECT COUNT(*) as c FROM gst_rates').get().c;
if (gstCount === 0) {
  db.prepare("INSERT INTO gst_rates (rate, effective_from) VALUES (0.1, '2000-07-01')").run();
}

// Seed default admin user (legacy users table)
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (userCount === 0) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')")
    .run('Administrator', 'admin@practice.com', hash);
}

// Ensure at least one practitioner can log in (owner role with default password)
const loginablePracs = db.prepare("SELECT COUNT(*) as c FROM practitioners WHERE password_hash IS NOT NULL").get().c;
if (loginablePracs === 0) {
  const firstPrac = db.prepare("SELECT id, first_name, last_name, email FROM practitioners WHERE active = 1 ORDER BY id LIMIT 1").get();
  if (firstPrac) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare("UPDATE practitioners SET password_hash = ?, role = 'owner' WHERE id = ?").run(hash, firstPrac.id);
    console.log(`Default login set for ${firstPrac.first_name} ${firstPrac.last_name} (${firstPrac.email}) — password: admin123`);
  } else {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare("INSERT INTO practitioners (first_name, last_name, email, role, password_hash) VALUES ('Admin', 'User', 'admin@practice.com', 'owner', ?)").run(hash);
    console.log('Created default admin practitioner: admin@practice.com / admin123');
  }
}

// Generate calendar tokens for practitioners that don't have one
const crypto = require('crypto');
const pracsWithoutToken = db.prepare("SELECT id FROM practitioners WHERE cal_token IS NULL").all();
for (const p of pracsWithoutToken) {
  db.prepare("UPDATE practitioners SET cal_token = ? WHERE id = ?").run(crypto.randomBytes(20).toString('hex'), p.id);
}

// Keep old tables (orphaned, harmless) so existing data isn't lost
db.exec(`
  CREATE TABLE IF NOT EXISTS report_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT,
    sections TEXT NOT NULL DEFAULT '[]', created_by INTEGER, active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS client_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL,
    practitioner_id INTEGER NOT NULL, template_id INTEGER, template_name TEXT,
    title TEXT NOT NULL, sections TEXT NOT NULL DEFAULT '[]', appointment_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  );
`);

// Communication & session note templates
db.exec(`
  CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    code TEXT UNIQUE,
    name TEXT NOT NULL,
    subject TEXT,
    body TEXT NOT NULL DEFAULT '',
    active INTEGER DEFAULT 1,
    is_system INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Seed system email templates (INSERT OR IGNORE so edits are preserved)
const emailSeeds = [
  {
    code: 'appt_created_client',
    name: 'Appointment Confirmation (Client)',
    subject: 'Your appointment on {{appointment_date}}',
    body: '<p>Hi {{client_first_name}},</p><p>Your appointment has been scheduled.</p>{{appointment_details}}',
  },
  {
    code: 'appt_updated_client',
    name: 'Appointment Updated (Client)',
    subject: 'Appointment updated — {{appointment_date}}',
    body: '<p>Hi {{client_first_name}},</p><p>Your appointment details have been updated.</p>{{appointment_details}}',
  },
  {
    code: 'appt_cancelled_client',
    name: 'Appointment Cancelled (Client)',
    subject: 'Appointment cancelled — {{appointment_date}}',
    body: '<p>Hi {{client_first_name}},</p><p>Your appointment on <strong>{{appointment_date}}</strong> has been <strong style="color:#dc2626">cancelled</strong>. Please contact us if you have any questions.</p>',
  },
  {
    code: 'appt_created_practitioner',
    name: 'Appointment Notification (Practitioner)',
    subject: 'New appointment: {{appointment_date}}',
    body: '<p>Hi {{practitioner_name}},</p><p>A new appointment has been scheduled for you.</p>{{appointment_details}}',
  },
  {
    code: 'appt_updated_practitioner',
    name: 'Appointment Updated (Practitioner)',
    subject: 'Appointment updated: {{appointment_date}}',
    body: '<p>Hi {{practitioner_name}},</p><p>An appointment has been updated.</p>{{appointment_details}}',
  },
  {
    code: 'appt_cancelled_practitioner',
    name: 'Appointment Cancelled (Practitioner)',
    subject: 'Appointment cancelled: {{appointment_date}}',
    body: '<p>Hi {{practitioner_name}},</p><p>The following appointment has been <strong style="color:#dc2626">cancelled</strong>.</p>{{appointment_details}}',
  },
  {
    code: 'invoice_email',
    name: 'Invoice Email',
    subject: 'Invoice {{invoice_number}}',
    body: '<p>Please find your invoice <strong>{{invoice_number}}</strong> attached.</p><p>Thank you.</p>',
  },
  {
    code: 'payment_reminder',
    name: 'Payment Reminder',
    subject: 'Payment Reminder — Invoice {{invoice_number}}',
    body: '<p>This is a friendly reminder that invoice <strong>{{invoice_number}}</strong> for <strong>${{invoice_total}}</strong> was due on <strong>{{due_date}}</strong> and remains unpaid.</p><p>Please arrange payment at your earliest convenience.</p><p>Thank you.</p>',
  },
];
const seedStmt = db.prepare(`
  INSERT OR IGNORE INTO templates (type, code, name, subject, body, is_system)
  VALUES ('email', ?, ?, ?, ?, 1)
`);
for (const s of emailSeeds) seedStmt.run(s.code, s.name, s.subject, s.body);

try { db.exec(`
  CREATE TABLE IF NOT EXISTS rate_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    funding_type_id INTEGER REFERENCES funding_types(id),
    discipline_id INTEGER REFERENCES disciplines(id),
    category TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    unit TEXT DEFAULT 'hour',
    rate REAL,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`); } catch {}
try { db.exec(`ALTER TABLE services ADD COLUMN cancel_rate_item_id INTEGER REFERENCES rate_items(id)`); } catch {}
try { db.exec(`ALTER TABLE invoice_items ADD COLUMN line_type TEXT DEFAULT 'service'`); } catch {}
try { db.exec(`ALTER TABLE services ADD COLUMN cancel_code TEXT`); } catch {}

// Partial unique indexes for duplicate prevention
try { db.exec(`CREATE UNIQUE INDEX idx_practitioners_email ON practitioners(email) WHERE email IS NOT NULL AND email != ''`); } catch {}
try { db.exec(`CREATE UNIQUE INDEX idx_clients_ndis ON clients(ndis_number) WHERE ndis_number IS NOT NULL AND ndis_number != ''`); } catch {}

module.exports = db;
