const db = require('../database');

let cachedPermissions = null;

function getPermissions() {
  if (cachedPermissions) return cachedPermissions;
  const row = db.prepare("SELECT value FROM settings WHERE key='role_permissions'").get();
  try { cachedPermissions = JSON.parse(row?.value || '{}'); } catch { cachedPermissions = {}; }
  setTimeout(() => { cachedPermissions = null; }, 60000);
  return cachedPermissions;
}

module.exports = function requirePermission(permission) {
  return (req, res, next) => {
    const role = req.user?.role;
    if (!role) return res.status(403).json({ error: 'Forbidden' });
    const perms = getPermissions()[role];
    if (!perms || !perms[permission]) {
      return res.status(403).json({ error: 'You do not have permission to access this resource' });
    }
    next();
  };
};
