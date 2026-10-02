import { useState, useEffect } from 'react';
import api from '../lib/api';
import Button from '../components/ui/Button';
import { fmtDateTime } from '../lib/utils';
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
};

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
