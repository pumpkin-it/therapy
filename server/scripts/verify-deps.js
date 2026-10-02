// Guards against a real failure mode seen 2026-09-01: `npm install --production`
// on the deploy target sometimes reports "up to date" without actually installing
// a dependency newly added to package.json (root cause unconfirmed — possibly an
// mtime/lockfile-cache quirk after tar extraction). That leaves the server
// crash-looping on MODULE_NOT_FOUND with no clear signal in the deploy output.
// Run this right after npm install; a non-zero exit fails the deploy loudly
// instead of restarting into a broken service.
//
// A second failure mode (2026-10-02): npm left a package half-extracted (TAR_ENTRY_ERROR),
// so its folder existed but a file inside it was missing and the server crash-looped on
// "Cannot find module './certificates.js'". So each dependency is also loaded; a package
// that fails because of a file missing inside it is deleted, and the exit is non-zero, so
// the deploy's retry (`npm install --force`, then this check again) installs it afresh.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const deps = Object.keys(pkg.dependencies || {});
const missing = deps.filter(dep => !fs.existsSync(path.join(root, 'node_modules', dep)));

// The node_modules package folder a file path belongs to (handles @scope/name and nesting).
function packageDirOf(file) {
  const parts = file.split(path.sep);
  const i = parts.lastIndexOf('node_modules');
  if (i < 0) return null;
  const name = parts[i + 1]?.startsWith('@') ? parts.slice(i + 1, i + 3) : parts.slice(i + 1, i + 2);
  return parts.slice(0, i + 1).concat(name).join(path.sep);
}

const broken = [];
for (const dep of deps.filter(d => !missing.includes(d))) {
  try {
    require(path.join(root, 'node_modules', dep));
  } catch (e) {
    // Packages with no CommonJS entry (ES modules, font/CSS packages) can't be require()d;
    // that's expected. Only a file missing *inside* an installed package means it's broken.
    if (e.code !== 'MODULE_NOT_FOUND' || !e.requireStack?.length) continue;
    const dir = packageDirOf(e.requireStack[0]);
    if (!dir) continue;
    broken.push(`${dep} (${path.relative(root, dir)}: ${e.message.split('\n')[0]})`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (missing.length || broken.length) {
  if (missing.length) console.error('DEPENDENCY CHECK FAILED — missing after npm install: ' + missing.join(', '));
  if (broken.length) console.error('DEPENDENCY CHECK FAILED — incomplete install, removed for reinstall: ' + broken.join('; '));
  process.exit(1);
}
console.log('Dependency check OK — all ' + deps.length + ' dependencies present and loading.');
