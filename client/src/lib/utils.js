export const currency = v =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v);

export const DEFAULT_TIMEZONE = 'Australia/Sydney';

export const TIMEZONES = [
  'Australia/Perth',
  'Australia/Darwin',
  'Australia/Adelaide',
  'Australia/Brisbane',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Hobart',
  'Pacific/Auckland',
  'UTC',
];

export const fmtDate = (d, tz = DEFAULT_TIMEZONE) =>
  new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: tz });

export const fmtTime = (d, tz = DEFAULT_TIMEZONE) =>
  new Date(d).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', timeZone: tz });

export const fmtDateFull = (d, tz = DEFAULT_TIMEZONE) =>
  new Date(d).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: tz });

export const fmtDateTime = (d, tz = DEFAULT_TIMEZONE) => {
  const date = new Date(d);
  const day = date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: tz });
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz });
  return `${day} ${time}`;
};

export const cn = (...classes) => classes.filter(Boolean).join(' ');

export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
