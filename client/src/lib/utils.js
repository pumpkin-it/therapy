export const currency = v =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v);

// Standard rounding convention for $ = qty * rate: round qty to 2dp first, then
// multiply — keeps every displayed total reconstructable as shown-qty * rate.
// Mirrors server/lib/billing.js's roundQty.
export const roundQty = qty => Number(Number(qty || 0).toFixed(2));

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

// Resolves the human-readable address for an appointment, mirroring the precedence used server-side
// in server/services/mailer.js's sendAppointmentNotification: clinic address, then an ad-hoc "Other"
// address, then the client's own home address.
export const resolveApptAddress = appt =>
  (appt.location_name && appt.location_address)
    ? appt.location_address
    : appt.location_other || appt.client_address || '';

// Google's AU-formatted addresses look like "12 Smith St, Richmond VIC 3121, Australia" —
// the suburb is the locality segment with the trailing state + postcode stripped off.
export const suburbFromAddress = address => {
  if (!address) return '';
  const parts = address.split(',').map(s => s.trim()).filter(Boolean);
  const localityPart = parts[1] || parts[0] || '';
  return localityPart.replace(/\s+[A-Z]{2,3}\s+\d{4}$/, '').trim();
};

// Downloads an auth-protected file via the authenticated api instance (window.open/<a href>
// can't send the Authorization header, so those approaches 401 on protected routes).
// Pass { method: 'post', data } when the request needs a body (e.g. a list of ids too long
// for a query string) instead of a plain GET.
export const downloadFile = async (api, url, filename, { method = 'get', data } = {}) => {
  const res = await api.request({ url, method, data, responseType: 'blob' });
  const blobUrl = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(blobUrl);
};
