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

// Seed default settings
const defaults = {
  practice_name: 'My Therapy Practice',
  practice_email: '',
  practice_phone: '',
  practice_address: '',
  practice_abn: '',
  smtp_host: '',
  smtp_port: '587',
  smtp_secure: '0',
  smtp_user: '',
  smtp_pass: '',
  smtp_from_name: '',
  smtp_from_email: '',
  invoice_counter: '1',
  tax_rate: '0.1',
};

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(defaults)) {
  insertSetting.run(key, value);
}

// Seed default admin user
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (userCount === 0) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')")
    .run('Administrator', 'admin@practice.com', hash);
  console.log('Default admin created: admin@practice.com / admin123');
}

module.exports = db;
