import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import useOverdueReports from '../lib/useOverdueReports';
import { useAuth } from '../context/AuthContext';
import { currency, fmtDate, invoiceLabel } from '../lib/utils';

// Top of the Calendar, so it's the first thing anyone sees after signing in: report invoices
// still not paid N days (Settings, default 14) after the entry date. Therapists see the reports
// they write — they're best placed to chase the client; finance sees every one.
const STATUS_TEXT = {
  not_exported: 'not sent to MYOB yet',
  exported: 'sent to MYOB, no invoice number yet',
  unpaid: 'unpaid',
  part_paid: 'part paid',
};
const SHOWN = 5;

export default function OverdueReportsBanner() {
  const { user } = useAuth();
  const data = useOverdueReports(!!user?.permissions?.clients);
  const [open, setOpen] = useState(true);
  const [all, setAll] = useState(false);
  const groups = data?.groups || [];
  if (!groups.length) return null;

  const due = groups.reduce((s, g) => s + g.due, 0);
  const list = all ? groups : groups.slice(0, SHOWN);
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
      <div className="flex items-center gap-2">
        <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
        <span className="font-semibold">
          {groups.length} report invoice{groups.length === 1 ? '' : 's'} overdue
        </span>
        <span className="text-red-700">
          — {currency(due)} not paid {data.days}+ days after the report entry.{!data.all && ' Please follow up with the client.'}
        </span>
        <span className="ml-auto flex items-center gap-3">
          {data.all && <Link to="/invoices?tile=overdue_reports" className="font-medium text-red-700 hover:underline">Open in MYOB Invoices</Link>}
          <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1 text-red-700 hover:text-red-900">
            {open ? <>Hide <ChevronUp className="h-4 w-4" /></> : <>Show <ChevronDown className="h-4 w-4" /></>}
          </button>
        </span>
      </div>
      {open && (
        <ul className="mt-2 divide-y divide-red-100 border-t border-red-100">
          {list.map(g => (
            <li key={g.key} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5">
              <Link to={`/clients/${g.client_id}?tab=reports`} className="font-medium text-red-900 hover:underline">{g.client_name}</Link>
              <span className="text-red-800">{g.report_title}</span>
              {data.all && <span className="text-xs text-red-600">{g.practitioner_name}</span>}
              <span className="text-xs text-red-600">entry {fmtDate(g.entry_date)} · {g.days_since} days ago</span>
              <span className="ml-auto flex items-center gap-3 text-xs">
                <span className="font-mono text-red-800">{invoiceLabel(g.invoice_no)}</span>
                <span className="text-red-700">{STATUS_TEXT[g.status]}</span>
                <span className="font-semibold text-red-900">{currency(g.due)}{g.status === 'part_paid' ? ' due' : ''}</span>
              </span>
            </li>
          ))}
          {groups.length > SHOWN && (
            <li className="pt-1.5">
              <button onClick={() => setAll(a => !a)} className="text-xs font-medium text-red-700 hover:underline">
                {all ? 'Show fewer' : `Show all ${groups.length}`}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
