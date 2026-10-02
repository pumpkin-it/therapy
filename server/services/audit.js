const db = require('../database');
const { currentUserId } = require('../lib/requestContext');

const insert = db.prepare(`
  INSERT INTO audit_logs (entity_type, entity_id, entity_ref, action, details, snapshot, user_id)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

function log(entityType, entityId, action, details, { ref, snapshot } = {}) {
  // The signed-in person making the change; none for automatic jobs and public links.
  insert.run(entityType, entityId || null, ref || null, action, details || null, snapshot ? JSON.stringify(snapshot) : null, currentUserId());
}

function diff(oldObj, newObj, fields) {
  const changes = [];
  for (const f of fields) {
    const o = oldObj[f] ?? '';
    const n = newObj[f] ?? '';
    if (String(o) !== String(n)) changes.push(`${f}: "${o}" → "${n}"`);
  }
  return changes.length ? changes.join('; ') : null;
}

module.exports = { log, diff };
