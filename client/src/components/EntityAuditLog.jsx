import { useState, useEffect } from 'react';
import { FileText } from 'lucide-react';
import api from '../lib/api';
import { fmtDateTime } from '../lib/utils';
import { useSettings } from '../context/SettingsContext';

// Generic per-entity change history — same pattern as AppointmentAuditLog in
// AppointmentModal.jsx, parameterized so it can be reused for any entity_type already
// written to the audit_logs table (client, agreement, etc.) without duplicating the component.
export default function EntityAuditLog({ entityType, entityId, actionColors = {}, title = 'Change History', defaultOpen = false }) {
  const { timezone } = useSettings();
  const [logs, setLogs] = useState([]);
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (open && entityId) api.get(`/audit-logs?entity_type=${entityType}&entity_id=${entityId}`).then(r => setLogs(r.data));
  }, [open, entityType, entityId]);

  return (
    <div className="space-y-2">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-indigo-600">
        <FileText className="h-4 w-4 text-gray-400" /> {title} {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {logs.length === 0 ? (
            <p className="text-xs text-gray-400 py-2">No history recorded.</p>
          ) : logs.map(log => (
            <div key={log.id} className="text-xs border-l-2 border-gray-200 pl-2 py-1">
              <span className={`font-medium ${actionColors[log.action] || 'text-gray-600'}`}>{log.action.replace(/_/g, ' ')}</span>
              <span className="text-gray-400 ml-1.5">{fmtDateTime(log.created_at, timezone)}</span>
              <p className="text-gray-600 mt-0.5">{log.details}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
