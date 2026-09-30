import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import api from './api';

// Overdue report invoices (server/lib/overdueReports.js) — { days, groups, all }, or null while
// loading or when this user can't see them. Re-checked on every page change, so marking an
// invoice paid clears the sidebar badge and the Calendar banner without a reload.
export default function useOverdueReports(enabled = true) {
  const location = useLocation();
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    api.get('/billable-reports/overdue').then(r => { if (live) setData(r.data); }).catch(() => { if (live) setData(null); });
    return () => { live = false; };
  }, [enabled, location.pathname, location.search]);
  return data;
}
