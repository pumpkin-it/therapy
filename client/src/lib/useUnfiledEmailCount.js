import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import api from './api';

// How many emails are waiting to be filed — the number beside Email in the sidebar. Re-checked
// on every page change and once a minute, since new mail arrives on its own.
// (Also used for the Tasks number: pass the counts URL and which field.)
// Pages that change those numbers (filing, moving back to Unfiled) call refreshEmailCounts() so
// the sidebar doesn't wait for the next page change.
const EVENT = 'email-counts-changed';
export const refreshEmailCounts = () => window.dispatchEvent(new Event(EVENT));

export default function useUnfiledEmailCount(enabled = true, url = '/email/counts', field = 'unfiled') {
  const location = useLocation();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    const check = () => api.get(url).then(r => { if (live) setCount(r.data[field]); }).catch(() => {});
    check();
    const t = setInterval(check, 60 * 1000);
    window.addEventListener(EVENT, check);
    return () => { live = false; clearInterval(t); window.removeEventListener(EVENT, check); };
  }, [enabled, url, field, location.pathname, location.search]);
  return count;
}
