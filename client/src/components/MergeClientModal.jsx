import { useEffect, useMemo, useState } from 'react';
import { Search, ArrowRight, AlertTriangle } from 'lucide-react';
import api from '../lib/api';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { fmtDateOnly } from '../lib/utils';

const code = id => `C${String(id).padStart(4, '0')}`;
const norm = s => String(s || '').toLowerCase().replace(/[\s-]+/g, ' ').trim();
const FIELDS = [['Name', c => `${c.first_name} ${c.last_name}`], ['Date of birth', c => c.date_of_birth], ['Email', c => c.email], ['Phone', c => c.phone],
  ['Address', c => c.address], ['NDIS number', c => c.ndis_number], ['Status', c => (c.active ? 'Active' : 'Inactive')], ['Created', c => fmtDateOnly(c.created_at)]];

// Merge this (duplicate) client into the one being kept: choose the client to keep, check what
// moves across, confirm.
export default function MergeClientModal({ client, onClose, onMerged }) {
  const [clients, setClients] = useState([]);
  const [query, setQuery] = useState(client.last_name || '');
  const [targetId, setTargetId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get('/clients?active=all').then(r => setClients(r.data.filter(c => c.id !== client.id))).catch(() => {}); }, [client.id]);
  useEffect(() => {
    setPreview(null); setError('');
    if (!targetId) return;
    api.get(`/clients/${client.id}/merge-preview`, { params: { target: targetId } }).then(r => setPreview(r.data)).catch(e => setError(e.response?.data?.error || 'Could not check this merge'));
  }, [targetId, client.id]);

  // Same-name clients first (likely the other half of the duplicate), then search matches.
  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    const same = c => norm(`${c.first_name} ${c.last_name}`) === norm(`${client.first_name} ${client.last_name}`);
    return clients.filter(c => same(c) || (q && (`${c.first_name} ${c.last_name}`.toLowerCase().includes(q) || code(c.id).toLowerCase() === q)))
      .sort((a, b) => (same(b) ? 1 : 0) - (same(a) ? 1 : 0)).slice(0, 10);
  }, [clients, query, client]);

  const merge = async () => {
    setBusy(true); setError('');
    try { await api.post(`/clients/${client.id}/merge`, { target_id: targetId }); onMerged(targetId); }
    catch (e) { setError(e.response?.data?.error || 'Could not merge'); setBusy(false); }
  };

  return (
    <Modal title={`Merge ${code(client.id)} ${client.first_name} ${client.last_name} into another client`} size="xl" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Use this when the same person has two client records. Everything on <strong>this</strong> record moves to the client you keep;
          this record is then hidden. The kept client's details don't change. It can be undone.
        </p>
        {!targetId && (
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
              <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Find the client to keep…"
                className="w-full rounded-lg border border-gray-300 py-2 pl-8 pr-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            </div>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {options.length === 0 && <li className="px-3 py-3 text-sm text-gray-400">No matching clients.</li>}
              {options.map(c => (
                <li key={c.id}>
                  <button type="button" onClick={() => setTargetId(c.id)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-indigo-50">
                    <span><span className="font-mono text-xs text-indigo-500">{code(c.id)}</span> {c.first_name} {c.last_name}
                      {!c.active && <span className="ml-1 text-gray-400">- INACTIVE</span>}</span>
                    <span className="text-xs text-gray-400">{c.date_of_birth ? `DOB ${c.date_of_birth}` : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {targetId && !preview && !error && <p className="text-sm text-gray-400">Checking…</p>}
        {preview && (
          <div className="space-y-3">
            <div className="grid grid-cols-[auto_1fr_auto_1fr] items-start gap-x-3 gap-y-1 rounded-lg border border-gray-200 p-3 text-sm">
              <span />
              <span className="font-medium text-red-700">Duplicate (merged away) — {preview.source.label}</span>
              <span />
              <span className="font-medium text-green-700">Kept — {preview.target.label}</span>
              {FIELDS.map(([label, get]) => {
                const a = get(preview.source) || '—', b = get(preview.target) || '—';
                return [
                  <span key={`${label}l`} className="text-gray-400">{label}</span>,
                  <span key={`${label}a`} className={a !== b && a !== '—' && b === '—' ? 'font-medium text-amber-700' : 'text-gray-700'}>{a}</span>,
                  <ArrowRight key={`${label}x`} className="mt-0.5 h-3.5 w-3.5 text-gray-300" />,
                  <span key={`${label}b`} className="text-gray-700">{b}</span>,
                ];
              })}
            </div>
            <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
              <p className="font-medium">Moves to {preview.target.label}:</p>
              <p>{preview.counts.length ? preview.counts.map(c => c.text).join(', ') : 'Nothing is attached to the duplicate.'}</p>
            </div>
            {FIELDS.some(([, get]) => get(preview.source) && !get(preview.target)) && (
              <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Details highlighted in amber are only on the duplicate. They are not copied — add them to the kept client first if they're needed.
              </p>
            )}
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          {targetId && <Button variant="ghost" onClick={() => setTargetId(null)} disabled={busy}>Choose a different client</Button>}
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          {preview && <Button variant="danger" onClick={merge} disabled={busy}>{busy ? 'Merging…' : `Merge ${preview.source.label.split(' ')[0]} into ${preview.target.label.split(' ')[0]}`}</Button>}
        </div>
      </div>
    </Modal>
  );
}
