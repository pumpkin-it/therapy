export const TASK_STATUSES = [['todo', 'To do'], ['waiting', 'Waiting'], ['done', 'Done']];
export const statusLabel = s => (TASK_STATUSES.find(x => x[0] === s) || [null, s])[1];
export const STATUS_PILL = {
  todo: 'bg-amber-100 text-amber-800',
  waiting: 'bg-sky-100 text-sky-800',
  done: 'bg-green-100 text-green-800',
};

const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// n working days from today (weekends skipped) — the usual follow-up date.
export function addWorkingDays(n = 3, from = new Date()) {
  const d = new Date(from);
  let added = 0;
  while (added < n) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) added++; }
  return ymd(d);
}
export const fmtDay = s => (s ? new Date(`${s}T12:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : '');
export const isOverdue = s => !!s && s <= ymd(new Date());
