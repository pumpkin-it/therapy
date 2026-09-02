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
try { db.exec(`ALTER TABLE practitioners ADD COLUMN provider_number TEXT`); } catch {}
try { db.exec(`ALTER TABLE appointments ADD COLUMN late_cancel_pct REAL`); } catch {}
try { db.exec(`ALTER TABLE appointments ADD COLUMN late_cancel_billable INTEGER DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE practitioners ADD COLUMN role TEXT DEFAULT 'practitioner'`); } catch {}
try { db.exec(`ALTER TABLE clients ADD COLUMN gender TEXT`); } catch {}
try { db.exec(`ALTER TABLE practitioners ADD COLUMN gender TEXT`); } catch {}
try { db.exec(`ALTER TABLE practitioners ADD COLUMN password_hash TEXT`); } catch {}
try { db.exec(`ALTER TABLE practitioners ADD COLUMN cal_token TEXT`); } catch {}
try { db.exec(`ALTER TABLE practitioners ADD COLUMN target_amount REAL`); } catch {}
try { db.exec(`ALTER TABLE practitioners ADD COLUMN target_period TEXT`); } catch {} // 'weekly' | 'fortnightly' | 'monthly'
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
// Distinct from `active` — marks a client as dummy/test data rather than a real, historically
// deactivated client. Excluded from the client list entirely (not just the default Active
// filter), so genuine inactive clients stay visible for historical purposes.
try { db.exec(`ALTER TABLE clients ADD COLUMN is_test_data INTEGER DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE appointments ADD COLUMN location_other TEXT`); } catch {}
try { db.exec(`ALTER TABLE appointments ADD COLUMN funding_period_id INTEGER REFERENCES funding_periods(id)`); } catch {}
try { db.exec(`ALTER TABLE appointment_items ADD COLUMN item_notes TEXT`); } catch {}
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
  CREATE TABLE IF NOT EXISTS client_file_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`); } catch {}
try { db.exec(`ALTER TABLE client_files ADD COLUMN folder_id INTEGER REFERENCES client_file_folders(id)`); } catch {}
try { db.exec(`ALTER TABLE client_files ADD COLUMN label TEXT`); } catch {}

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
try { db.exec(`ALTER TABLE session_notes ADD COLUMN archived INTEGER DEFAULT 0`); } catch {}
try { db.exec(`
  CREATE TABLE IF NOT EXISTS session_note_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_note_id INTEGER NOT NULL REFERENCES session_notes(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    size INTEGER,
    mime_type TEXT,
    label TEXT,
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
  agreement_reminder_interval_days: '3',
  agreement_reminder_duration_days: '10',
  invoicing_mode: 'generate',
  role_permissions: JSON.stringify({
    owner:        { calendar:true, clients:true, users:true, funds_managers:true, locations:true, services:true, invoices:true, settings:true, funding_periods:true, reports:true },
    admin:        { calendar:true, clients:true, users:true, funds_managers:true, locations:true, services:true, invoices:true, settings:false, funding_periods:true, reports:true },
    practitioner: { calendar:true, clients:true, users:false, funds_managers:false, locations:true, services:true, invoices:false, settings:false, funding_periods:false, reports:true },
    finance:      { calendar:false, clients:true, users:false, funds_managers:true, locations:false, services:true, invoices:true, settings:false, funding_periods:true, reports:true },
  }),
};

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(defaults)) {
  insertSetting.run(key, value);
}

// Backfill the funding_periods permission key into an already-existing role_permissions row —
// INSERT OR IGNORE above only seeds a brand-new settings row, so a deployed instance's existing
// customized permissions need this key merged in without touching anything else already set.
{
  const FUNDING_PERIODS_DEFAULT = { owner: true, admin: true, practitioner: false, finance: true };
  const row = db.prepare("SELECT value FROM settings WHERE key = 'role_permissions'").get();
  if (row) {
    try {
      const perms = JSON.parse(row.value);
      let changed = false;
      for (const role of Object.keys(perms)) {
        if (perms[role].funding_periods === undefined) {
          perms[role].funding_periods = FUNDING_PERIODS_DEFAULT[role] ?? false;
          changed = true;
        }
      }
      if (changed) {
        db.prepare("UPDATE settings SET value = ? WHERE key = 'role_permissions'").run(JSON.stringify(perms));
      }
    } catch {}
  }
}

// Backfill the reports permission key the same way — new page, existing installs need it merged
// into their (possibly already-customized) role_permissions row.
{
  const REPORTS_DEFAULT = { owner: true, admin: true, practitioner: true, finance: true };
  const row = db.prepare("SELECT value FROM settings WHERE key = 'role_permissions'").get();
  if (row) {
    try {
      const perms = JSON.parse(row.value);
      let changed = false;
      for (const role of Object.keys(perms)) {
        if (perms[role].reports === undefined) {
          perms[role].reports = REPORTS_DEFAULT[role] ?? false;
          changed = true;
        }
      }
      if (changed) {
        db.prepare("UPDATE settings SET value = ? WHERE key = 'role_permissions'").run(JSON.stringify(perms));
      }
    } catch {}
  }
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
    body: '<p>Hi {{client_first_name}},</p><p>Your appointment on <strong>{{appointment_date}}</strong> has been <strong style="color:#dc2626">cancelled</strong>. Please contact us if you have any questions.</p>{{late_cancellation_notice}}',
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
  {
    code: 'session_note_email',
    name: 'Session Note Email',
    subject: 'Session notes for {{client_name}}',
    body: '<p>Hi {{recipient_name}},</p><p>Please find attached the session notes for {{client_name}} covering {{date_range}}.</p><p>Regards,<br>{{practitioner_name}}</p>',
  },
  {
    code: 'agreement_reminder',
    name: 'Agreement Signing Reminder',
    subject: 'Reminder: please sign — {{title}}',
    body: '<p>Hi {{client_first_name}},</p><p>This is a friendly reminder that your <strong>{{title}}</strong> is still awaiting your signature.</p><p>Please review and sign using the link below.</p><p><a href="{{signing_url}}">{{signing_url}}</a></p>',
  },
];
const seedStmt = db.prepare(`
  INSERT OR IGNORE INTO templates (type, code, name, subject, body, is_system)
  VALUES ('email', ?, ?, ?, ?, 1)
`);
for (const s of emailSeeds) seedStmt.run(s.code, s.name, s.subject, s.body);

// One-time backfill: append {{late_cancellation_notice}} to an already-seeded
// appt_cancelled_client row, but only if it still exactly matches the old default —
// never touch a practice's customized wording.
try {
  db.prepare(`
    UPDATE templates SET body = body || '{{late_cancellation_notice}}'
    WHERE code = 'appt_cancelled_client'
      AND body = '<p>Hi {{client_first_name}},</p><p>Your appointment on <strong>{{appointment_date}}</strong> has been <strong style="color:#dc2626">cancelled</strong>. Please contact us if you have any questions.</p>'
  `).run();
} catch {}

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
try { db.exec(`ALTER TABLE invoice_items ADD COLUMN line_type TEXT DEFAULT 'service'`); } catch {}

// Partial unique indexes for duplicate prevention
try { db.exec(`CREATE UNIQUE INDEX idx_practitioners_email ON practitioners(email) WHERE email IS NOT NULL AND email != ''`); } catch {}
try { db.exec(`CREATE UNIQUE INDEX idx_clients_ndis ON clients(ndis_number) WHERE ndis_number IS NOT NULL AND ndis_number != ''`); } catch {}

// Rate periods — date-based pricing windows scoped to a funding type (NDIS, Aged Care, etc.),
// since different schemes revise their rates on different schedules. A service can have a rate
// row under multiple funding types at once (same clinical service, different scheme/rate/code).
try { db.exec(`
  CREATE TABLE IF NOT EXISTS rate_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    funding_type_id INTEGER NOT NULL REFERENCES funding_types(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL DEFAULT '9999-09-09',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`); } catch {}
try { db.exec(`CREATE INDEX idx_rate_periods_funding_type ON rate_periods(funding_type_id)`); } catch {}

try { db.exec(`
  CREATE TABLE IF NOT EXISTS service_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_id INTEGER NOT NULL REFERENCES rate_periods(id) ON DELETE CASCADE,
    service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    code TEXT,
    rate REAL NOT NULL DEFAULT 0,
    travel_code TEXT,
    travel_rate_per_hour REAL,
    km_code TEXT,
    km_rate REAL,
    notes_code TEXT,
    notes_rate REAL,
    cancel_code TEXT,
    gst_type TEXT DEFAULT 'GST',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`); } catch {}
try { db.exec(`CREATE INDEX idx_service_rates_period ON service_rates(period_id)`); } catch {}
try { db.exec(`CREATE UNIQUE INDEX idx_service_rates_period_service ON service_rates(period_id, service_id)`); } catch {}

// One-time migration from the old service-scoped service_rate_periods table (superseded — rates
// are now grouped by funding type). Maps existing services to a funding type by name prefix
// ("NDIS - ..." -> NDIS, "SaH - ..." -> Aged Care); anything else is left unassigned for manual
// setup via the funding type's rate management page. Guarded so it only ever runs once.
try {
  const hasOldTable = db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='service_rate_periods'").get().c > 0;
  const alreadyMigrated = db.prepare('SELECT COUNT(*) AS c FROM rate_periods').get().c > 0 || db.prepare('SELECT COUNT(*) AS c FROM service_rates').get().c > 0;
  if (hasOldTable && !alreadyMigrated) {
    const resolveFundingTypeName = name => {
      if (/^NDIS\b/i.test(name)) return 'NDIS';
      if (/^SaH\b/i.test(name)) return 'Aged Care';
      return null;
    };
    const oldRows = db.prepare('SELECT srp.*, s.name AS service_name FROM service_rate_periods srp JOIN services s ON s.id = srp.service_id').all();
    const findFundingType = db.prepare('SELECT id FROM funding_types WHERE name = ?');
    const findPeriod = db.prepare('SELECT id FROM rate_periods WHERE funding_type_id = ? AND start_date = ? AND end_date = ?');
    const insertPeriod = db.prepare('INSERT INTO rate_periods (funding_type_id, name, start_date, end_date) VALUES (?, ?, ?, ?)');
    const insertServiceRate = db.prepare(`
      INSERT INTO service_rates (period_id, service_id, code, rate, travel_code, travel_rate_per_hour, km_code, km_rate, notes_code, notes_rate, cancel_code, gst_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    db.transaction(() => {
      const periodCache = {};
      for (const row of oldRows) {
        const ftName = resolveFundingTypeName(row.service_name);
        if (!ftName) continue;
        const ft = findFundingType.get(ftName);
        if (!ft) continue;
        const key = `${ft.id}|${row.start_date}|${row.end_date}`;
        let periodId = periodCache[key];
        if (!periodId) {
          const existing = findPeriod.get(ft.id, row.start_date, row.end_date);
          periodId = existing ? existing.id : insertPeriod.run(ft.id, row.name, row.start_date, row.end_date).lastInsertRowid;
          periodCache[key] = periodId;
        }
        insertServiceRate.run(periodId, row.service_id, row.code, row.rate, row.travel_code, row.travel_rate_per_hour,
          row.km_code, row.km_rate, row.notes_code, row.notes_rate, row.cancel_code, row.gst_type);
      }
    })();
  }
} catch (e) { console.error('rate_periods migration failed:', e); }

try { db.exec('DROP TABLE IF EXISTS service_rate_periods'); } catch {}

// Digital service agreements — client_id + template scoped, signed via a public token link.
// Content is snapshotted to rendered_html once sent, same principle as invoice_items freezing
// unit_rate: later template/rate edits must never retroactively change something already sent.
try { db.exec(`
  CREATE TABLE IF NOT EXISTS agreements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    template_id INTEGER REFERENCES templates(id),
    funding_type_id INTEGER REFERENCES funding_types(id),
    effective_date TEXT NOT NULL,
    title TEXT NOT NULL,
    rendered_html TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    signing_token TEXT UNIQUE,
    sent_at TEXT,
    viewed_at TEXT,
    signed_at TEXT,
    declined_at TEXT,
    signer_name TEXT,
    signer_email TEXT,
    signed_ip TEXT,
    signed_user_agent TEXT,
    pdf_path TEXT,
    created_by INTEGER REFERENCES practitioners(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`); } catch {}
try { db.exec(`CREATE INDEX idx_agreements_client ON agreements(client_id)`); } catch {}
try { db.exec(`CREATE UNIQUE INDEX idx_agreements_token ON agreements(signing_token) WHERE signing_token IS NOT NULL`); } catch {}

// Pricing table rows for an agreement — parallel to invoice_items/appointment_items.
// description/code/unit_rate/line_total are snapshotted per row; service_id kept for reporting.
try { db.exec(`
  CREATE TABLE IF NOT EXISTS agreement_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agreement_id INTEGER NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
    service_id INTEGER REFERENCES services(id),
    sort_order INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL,
    code TEXT,
    quantity REAL NOT NULL DEFAULT 1,
    unit_rate REAL NOT NULL DEFAULT 0,
    line_total REAL NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`); } catch {}
try { db.exec(`CREATE INDEX idx_agreement_items_agreement ON agreement_items(agreement_id)`); } catch {}

// Agreement template type — reuses the existing templates table (type='agreement') plus a flag
// telling the UI whether to show the pricing-table builder for agreements from this template.
try { db.exec(`ALTER TABLE templates ADD COLUMN has_pricing_table INTEGER DEFAULT 0`); } catch {}

// Agreement coverage window + optional budget cap (nullable — budget tracking is opt-in per
// agreement). end_date left blank means an open-ended agreement; budget spend is computed
// against [start_date, end_date-or-today] in server/services/budgets.js.
try { db.exec(`ALTER TABLE agreements ADD COLUMN start_date TEXT`); } catch {}
try { db.exec(`ALTER TABLE agreements ADD COLUMN end_date TEXT`); } catch {}
try { db.exec(`ALTER TABLE agreements ADD COLUMN budget_amount REAL`); } catch {}

// Signing reminder tracking — reminder_end_date is per-agreement (defaults computed from
// agreement_reminder_duration_days at finalize time, editable any time after via
// PATCH /agreements/:id/reminder-end-date); last_reminder_at/reminder_count mirror the
// existing invoices.last_reminder_at/reminder_count pattern used by sendOverdueReminders.
try { db.exec(`ALTER TABLE agreements ADD COLUMN reminder_end_date TEXT`); } catch {}
try { db.exec(`ALTER TABLE agreements ADD COLUMN last_reminder_at TEXT`); } catch {}
try { db.exec(`ALTER TABLE agreements ADD COLUMN reminder_count INTEGER DEFAULT 0`); } catch {}

const SERVICE_AGREEMENT_PLACEHOLDER_BODY =
  '<p>This Service Agreement is made between {{practice_name}} and {{client_name}} on {{date}}.</p>' +
  '<p>{{practice_name}} agrees to provide the services listed below to {{client_name}}, at the rates specified.</p>' +
  '{{pricing_table}}' +
  '<p>By signing below, {{client_name}} agrees to the terms of this Service Agreement.</p>';

const SERVICE_AGREEMENT_BODY = `
<p><strong>{{practice_name}} &ndash; ABN {{practice_abn}}</strong></p>
<p><strong>SERVICE AGREEMENT AND CONSENT</strong></p>
<p>Welcome to {{practice_name}}, your trusted therapy provider. We&rsquo;re delighted to have you as part of our community. As a participant in the National Disability Insurance Scheme (NDIS), we are here to provide you with Occupational Therapy services.</p>
<p>This agreement outlines our partnership, ensuring alignment with NDIS guidelines and your personal goals. You have the flexibility to cancel this agreement at any time by calling us at {{practice_phone}}. Our priority is to make your experience with us positive, supportive, and tailored to your needs.</p>
<p>We look forward to working together and making meaningful progress!</p>
<p><strong>About You</strong></p>
<p><strong>Your Name</strong> {{client_name}}</p>
<p><strong>Address</strong> {{client_address}}</p>
<p>Email Address {{client_email}} &nbsp; NDIS Number {{client_ndis_number}}</p>
<p><strong>Your Therapy Supports</strong></p>
<p>Here&rsquo;s how your funds will be allocated:</p>
{{pricing_table}}
<p><strong>Dates of the Plan</strong> {{plan_start_date}} to {{plan_end_date}}</p>
<p><strong>Dates of this Agreement</strong> {{date}} to _________</p>
<p><strong>Travel</strong></p>
<p>Feel free to discuss your therapy session location with your therapist. Travel time will be charged to and from the appointment at the rate specified in the pricing table above. Kilometre charges also apply on top of travel time.</p>
<p><strong>Non-Face-to-Face Activities</strong></p>
<p>It&rsquo;s important to note that some activities, like creating resources and necessary report writing, are essential for helping you achieve your goals. We&rsquo;ll discuss these activities with you, seek your approval before proceeding, and keep you informed throughout. Remember, there&rsquo;ll be a charge for the practitioner&rsquo;s time to complete these activities, but it&rsquo;s all part of the personalised support to ensure you reach your milestones smoothly.</p>
<p><strong>How Therapy Support Payments Work</strong></p>
<p>Your therapy is planned to assist you in reaching your goals, and we want to ensure a clear and straightforward payment process. We use the current price outlined in this service agreement. If there are any changes to the pricing, we&rsquo;ll make sure to update you accordingly.</p>
<p>We&rsquo;re here to provide therapy within the agreed budget. It&rsquo;s your responsibility to ensure these funds are available in your NDIS plan and allocated for use with us.</p>
<p>If anything changes in your NDIS plan or if the therapy funds are used differently, let us know right away. If the funds are no longer available and therapy continues without notice, you&rsquo;d be responsible for covering the cost.</p>
<p>NDIS payments come in three options, and your plan will specify which one applies to you. Take a moment to indicate the preferred payment option on your plan. We&rsquo;re here to make the payment process as easy as possible as you work towards your goals!</p>
<p>&#9744; <strong>NDIA-Managed.</strong> The NDIA (National Disability Insurance Agency) will pay your support provider directly for these supports. This means the NDIA will pay {{practice_name}} directly for your therapy.</p>
<p>Please ensure that you&rsquo;ve added {{practice_name}} as an endorsed provider on the PACE system to enable us to claim payment for services delivered. If you&rsquo;re unsure how to do this, please call {{practice_name}} directly on {{practice_phone}} and we can assist you with this.</p>
<p>&#9744; <strong>Self-Managed.</strong> The NDIA will pay you directly for these supports. This means {{practice_name}} will send you an invoice which you will pay using the money given to you by the NDIA.</p>
<p>&#9744; <strong>Plan-Managed.</strong> The NDIA will pay your plan manager for these supports. {{practice_name}} will send invoices to your plan manager and they will then pay {{practice_name}}. The details for my plan manager are:</p>
<p><strong>Organisation</strong> {{funds_manager_name}}</p>
<p><strong>Contact Email</strong> {{funds_manager_email}} &nbsp; <strong>Contact Number</strong> {{funds_manager_phone}}</p>
<p><strong>Your Experience with {{practice_name}}</strong></p>
<ul>
<li>We&rsquo;ll only offer services approved by the NDIA.</li>
<li>You&rsquo;ll be an active decision maker about your services; your preferences matter to us.</li>
<li>We welcome you to include any others in your session if it&rsquo;s important to you.</li>
<li>We&rsquo;ll keep you in the loop about any changes, like a switch in therapist.</li>
<li>Your privacy matters: we seek your consent before sharing any information with a third party.</li>
<li>Your comfort and preferences matter to us. We strive to accommodate any access or cultural preferences you may have, such as language preferences.</li>
<li>Expect nothing less than politeness and respect in every interaction.</li>
<li>Your feedback is crucial; we&rsquo;re here to listen and support, whether positive or a complaint. It guides our continuous improvement to better improve your needs.</li>
<li>We keep detailed clinical notes about your therapy.</li>
<li>Travel costs will be calculated and charged according to the details in this agreement, and if there are any changes to pricing, we will always notify you before applying them.</li>
<li>We&rsquo;re sticklers for rules and laws.</li>
<li>We will respond to any incidents that have been reported to us within 48 hours.</li>
</ul>
<p><strong>Our Commitment to Continuous Support</strong></p>
<p>Ensuring your journey with us stays smooth is a top priority at {{practice_name}}. We&rsquo;re committed to providing consistent services, as we believe it&rsquo;s the key to reaching your goals. However, we understand that life can bring unexpected changes, such as a therapist&rsquo;s departure, illness, or unforeseen events like government restrictions or natural disasters.</p>
<p>If we anticipate any potential bumps in the road that might affect your services, our team will get in touch. Together, we can explore a few options based on your therapy plan:</p>
<ul>
<li>Shifting your appointment to a time that suits you better.</li>
<li>Changing the location of your session to slot you in with another fantastic therapist.</li>
<li>Adapting from a face-to-face session to teletherapy, as long as it&rsquo;s suitable for you and your therapist.</li>
</ul>
<p>To make sure everyone&rsquo;s on the same page, our practitioners keep detailed clinical notes that are shared within the team and accessible whenever you need them. We&rsquo;re here for you, come what may!</p>
<p><strong>Partnering for Better Support</strong></p>
<p>As a valued member of our community, your active collaboration is key to making everything run smoothly. Here&rsquo;s what we ask of you:</p>
<ul>
<li>Keep us in the loop if there are any changes to your NDIS plan or if you decide to step back from using the NDIS.</li>
<li>Let us know before arranging the same therapy services with another organisation.</li>
<li>Keep an eye on your NDIS therapy funds, and if there&rsquo;s a change from what we&rsquo;ve agreed here, let us know quickly.</li>
<li>Let us know if there are no funds available anymore.</li>
<li>Keep everyone safe! If there&rsquo;s anything that might pose a risk for our therapist during their visit, please let us know.</li>
<li>If there&rsquo;s an incident that occurs involving one of our services or if there&rsquo;s anything about our service that doesn&rsquo;t sit right with you, please tell us. Your feedback matters!</li>
<li>Just a gentle reminder to keep things polite and respectful in all our interactions.</li>
</ul>
<p>Thanks for your cooperation.</p>
<p><strong>Appointment Cancellations</strong></p>
<p>If you need to cancel an appointment, tell us at least two business days ahead (not counting weekends or public holidays), and you won&rsquo;t be charged a cancellation fee.</p>
<p>Late cancellations will incur a fee of the appointment duration if the therapist has not travelled to the appointment. Late cancellations for the appointment and travel will be charged if the therapist has arrived at the location and the service is cancelled.</p>
<p>We will notify you if we have charged for cancellation and discuss ways to minimise future cancellations. If you have any questions, contact {{practice_name}} on {{practice_phone}}.</p>
<p><strong>Making Changes to Your Service Agreement</strong></p>
<p>Please remember, you have the flexibility to adjust the hours allocated to your services in this agreement.</p>
<p>If you&rsquo;re thinking of making a change, please discuss with your therapist. They&rsquo;ll help you make the adjustments and record these changes on your file, keeping everything on the same page for you and your team.</p>
<p>By signing below, we&rsquo;re on the same page and agreeing to what&rsquo;s laid out in this document.</p>
<p>Please tick if yes:</p>
<p>&#9744; I&rsquo;ve understood and accepted the terms and conditions in this service agreement.</p>
<p>&#9744; I&rsquo;ve agreed to the collection, storage and sharing of my personal info.</p>
<p><strong>Name</strong> {{client_name}}</p>
<p><strong>Signature</strong> ____________________________________________________________</p>
<p><strong>Date</strong> {{date}}</p>
<p><strong>{{practice_name}} Representative</strong></p>
<p><strong>Name</strong> {{practitioner_name}}</p>
<p><strong>Signature</strong> ____________________________________________________________</p>
<p><strong>Date</strong> {{date}}</p>
<p><strong>Contact Us</strong></p>
<p>We&rsquo;re here to help. Call us on {{practice_phone}} with any questions about this agreement.</p>
`.trim();

try {
  db.prepare(`
    INSERT OR IGNORE INTO templates (type, code, name, subject, body, is_system, has_pricing_table)
    VALUES ('agreement', 'service_agreement', 'Service Agreement', NULL, ?, 1, 1)
  `).run(SERVICE_AGREEMENT_BODY);
} catch {}

// One-time content upgrade for installs that already seeded the original placeholder body
// (guarded on an exact match so a practitioner's own edits are never overwritten).
try {
  db.prepare(`UPDATE templates SET body = ? WHERE code = 'service_agreement' AND body = ?`)
    .run(SERVICE_AGREEMENT_BODY, SERVICE_AGREEMENT_PLACEHOLDER_BODY);
} catch {}

// Form templates & responses — a buildable form module (sections of fields a practitioner
// assembles from a palette), modelled after the Splose form builder. Three fill contexts share
// these two tables:
//   1. In-app: practitioner fills a form against an existing client during a session
//      (client_id set at creation, no token needed).
//   2. Prefill link: sent to an existing client to fill in before their appointment
//      (client_id set, token generated) — same public-token trust model as
//      agreements.signing_token / the cal feed token.
//   3. Referral intake: a blank form sent to an external referrer with no client attached yet
//      (client_id NULL until a staff member reviews the submission and accepts it into a new
//      or existing client). The review/accept flow itself is NOT built yet, but client_id is
//      nullable and status already has 'accepted'/'declined' so it can be added later without
//      a schema change.
//
// schema_json on form_templates shapes as { sections: [{ id, title, fields: [...] }] }.
// Each field is { id, kind: 'smart'|'custom', type, label, required, options?, binding? }.
//   - kind:'custom' fields (statement, short_answer, paragraph, checkboxes, dropdown,
//     multiple_choice, page_break, file_upload) are pure content — their answers only ever
//     live in form_responses.answers_json.
//   - kind:'smart' fields carry a `binding` (e.g. 'client.first_name',
//     'funding_period.client_identifier', 'funding_period.ndis_management',
//     'funding_period.funding_type') naming the real column they're destined to write on
//     accept — not enforced by the DB, just the contract the (not-yet-built) accept step will
//     read. A 'funding_period.*' binding implies accept must create/update a funding_periods
//     row, not just the client row — this is why NDIS number/fund management aren't generic
//     text fields: this practice's funding model isn't NDIS-only, so "fund management" only
//     makes sense in the context of a specific funding_type that has_ndis_management=1.
// answers_json on form_responses is { [fieldId]: value }.
try { db.exec(`
  CREATE TABLE IF NOT EXISTS form_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    schema_json TEXT NOT NULL DEFAULT '{"sections":[]}',
    active INTEGER DEFAULT 1,
    created_by INTEGER REFERENCES practitioners(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`); } catch {}

try { db.exec(`
  CREATE TABLE IF NOT EXISTS form_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    form_template_id INTEGER NOT NULL REFERENCES form_templates(id),
    client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    token TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'draft',
    answers_json TEXT NOT NULL DEFAULT '{}',
    created_by INTEGER REFERENCES practitioners(id),
    sent_at DATETIME,
    viewed_at DATETIME,
    submitted_at DATETIME,
    accepted_at DATETIME,
    accepted_by INTEGER REFERENCES practitioners(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`); } catch {}
try { db.exec(`CREATE INDEX idx_form_responses_template ON form_responses(form_template_id)`); } catch {}
try { db.exec(`CREATE INDEX idx_form_responses_client ON form_responses(client_id)`); } catch {}
try { db.exec(`CREATE UNIQUE INDEX idx_form_responses_token ON form_responses(token) WHERE token IS NOT NULL`); } catch {}

// Per-funding-type form behaviour — lets the "Funding details" composite form field (see
// formFieldTypes.js on the client) show the right sub-fields for whichever funder is selected:
// identifier_label customizes what funding_periods.client_identifier is called (e.g. "NDIS
// number" vs "Medicare number" vs generic "Client ID"), show_period_dates controls whether
// Start/End date inputs appear for that type. Both default sensibly and are edited in
// Settings → Services & Rates → Funding Types (Services.jsx's FundingTypesTab).
try { db.exec(`ALTER TABLE funding_types ADD COLUMN identifier_label TEXT`); } catch {}
try { db.exec(`ALTER TABLE funding_types ADD COLUMN show_period_dates INTEGER DEFAULT 1`); } catch {}
try {
  const defaultLabels = { NDIS: 'NDIS number', Medicare: 'Medicare number' };
  const unlabeled = db.prepare('SELECT id, name FROM funding_types WHERE identifier_label IS NULL').all();
  const setLabel = db.prepare('UPDATE funding_types SET identifier_label = ? WHERE id = ?');
  for (const ft of unlabeled) setLabel.run(defaultLabels[ft.name] || 'Client ID', ft.id);
} catch {}

// Pending/tentative appointments — a slot held on the calendar (blocks double-booking, same as
// any non-cancelled status already does) while awaiting the client's confirmation, before it's
// flipped to 'scheduled'. appointments.status is free-text so no column change was needed there
// — 'pending' is just a new value. recurring_series.pending remembers that a whole series was
// booked tentatively, so generateForSeries() keeps stamping new occurrences 'pending' until the
// series itself is confirmed (see recurringSeries.js), at which point both this flag and every
// existing pending occurrence flip over together.
try { db.exec(`ALTER TABLE recurring_series ADD COLUMN pending INTEGER DEFAULT 0`); } catch {}

// Billing overrides — lets finance/owner/admin (the `invoices` permission) bill a line item as
// different hours/rate than what the practitioner actually booked, e.g. folding an inconsistent
// travel-time charge into a single billable unit for funders that require whole-unit billing.
// NULL means "no override, use quantity/unit_rate as booked" — only the session line is affected;
// travel/km/notes lines always use the raw booked values (see invoices.js's /generate route).
// billed_by/billed_at exist purely for the "Adjusted by X on Y" transparency note shown in
// AppointmentModal — not used in any billing calculation.
// IMPORTANT: appointments.js's PATCH /:id replaces appointment_items wholesale (delete+reinsert)
// whenever any item field changes, since items have no stable identity across edits. That route
// must re-apply an existing override onto the new row when it can confirm the same service_id —
// dropping it otherwise — or a routine unrelated edit would silently destroy a finance override.
try { db.exec(`ALTER TABLE appointment_items ADD COLUMN billed_quantity REAL`); } catch {}
try { db.exec(`ALTER TABLE appointment_items ADD COLUMN billed_unit_rate REAL`); } catch {}
try { db.exec(`ALTER TABLE appointment_items ADD COLUMN billed_by INTEGER REFERENCES practitioners(id)`); } catch {}
try { db.exec(`ALTER TABLE appointment_items ADD COLUMN billed_at DATETIME`); } catch {}

// MYOB reconciliation (manual CSV/Excel import until an API integration exists — see
// server/routes/myobSync.js). myob_invoice_number is set once by importing MYOB's TBSALE.csv
// (matched back to this appointment by client + service date + line-amount total); it's the
// join key for later, recurring imports of MYOB's invoice-status export, which set the rest.
// One invoice number can cover multiple appointments (e.g. several visits batched onto one
// invoice) — in that case every covered appointment carries the same invoice number and status.
try { db.exec(`ALTER TABLE appointments ADD COLUMN myob_invoice_number TEXT`); } catch {}
try { db.exec(`ALTER TABLE appointments ADD COLUMN myob_status TEXT`); } catch {}
try { db.exec(`ALTER TABLE appointments ADD COLUMN myob_amount_due REAL`); } catch {}
try { db.exec(`ALTER TABLE appointments ADD COLUMN myob_status_synced_at DATETIME`); } catch {}

// Separate travel/notes rate overrides — distinct from billed_quantity/billed_unit_rate above,
// which only ever affects the session line. A finance override to the session rate must NOT
// silently change what travel/km/notes bill at (they already never did, since those lines read
// travel_rate_per_hour/notes_rate with a fallback to the item's own raw unit_rate — never
// billed_unit_rate — but there was previously no way to deliberately override travel/notes
// pricing independently of the session). NULL means "use the normal rate resolution", same
// convention as billed_quantity/billed_unit_rate.
try { db.exec(`ALTER TABLE appointment_items ADD COLUMN billed_travel_rate REAL`); } catch {}
try { db.exec(`ALTER TABLE appointment_items ADD COLUMN billed_notes_rate REAL`); } catch {}
try { db.exec(`ALTER TABLE appointment_items ADD COLUMN billed_km_rate REAL`); } catch {}

module.exports = db;
