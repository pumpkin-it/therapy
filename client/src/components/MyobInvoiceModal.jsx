import { useEffect, useState } from 'react';
import api from '../lib/api';
import Modal from './ui/Modal';
import Button from './ui/Button';
import Input from './ui/Input';
import { currency, fmtDate } from '../lib/utils';

// Manual MYOB entry for one appointment or report entry (owners, admins and finance) — alongside
// the MYOB Sync imports. The invoice number is this appointment's; the payment belongs to the
// MYOB invoice, so it applies to every appointment on that number (server/routes/myobSync.js).
//
// appointment: { id, myob_invoice_number, myob_status, myob_amount_due }; label: shown in the title.
const PAYMENTS = [
  ['none', 'No payment recorded'],
  ['open', 'Part paid / open'],
  ['paid', 'Paid in full'],
];
const money = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? '' : String(Math.round(Number(v) * 100) / 100));

export default function MyobInvoiceModal({ appointment, label, onClose, onSaved }) {
  const initialPayment = appointment.myob_status === 'closed' ? 'paid' : appointment.myob_status === 'open' ? 'open' : 'none';
  const [invoiceNo, setInvoiceNo] = useState(appointment.myob_invoice_number || '');
  const [payment, setPayment] = useState(initialPayment);
  const [paid, setPaid] = useState('');
  const [due, setDue] = useState(appointment.myob_status === 'open' ? money(appointment.myob_amount_due) : '');
  const [summary, setSummary] = useState(null);   // what's already on the invoice number typed
  const [ownAmount, setOwnAmount] = useState(null); // this appointment's own amount
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/myob-sync/appointment-amount?id=${appointment.id}`).then(r => setOwnAmount(r.data.amount)).catch(() => setOwnAmount(0));
  }, [appointment.id]);

  useEffect(() => {
    const no = invoiceNo.trim();
    if (!no) { setSummary(null); return undefined; }
    const t = setTimeout(() => {
      api.get(`/myob-sync/invoice?no=${encodeURIComponent(no)}`).then(r => setSummary(r.data)).catch(() => setSummary(null));
    }, 300);
    return () => clearTimeout(t);
  }, [invoiceNo]);

  // The invoice total: what's on it already, plus this appointment if it's only now joining it.
  const others = (summary?.appointments || []).filter(a => a.id !== appointment.id);
  const total = summary && ownAmount != null ? others.reduce((s, a) => s + a.amount, 0) + ownAmount : null;

  // Once the total is known, show what's been paid against a recorded amount due.
  useEffect(() => {
    if (total != null && due !== '' && paid === '') setPaid(money(Math.max(0, total - Number(due))));
  }, [total]); // only when the total first becomes known

  const onPaid = v => { setPaid(v); if (total != null && v !== '') setDue(money(Math.max(0, total - Number(v)))); };
  const onDue = v => { setDue(v); if (total != null && v !== '') setPaid(money(Math.max(0, total - Number(v)))); };

  const save = async () => {
    setError('');
    const no = invoiceNo.trim();
    if (no && payment === 'open' && !(Number(due) > 0)) {
      return setError(due !== '' && Number(due) === 0 ? 'Nothing is left to pay — choose "Paid in full".' : 'Enter the amount paid or the amount still due.');
    }
    const body = { appointment_id: appointment.id, invoice_no: no };
    // The payment is sent when it's been changed (or an open amount edited); unlinking the invoice
    // number clears it anyway.
    if (no && (payment !== initialPayment || payment === 'open')) Object.assign(body, { payment, amount_due: Number(due) || 0 });
    setSaving(true);
    try {
      await api.post('/myob-sync/manual', body);
      onSaved?.();
    } catch (e) {
      setError(e.response?.data?.error || 'Could not save');
    } finally { setSaving(false); }
  };

  return (
    <Modal title={`MYOB invoice${label ? ` — ${label}` : ''}`} onClose={onClose}>
      <div className="space-y-4">
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Input label="MYOB invoice number" value={invoiceNo} placeholder="e.g. 00002222 or INV 2222" autoFocus
          onChange={e => setInvoiceNo(e.target.value.replace(/[^A-Za-z0-9\-/ ]/g, '').toUpperCase())} />

        {others.length > 0 && (
          <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
            Also on this invoice: {others.map(a => `${a.client_name} ${fmtDate(a.start_time)}${a.billable_report_id ? ` (report ${a.report_progress_pct}%)` : ''}`).join(', ')}.
            A payment applies to the whole invoice.
          </div>
        )}

        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">Payment</label>
          <div className="flex flex-wrap gap-2">
            {PAYMENTS.map(([v, text]) => (
              <button key={v} type="button" disabled={!invoiceNo.trim()} onClick={() => setPayment(v)}
                className={`rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40 ${payment === v ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
                {text}
              </button>
            ))}
          </div>
          {!invoiceNo.trim() && <p className="text-xs text-gray-400">Add the invoice number to record a payment.</p>}
        </div>

        {payment === 'open' && invoiceNo.trim() && (
          <div className="space-y-2">
            {total != null && <p className="text-sm text-gray-600">Invoice total: <strong>{currency(total)}</strong>{others.length ? ` (${others.length + 1} items)` : ''}</p>}
            <div className="grid grid-cols-2 gap-3">
              <Input label="Amount paid" type="number" min="0" step="0.01" value={paid} onChange={e => onPaid(e.target.value)} />
              <Input label="Amount still due" type="number" min="0" step="0.01" value={due} onChange={e => onDue(e.target.value)} />
            </div>
            <p className="text-xs text-gray-400">Enter either one — the other is worked out from the invoice total. If MYOB shows a different total (e.g. with GST), enter the amount due shown in MYOB.</p>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>
    </Modal>
  );
}
