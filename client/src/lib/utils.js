export const currency = v =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v);

export const fmtDate = d =>
  new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

export const fmtTime = d =>
  new Date(d).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });

// For UTC timestamps from the database (created_at, audit logs) — converts to the practice timezone
export const fmtDateTime = (utcStr, tz = 'Australia/Sydney') => {
  if (!utcStr) return '';
  const d = new Date(utcStr.endsWith('Z') ? utcStr : utcStr + 'Z');
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: tz,
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d);
};

export const fmtDateOnly = (utcStr, tz = 'Australia/Sydney') => {
  if (!utcStr) return '';
  const d = new Date(utcStr.endsWith('Z') ? utcStr : utcStr + 'Z');
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: tz,
    day: 'numeric', month: 'short', year: 'numeric',
  }).format(d);
};

export const cn = (...classes) => classes.filter(Boolean).join(' ');

export const substituteVars = (text, vars) => {
  if (!text) return '';
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] !== undefined ? vars[k] : `{{${k}}}`);
};

export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
