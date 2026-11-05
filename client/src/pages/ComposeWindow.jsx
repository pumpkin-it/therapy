import { useEffect, useState } from 'react';
import { useCompose } from '../context/ComposeContext';

const SESSION_KEY = 'therapy-compose-window';

// Compose in its own browser window. The window that opened this leaves the email (and any draft
// so far) in localStorage; it moves to sessionStorage here so a refresh of this window keeps it.
// The window closes itself once the email has gone, or when it's closed or discarded. It stays open
// if something couldn't be sent, so the failure is seen.
export default function ComposeWindow() {
  const { openCompose, composeOpen, busy, enabled } = useCompose();
  const [seen, setSeen] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let raw = null;
    try {
      raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) {
        const handoff = `therapy-compose-popout:${new URLSearchParams(window.location.search).get('id')}`;
        raw = localStorage.getItem(handoff);
        if (raw) { sessionStorage.setItem(SESSION_KEY, raw); localStorage.removeItem(handoff); }
      }
    } catch { /* storage unavailable */ }
    if (!raw || !enabled) { setMissing(true); return; }
    openCompose({ ...JSON.parse(raw), windowed: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (composeOpen) setSeen(true); }, [composeOpen]);
  const finished = seen && !composeOpen && !busy;
  useEffect(() => { if (finished) window.close(); }, [finished]);

  if (missing || finished) {
    return <p className="p-10 text-center text-sm text-gray-500">{missing ? "This email couldn't be opened here. Close this window and try again from Therapy." : 'You can close this window.'}</p>;
  }
  return null;
}
