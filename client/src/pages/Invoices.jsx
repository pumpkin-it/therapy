import { useState, useEffect } from 'react';
import { Plus, Download, Send, CheckCircle } from 'lucide-react';
import api from '../lib/api';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import { currency, fmtDate } from '../lib/utils';

const STATUS_COLOR = { draft:'gray', sent:'blue', paid:'green', overdue:'red', void:'gray' };

function CreateInvoiceModal({ onClose, onSaved }) {
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [uninvoiced, setUninvoiced] = useState([]);
  const [selected, setSelected] = useState([]);
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/clients').then(r => setClients(r.data));
  }, []);

  useEffect(() => {
    if (!clientId) { setUninvoiced([]); return; }
    api.get(`/appointments?client_id=${clientId}`)
      .then(r => setUninvoiced(r.data.filter(a => !a.is_invoiced && a.status === 'completed')));
  }, [clientId]);

  const toggle = id => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const save = async () => {
    setSaving(true);
    try {
      await api.post('/invoices', {
        client_id: Number(clientId),
        due_date: dueDate,
        appointment_ids: selected,
      });
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <Modal title="Create Invoice" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Client</label>
            <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={clientId} onChange={e => setClientId(e.target.value)}>
              <option value="">Select client…</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.last_name}, {c.first_name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Due date</label>
            <input type="date" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
        </div>

        {clientId && (
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Completed appointments to invoice</p>
            {uninvoiced.length === 0 ? (
              <p className="text-sm text-gray-400">No uninvoiced completed appointments for this client.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {uninvoiced.map(a => (
                  <label key={a.id} className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 cursor-pointer hover:bg-gray-50">
                    <input type="checkbox" checked={selected.includes(a.id)} onChange={() => toggle(a.id)} className="mt-0.5" />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-900">
                        {fmtDate(a.start_time)} — {a.practitioner_name}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {a.items.map(i => `${i.description} × ${i.quantity} @ $${i.unit_rate}`).join(', ')}
                      </div>
                      <div className="text-xs font-medium text-gray-700 mt-1">
                        {currency(a.items.reduce((s, i) => s + i.quantity * i.unit_rate, 0))}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving || !clientId || !dueDate || selected.length === 0}>
          {saving ? 'Creating…' : 'Create invoice'}
        </Button>
      </div>
    </Modal>
  );
}

export default function Invoices() {
  const [invoices, setInvoices] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [sending, setSending] = useState(null);

  const load = () => api.get('/invoices').then(r => setInvoices(r.data));
  useEffect(() => { load(); }, []);

  const send = async id => {
    if (!confirm('Send this invoice to the client by email?')) return;
    setSending(id);
    try {
      await api.post(`/invoices/${id}/send`);
      load();
    } catch (e) {
      alert(e.response?.data?.error || 'Failed to send');
    } finally { setSending(null); }
  };

  const markPaid = async id => {
    await api.patch(`/invoices/${id}/mark-paid`);
    load();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Invoices</h1>
        <Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> Create invoice</Button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>
              {['Invoice','Client','Issued','Due','Total','Status',''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {invoices.length === 0 && (
              <tr><td colSpan={7} className="py-12 text-center text-gray-400">No invoices yet</td></tr>
            )}
            {invoices.map(inv => (
              <tr key={inv.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-sm font-medium text-gray-900">{inv.invoice_number}</td>
                <td className="px-4 py-3 text-sm text-gray-700">{inv.client_name}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{fmtDate(inv.issue_date)}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{fmtDate(inv.due_date)}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{currency(inv.total)}</td>
                <td className="px-4 py-3"><Badge color={STATUS_COLOR[inv.status] || 'gray'}>{inv.status}</Badge></td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 justify-end">
                    <a href={`/api/invoices/${inv.id}/pdf`} target="_blank" rel="noreferrer">
                      <Button variant="ghost" size="sm" title="Download PDF">
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    </a>
                    {inv.status === 'draft' && (
                      <Button variant="ghost" size="sm" title="Send to client"
                        disabled={sending === inv.id} onClick={() => send(inv.id)}>
                        <Send className="h-3.5 w-3.5 text-indigo-500" />
                      </Button>
                    )}
                    {inv.status === 'sent' && (
                      <Button variant="ghost" size="sm" title="Mark as paid" onClick={() => markPaid(inv.id)}>
                        <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreateInvoiceModal onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); load(); }} />
      )}
    </div>
  );
}
