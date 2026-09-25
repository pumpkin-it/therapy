import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import api from '../lib/api';
import { substituteVars } from '../lib/utils';
import { useAuth } from '../context/AuthContext';
import Button from './ui/Button';

// Freeform To/Cc email chip input — types an address, Enter/comma adds it as a chip.
function EmailChips({ label, value, onChange }) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const addr = draft.trim().replace(/,$/, '');
    if (addr && !value.includes(addr)) onChange([...value, addr]);
    setDraft('');
  };

  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <div className="flex flex-wrap gap-1.5 rounded-lg border border-gray-300 px-2 py-1.5 focus-within:border-indigo-500">
        {value.map(addr => (
          <span key={addr} className="flex items-center gap-1 rounded-full bg-indigo-50 text-indigo-700 text-xs px-2 py-0.5">
            {addr}
            <button type="button" onClick={() => onChange(value.filter(a => a !== addr))} className="hover:text-indigo-900">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          className="flex-1 min-w-[120px] text-sm outline-none py-0.5"
          value={draft}
          placeholder={value.length ? '' : 'name@example.com'}
          onChange={e => {
            if (e.target.value.endsWith(',')) { setDraft(e.target.value); commit(); }
            else setDraft(e.target.value);
          }}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); } }}
          onBlur={commit}
        />
      </div>
    </div>
  );
}

// Preview/edit modal for the "Notify client" button on a shared report — mirrors
// SessionNoteEmailModal's pattern (editable preview, sent as-typed, nothing auto-dispatched).
// Which template loads (draft vs released) is driven by the report's current status, since the
// two must say different things — the draft copy never mentions payment and calls out that the
// link will start showing the final version once released; the released copy just says it's
// ready to download. The report link itself never changes between the two.
export default function ReportNotifyModal({ client, file, onClose, onSent }) {
  const { user } = useAuth();
  const [to, setTo] = useState(client?.email ? [client.email] : []);
  const [cc, setCc] = useState([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const isReleased = file.report_status === 'released';
  const templateCode = isReleased ? 'report_released' : 'report_shared_draft';

  useEffect(() => {
    // /templates needs the settings permission, which practitioners don't have — fall back to the
    // built-in wording rather than leaving the subject and message blank.
    const fill = templates => {
      const tpl = templates.find(t => t.code === templateCode);
      const reportTitle = file.label || file.original_name;
      const vars = {
        client_name: `${client?.first_name || ''} ${client?.last_name || ''}`.trim(),
        client_first_name: client?.first_name || '',
        practitioner_name: user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : '',
        report_title: reportTitle,
        report_link: `${window.location.origin}/report/${file.report_view_token}`,
      };
      const fallbackSubject = isReleased ? `Your ${reportTitle} is ready to download` : `Your ${reportTitle} is ready to preview`;
      const fallbackBody = isReleased
        ? `<p>Hi {{client_first_name}},</p><p>Your <strong>${reportTitle}</strong> is now finalised and ready to download using the link below.</p><p><a href="{{report_link}}">{{report_link}}</a></p><p>Regards,<br>{{practitioner_name}}</p>`
        : `<p>Hi {{client_first_name}},</p><p>A draft of your <strong>${reportTitle}</strong> is ready for you to look over. You can preview it using the link below — this is a preview version, and the same link will automatically show the finished report once it's released.</p><p><a href="{{report_link}}">{{report_link}}</a></p><p>Regards,<br>{{practitioner_name}}</p>`;
      const plain = (tpl?.body || fallbackBody)
        .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
      setSubject(substituteVars(tpl?.subject || fallbackSubject, vars));
      setBody(substituteVars(plain, vars));
    };
    api.get('/templates?type=email').then(r => fill(r.data || [])).catch(() => fill([]));
  }, []);

  const send = async () => {
    if (!to.length) { setError('Add at least one recipient'); return; }
    setSending(true);
    setError('');
    try {
      await api.post(`/client-files/${file.id}/notify-report`, { to, cc, subject, body });
      onSent();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to send email');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl p-6 max-w-lg w-full mx-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Notify client{isReleased ? '' : ' (draft shared)'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <EmailChips label="To" value={to} onChange={setTo} />
        <EmailChips label="Cc" value={cc} onChange={setCc} />

        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700">Subject</label>
          <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            value={subject} onChange={e => setSubject(e.target.value)} />
        </div>

        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700">Message</label>
          <textarea rows={6} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-y focus:border-indigo-500 focus:outline-none"
            value={body} onChange={e => setBody(e.target.value)} />
        </div>

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={send} disabled={sending || !to.length}>{sending ? 'Sending…' : 'Send'}</Button>
        </div>
      </div>
    </div>
  );
}
