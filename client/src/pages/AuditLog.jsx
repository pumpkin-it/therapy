import { useState, useEffect } from 'react';
import api from '../lib/api';
import Button from '../components/ui/Button';
import { fmtDateTime, localToday } from '../lib/utils';
import { useSettings } from '../context/SettingsContext';

const TYPE_STYLE = {
  client:      'bg-blue-50 text-blue-700',
  user:        'bg-purple-50 text-purple-700',
  appointment: 'bg-green-50 text-green-700',
  invoice:     'bg-amber-50 text-amber-700',
  service:     'bg-gray-100 text-gray-600',
  series:      'bg-indigo-50 text-indigo-700',
};

const ACTION_STYLE = {
  created:        'text-green-700',
  updated:        'text-blue-700',
  voided:         'text-red-600',
  cancelled:      'text-red-500',
  deactivated:    'text-red-500',
  reactivated:    'text-green-600',
  sent:           'text-indigo-600',
  paid:           'text-green-700',
  status_changed: 'text-amber-600',
  login:          'text-green-700',
  login_failed:   'text-red-600',
};

const ON_NOW_MINUTES = 5;
const PAGE_NAMES = [
  [/^\/calendar/, 'Calendar'], [/^\/appointments/, 'Appointment'], [/^\/clients\/?$/, 'Clients list'], [/^\/email/, 'Email'],
  [/^\/tasks/, 'Tasks'], [/^\/invoices/, 'Invoices'], [/^\/reports/, 'Reports'], [/^\/audit-log/, 'Audit Log'],
  [/^\/ask/, 'Ask'], [/^\/settings/, 'Settings'], [/^\/templates/, 'Templates'],
];
const pageName = row => {
  if (row.client_id) return row.client_name || `Client ${row.client_id}`;
  return PAGE_NAMES.find(([re]) => re.test(row.page || ''))?.[1] || row.page || '—';
};

// Who was signed in and active on a chosen day. Changes they made are in the log below.
function WhosOn({ timezone }) {
  const [date, setDate] = useState(localToday());
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const [minutes, setMinutes] = useState([]);
  const period = () => {
    const from = new Date(`${date}T00:00:00`);
    const to = new Date(from); to.setDate(to.getDate() + 1);
    return { from: from.toISOString(), to: to.toISOString() };
  };
  const stamp = m => fmtDateTime(`${m.replace(' ', 'T')}:00`, timezone);
  useEffect(() => {
    setOpen(null); setRows(null);
    api.get('/audit-logs/activity', { params: period() }).then(r => setRows(r.data)).catch(() => setRows([]));
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = async id => {
    if (open === id) { setOpen(null); return; }
    setOpen(id); setMinutes([]);
    setMinutes((await api.get(`/audit-logs/activity/${id}`, { params: period() })).data);
  };
  const onNow = r => Date.now() - new Date(`${r.last_minute.replace(' ', 'T')}:00Z`).getTime() < ON_NOW_MINUTES * 60 * 1000;

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-800">Who's on</h2>
        <input type="date" value={date} max={localToday()} onChange={e => e.target.value && setDate(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1 text-sm text-gray-700" />
      </div>
      {rows === null ? <p className="px-4 py-6 text-center text-sm text-gray-400">Loading…</p>
        : rows.length === 0 ? <p className="px-4 py-6 text-center text-sm text-gray-400">Nobody active on this day.</p>
        : <div className="divide-y divide-gray-50">{rows.map(r => (
          <div key={r.user_id}>
            <button type="button" onClick={() => toggle(r.user_id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-left text-sm hover:bg-gray-50">
              <span className="font-medium text-gray-800">{r.user_name || `User ${r.user_id}`}</span>
              {onNow(r) ? <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">Active now</span>
                : <span className="text-xs text-gray-500">Last active {stamp(r.last_minute)}</span>}
              <span className="text-xs text-gray-500">First {stamp(r.first_minute)} · {r.active_minutes} active min · {r.writes} change{r.writes === 1 ? '' : 's'}</span>
              <span className="ml-auto text-xs text-gray-400">{(r.ips || '').split(',').join(', ')}</span>
            </button>
            {open === r.user_id && (
              <div className="max-h-64 overflow-y-auto bg-gray-50 px-4 py-2">
                {minutes.map(m => (
                  <p key={m.minute} className="flex gap-3 py-0.5 text-xs text-gray-600">
                    <span className="w-40 shrink-0 text-gray-500">{stamp(m.minute)}</span>
                    <span className="min-w-0 flex-1 truncate">{pageName(m)}{m.writes > 0 ? ` · ${m.writes} change${m.writes === 1 ? '' : 's'}` : ''}</span>
                    <span className="shrink-0 text-gray-400">{m.ip}</span>
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}</div>}
    </div>
  );
}

export default function AuditLog() {
  const { timezone } = useSettings();
  const [logs, setLogs] = useState([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [expanded, setExpanded] = useState(null);

  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  // Newest 200 first; "Load older" appends the next 200.
  const PAGE = 200;
  const fetchPage = offset => {
    const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (typeFilter) params.set('entity_type', typeFilter);
    return api.get(`/audit-logs?${params}`).then(r => { setHasOlder(r.data.length === PAGE); return r.data; });
  };
  const load = () => fetchPage(0).then(setLogs);
  const loadOlder = () => {
    setLoadingOlder(true);
    fetchPage(logs.length).then(rows => setLogs(l => [...l, ...rows])).finally(() => setLoadingOlder(false));
  };
  useEffect(() => { load(); }, [typeFilter]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Audit Log</h1>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700">
          <option value="">All types</option>
          <option value="client">Clients</option>
          <option value="user">Users</option>
          <option value="appointment">Appointments</option>
          <option value="invoice">Invoices</option>
          <option value="service">Services</option>
          <option value="series">Recurring Series</option>
          <option value="agreement">Agreements</option>
          <option value="billable_report">Reports</option>
          <option value="client_file">Client files</option>
          <option value="client_file_folder">Client file folders</option>
          <option value="session_note_file">Session note files</option>
          <option value="budget">Budgets</option>
          <option value="time_block">Time blocks</option>
          <option value="report_template">Report templates</option>
          <option value="settings">Settings</option>
        </select>
      </div>

      <WhosOn timezone={timezone} />

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="divide-y divide-gray-50 max-h-[75vh] overflow-y-auto">
          {logs.length === 0 ? (
            <p className="px-4 py-12 text-center text-gray-400">No audit logs yet.</p>
          ) : logs.map(log => (
            <div key={log.id} className="px-4 py-3 hover:bg-gray-50">
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 shrink-0 text-xs font-medium rounded-full px-2 py-0.5 ${TYPE_STYLE[log.entity_type] || 'bg-gray-100 text-gray-600'}`}>
                  {log.entity_type}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium ${ACTION_STYLE[log.action] || 'text-gray-600'}`}>{log.action}</span>
                    {log.entity_ref && <span className="text-xs font-mono text-gray-400">{log.entity_ref}</span>}
                  </div>
                  <p className="text-sm text-gray-700 mt-0.5">{log.details}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{fmtDateTime(log.created_at, timezone)}{log.user_name && ` · by ${log.user_name}`}</p>
                  {log.snapshot && (
                    <button onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                      className="text-xs text-indigo-500 hover:underline mt-1">
                      {expanded === log.id ? 'Hide snapshot' : 'View snapshot'}
                    </button>
                  )}
                  {expanded === log.id && log.snapshot && (
                    <pre className="mt-2 text-xs bg-gray-50 border border-gray-200 rounded p-2 overflow-x-auto max-h-48 text-gray-600">
                      {JSON.stringify(JSON.parse(log.snapshot), null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {hasOlder && (
        <div className="flex justify-center">
          <Button variant="secondary" size="sm" onClick={loadOlder} disabled={loadingOlder}>
            {loadingOlder ? 'Loading…' : `Load older (showing ${logs.length.toLocaleString()})`}
          </Button>
        </div>
      )}
    </div>
  );
}
