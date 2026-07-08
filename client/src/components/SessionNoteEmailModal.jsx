import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import api from '../lib/api';
import { substituteVars } from '../lib/utils';
import { useAuth } from '../context/AuthContext';
import Button from './ui/Button';

function dateRangeLabel(notes) {
  if (!notes.length) return '';
  const fmt = d => d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  const dates = notes.map(n => new Date(n.created_at));
  const min = new Date(Math.min(...dates));
  const max = new Date(Math.max(...dates));
  return min.getTime() === max.getTime() ? fmt(min) : `${fmt(min)} – ${fmt(max)}`;
}

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

export default function SessionNoteEmailModal({ clientId, client, noteIds, notes, onClose, onSent }) {
  const { user } = useAuth();
  const [to, setTo] = useState(client?.email ? [client.email] : []);
  const [cc, setCc] = useState([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/templates?type=email').then(r => {
      const tpl = (r.data || []).find(t => t.code === 'session_note_email');
      const clientName = `${client?.first_name || ''} ${client?.last_name || ''}`.trim();
      const vars = {
        client_name: clientName,
        client_first_name: client?.first_name || '',
        recipient_name: client?.first_name || 'there',
        practitioner_name: user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : '',
        date_range: dateRangeLabel(notes || []),
        note_count: (notes || []).length,
      };
      const plain = (tpl?.body || '<p>Hi {{recipient_name}},</p><p>Please find attached the session notes for {{client_name}} covering {{date_range}}.</p><p>Regards,<br>{{practitioner_name}}</p>')
        .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').trim();
      setSubject(substituteVars(tpl?.subject || `Session notes for ${clientName}`, vars));
      setBody(substituteVars(plain, vars));
    });
  }, []);

  const send = async () => {
    if (!to.length) { setError('Add at least one recipient'); return; }
    setSending(true);
    setError('');
    try {
      await api.post('/session-notes/email', { note_ids: noteIds, to, cc, subject, body });
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
          <h3 className="font-semibold text-gray-900">Email session notes</h3>
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
          <textarea rows={5} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-y focus:border-indigo-500 focus:outline-none"
            value={body} onChange={e => setBody(e.target.value)} />
          <p className="text-xs text-gray-400">The session notes PDF will be attached automatically.</p>
        </div>

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={send} disabled={sending || !to.length}>{sending ? 'Sending…' : 'Send'}</Button>
        </div>
      </div>
    </div>
  );
}
