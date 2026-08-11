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
app.use('/api/sign',            require('./routes/signAgreement'));

// All routes below require authentication
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth') || req.path.startsWith('/cal') || req.path.startsWith('/sign') || req.path === '/health') return next();
  auth(req, res, next);
});

app.use('/api/settings',        perm('settings'), require('./routes/settings'));
app.use('/api/practitioners',   require('./routes/practitioners')); // perm applied per-route inside
app.use('/api/clients',         perm('clients'), require('./routes/clients'));
app.use('/api/services',        perm('services'), require('./routes/services'));
app.use('/api/appointments',    require('./routes/appointments')); // perm applied per-route inside
app.use('/api/invoices',        perm('invoices'), require('./routes/invoices'));
app.use('/api/funds-managers',  perm('funds_managers'), require('./routes/fundsManagers'));
app.use('/api/locations',       require('./routes/locations')); // perm applied per-route inside
app.use('/api/session-notes',   perm('clients'), require('./routes/sessionNotes'));
app.use('/api/session-note-files', perm('clients'), require('./routes/sessionNoteFiles'));
app.use('/api/funding-periods', require('./routes/fundingPeriods')); // perm applied per-route inside
app.use('/api/client-files',    perm('clients'), require('./routes/clientFiles'));
app.use('/api/client-file-folders', perm('clients'), require('./routes/clientFileFolders'));
app.use('/api/recurring-series', perm('calendar'), require('./routes/recurringSeries'));
app.use('/api/disciplines',     perm('services'), require('./routes/disciplines'));
app.use('/api/push',            require('./routes/push'));
app.use('/api/audit-logs',      require('./routes/auditLogs'));
app.use('/api/gst-rates',       perm('settings'), require('./routes/gstRates'));
app.use('/api/funding-types',   perm('services'), require('./routes/fundingTypes'));
app.use('/api/templates',        perm('settings'), require('./routes/templates'));
app.use('/api/form-templates',  perm('settings'), require('./routes/formTemplates'));
app.use('/api/form-responses',  perm('clients'), require('./routes/formResponses'));
app.use('/api/agreements',      perm('clients'), require('./routes/agreements'));
app.use('/api/reports',         perm('reports'), require('./routes/reports'));

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
  // Daily scheduler: recurring appointments + invoice reminders + agreement signing reminders
  const { generateAll } = require('./routes/recurringSeries');
  const { sendOverdueReminders } = require('./routes/invoices');
  const { sendAgreementReminders } = require('./routes/agreements');
  const runDaily = async () => {
    try { generateAll(); } catch (e) { console.error('Recurring generation error:', e.message); }
    try { await sendOverdueReminders(); } catch (e) { console.error('Invoice reminder error:', e.message); }
    try { await sendAgreementReminders(); } catch (e) { console.error('Agreement reminder error:', e.message); }
  };
  runDaily();
  setInterval(runDaily, 24 * 60 * 60 * 1000);
});
