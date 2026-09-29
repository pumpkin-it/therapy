#!/usr/bin/env node
// Create or remove the throwaway QA account used by the regression checklist
// (.claude/regression-checklist.md). Run it on the server that hosts the database
// (from the server/ directory, so it opens the same pm.db the app uses).
//
//   QA_PASSWORD='choose-a-password' node scripts/qa-account.js create
//   node scripts/qa-account.js delete
//
// The account is an "owner" (full rights). The password is read from the QA_PASSWORD
// environment variable and is never stored anywhere but as a bcrypt hash in the database.
// Only accounts whose email starts with "qa-" can be created or deleted by this script, so
// it can never overwrite or remove a real practitioner.

const bcrypt = require('bcryptjs');
const db = require('../database');

const EMAIL = (process.env.QA_EMAIL || 'qa-regression@example.test').toLowerCase();
const [cmd] = process.argv.slice(2);

if (!EMAIL.startsWith('qa-')) {
  console.error(`Refusing to run: QA_EMAIL must start with "qa-" (got "${EMAIL}").`);
  process.exit(1);
}

const existing = db.prepare('SELECT id, role FROM practitioners WHERE LOWER(email) = ?').get(EMAIL);

if (cmd === 'create') {
  const password = process.env.QA_PASSWORD;
  if (!password || password.length < 10) {
    console.error('Set QA_PASSWORD (at least 10 characters) in the environment, e.g.');
    console.error("  QA_PASSWORD='something-long' node scripts/qa-account.js create");
    process.exit(1);
  }
  const hash = bcrypt.hashSync(password, 10);
  if (existing) {
    db.prepare('UPDATE practitioners SET password_hash = ?, role = ?, active = 1 WHERE id = ?').run(hash, 'owner', existing.id);
    console.log(`Updated existing QA account #${existing.id} (${EMAIL}); password reset, role owner.`);
  } else {
    const r = db.prepare(
      "INSERT INTO practitioners (first_name, last_name, email, role, password_hash, color, active) VALUES ('QA', 'Regression', ?, 'owner', ?, '#e11d48', 1)"
    ).run(EMAIL, hash);
    console.log(`Created QA account #${r.lastInsertRowid}: ${EMAIL} (role owner).`);
  }
  console.log('Sign in with that email and the password you set. Delete it when the run is finished:');
  console.log('  node scripts/qa-account.js delete');
} else if (cmd === 'delete') {
  if (!existing) {
    console.log(`No QA account (${EMAIL}) found — nothing to delete.`);
  } else {
    db.prepare('DELETE FROM practitioners WHERE id = ?').run(existing.id);
    console.log(`Deleted QA account #${existing.id} (${EMAIL}).`);
    console.log('Reminder: also delete any clients, appointments and notes created during the run.');
  }
} else {
  console.error('Usage: node scripts/qa-account.js create|delete');
  process.exit(1);
}
