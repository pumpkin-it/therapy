process.env.TZ = 'Australia/Sydney';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Initialise DB on startup
require('./database');

const auth = require('./middleware/auth');
const perm = require('./middleware/requirePermission');

app.use('/api/cal',             require('./routes/calendarFeed'));
app.use('/api/auth',            require('./routes/auth'));

// All routes below require authentication
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth') || req.path === '/health') return next();
  auth(req, res, next);
});

app.use('/api/settings',        perm('settings'), require('./routes/settings'));
app.use('/api/practitioners',   perm('users'), require('./routes/practitioners'));
app.use('/api/clients',         perm('clients'), require('./routes/clients'));
app.use('/api/services',        perm('services'), require('./routes/services'));
app.use('/api/appointments',    perm('calendar'), require('./routes/appointments'));
app.use('/api/invoices',        perm('invoices'), require('./routes/invoices'));
app.use('/api/funds-managers',  perm('funds_managers'), require('./routes/fundsManagers'));
app.use('/api/locations',       perm('locations'), require('./routes/locations'));
app.use('/api/case-notes',      perm('clients'), require('./routes/caseNotes'));
app.use('/api/funding-periods', perm('clients'), require('./routes/fundingPeriods'));
app.use('/api/client-files',    perm('clients'), require('./routes/clientFiles'));
app.use('/api/recurring-series', perm('calendar'), require('./routes/recurringSeries'));
app.use('/api/disciplines',     perm('services'), require('./routes/disciplines'));
app.use('/api/push',            require('./routes/push'));
app.use('/api/audit-logs',      require('./routes/auditLogs'));
app.use('/api/gst-rates',       perm('settings'), require('./routes/gstRates'));
app.use('/api/funding-types',   perm('settings'), require('./routes/fundingTypes'));

// Logo is public; all other uploads require auth
app.get('/uploads/logo', (req, res) => {
  const logoPath = path.join(__dirname, '../uploads/logo');
  if (!fs.existsSync(logoPath)) return res.status(404).end();
  res.sendFile(logoPath);
});
app.use('/uploads', require('./middleware/auth'), (req, res, next) => {
  express.static(path.join(__dirname, '../uploads'))(req, res, next);
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// Global error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

app.listen(PORT, () => {
  console.log(`Therapy API running on :${PORT}`);
  // Daily scheduler: recurring appointments + invoice reminders
  const { generateAll } = require('./routes/recurringSeries');
  const { sendOverdueReminders } = require('./routes/invoices');
  const runDaily = async () => {
    try { generateAll(); } catch (e) { console.error('Recurring generation error:', e.message); }
    try { await sendOverdueReminders(); } catch (e) { console.error('Invoice reminder error:', e.message); }
  };
  runDaily();
  setInterval(runDaily, 24 * 60 * 60 * 1000);
});
