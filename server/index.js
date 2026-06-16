require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Initialise DB on startup
require('./database');

app.use('/api/auth',          require('./routes/auth'));
app.use('/api/settings',      require('./routes/settings'));
app.use('/api/practitioners', require('./routes/practitioners'));
app.use('/api/clients',       require('./routes/clients'));
app.use('/api/services',      require('./routes/services'));
app.use('/api/appointments',  require('./routes/appointments'));
app.use('/api/invoices',       require('./routes/invoices'));
app.use('/api/funds-managers', require('./routes/fundsManagers'));
app.use('/api/locations',      require('./routes/locations'));

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// Global error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

app.listen(PORT, () => console.log(`Therapy API running on :${PORT}`));
