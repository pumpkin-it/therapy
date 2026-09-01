// Guards against a real failure mode seen 2026-09-01: `npm install --production`
// on the deploy target sometimes reports "up to date" without actually installing
// a dependency newly added to package.json (root cause unconfirmed — possibly an
// mtime/lockfile-cache quirk after tar extraction). That leaves the server
// crash-looping on MODULE_NOT_FOUND with no clear signal in the deploy output.
// Run this right after npm install; a non-zero exit fails the deploy loudly
// instead of restarting into a broken service.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const missing = Object.keys(pkg.dependencies || {})
  .filter(dep => !fs.existsSync(path.join(root, 'node_modules', dep)));

if (missing.length) {
  console.error('DEPENDENCY CHECK FAILED — missing after npm install: ' + missing.join(', '));
  process.exit(1);
}
console.log('Dependency check OK — all ' + Object.keys(pkg.dependencies || {}).length + ' dependencies present.');
