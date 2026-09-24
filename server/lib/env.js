// Server-side equivalent of client/src/lib/env.js's isUAT — same signal (the 'uat' substring in
// the deployment's own hostname), just read from APP_URL (set differently per-environment in
// each deployment's own .env, see Known Gotchas in project memory) since there's no
// window.location on the server.
const isUAT = (process.env.APP_URL || '').includes('uat');

module.exports = { isUAT };
