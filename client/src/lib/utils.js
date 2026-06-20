export const currency = v =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v);

export const fmtDate = d =>
  new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

export const fmtTime = d =>
  new Date(d).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });

export const cn = (...classes) => classes.filter(Boolean).join(' ');

export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
