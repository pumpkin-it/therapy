import { useState, useEffect } from 'react';
import { Download, Send, CheckCircle, XCircle, FileText } from 'lucide-react';
import { format, startOfWeek, endOfWeek, subWeeks, addWeeks } from 'date-fns';
import api from '../lib/api';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { currency, fmtDate, localToday } from '../lib/utils';

const STATUS_COLOR = { draft:'gray', sent:'blue', paid:'green', void:'gray' };

// ─── To Send tab ─────────────────────────────────────────────────────────────
function ToSendTab() {
  const [appointments, setAppointments] = useState([]);
  const [clients, setClients] = useState([]);
  const [practitioners, setPractitioners] = useState([]);
  const [clientFilter, setClientFilter] = useState('');
  const [practFilter, setPractFilter] = useState('');
  const [weekOffset, setWeekOffset] = useState(0);
  const [selected, setSelected] = useState([]);
  const [generating, setGenerating] = useState(false);

  const weekStart = startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  const from = format(weekStart, 'yyyy-MM-dd');
  const to = format(weekEnd, 'yyyy-MM-dd');

  const load = () => {
    const params = new URLSearchParams({ from, to });
    if (clientFilter) params.set('client_id', clientFilter);
    if (practFilter) params.set('practitioner_id', practFilter);
    api.get(`/invoices/to-send?${params}`).then(r => setAppointments(r.data));
  };

  useEffect(() => {
    api.get('/clients?active=all').then(r => setClients(r.data));
    api.get('/practitioners?role=practitioner').then(r => setPractitioners(r.data));
  }, []);
  useEffect(() => { load(); setSelected([]); }, [weekOffset, clientFilter, practFilter]);

  const toggle = id => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const toggleAll = () => setSelected(s => s.length === appointments.length ? [] : appointments.map(a => a.id));

  const generate = async () => {
    if (!selected.length) return;
    setGenerating(true);
    try {
      await api.post('/invoices/generate', { appointment_ids: selected });
      setSelected([]);
      load();
    } finally { setGenerating(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="secondary" size="sm" onClick={() => setWeekOffset(w => w - 1)}>← Prev week</Button>
        <span className="text-sm font-medium text-gray-700 w-48 text-center">
          {format(weekStart, 'd MMM')} – {format(weekEnd, 'd MMM yyyy')}
        </span>
        <Button variant="secondary" size="sm" onClick={() => setWeekOffset(w => w + 1)}>Next week →</Button>
        <Button variant="ghost" size="sm" onClick={() => setWeekOffset(0)}>This week</Button>

        <select className="ml-auto rounded-lg border border-gray-300 px-2 py-1.5 text-sm" value={clientFilter} onChange={e => setClientFilter(e.target.value)}>
          <option value="">All clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.last_name}, {c.first_name}</option>)}
        </select>
        <select className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" value={practFilter} onChange={e => setPractFilter(e.target.value)}>
          <option value="">All practitioners</option>
          {practitioners.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
        </select>
      </div>

      {appointments.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center text-gray-400">
          No completed uninvoiced appointments for this period.
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 w-10">
                    <input type="checkbox" className="accent-indigo-600"
                      checked={selected.length === appointments.length && appointments.length > 0}
                      onChange={toggleAll} />
                  </th>
                  {['Date','Client','Practitioner','Service','Duration','Amount','Funder'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {appointments.map(a => {
                  const total = (a.items || []).reduce((s, i) => {
                    let t = i.quantity * i.unit_rate;
                    if (i.travel_time_min) t += (i.travel_time_min / 60) * (i.travel_rate_per_hour || i.unit_rate);
                    if (i.travel_km && i.km_rate) t += i.travel_km * i.km_rate;
                    if (i.notes_min) t += (i.notes_min / 60) * (i.notes_rate || i.unit_rate);
                    return s + t;
                  }, 0);
                  const dur = a.start_time && a.end_time
                    ? ((new Date(a.end_time) - new Date(a.start_time)) / 3600000).toFixed(1) + ' hrs'
                    : '—';
                  return (
                    <tr key={a.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <input type="checkbox" className="accent-indigo-600"
                          checked={selected.includes(a.id)} onChange={() => toggle(a.id)} />
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">{fmtDate(a.start_time)}</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{a.client_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        <div className="flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: a.practitioner_color }} />
                          {a.practitioner_name}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{(a.items || []).map(i => i.service_name || i.description).join(', ') || '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{dur}</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{currency(total)}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{a.funds_manager_name || <span className="text-gray-300">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">{selected.length} of {appointments.length} selected</span>
            <Button onClick={generate} disabled={generating || !selected.length}>
              <FileText className="h-4 w-4" /> {generating ? 'Generating…' : `Generate ${selected.length} invoice${selected.length !== 1 ? 's' : ''}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Invoice list tab (sent / paid) ──────────────────────────────────────────
function InvoiceListTab({ status, emptyMsg }) {
  const [invoices, setInvoices] = useState([]);
  const [sending, setSending] = useState(null);

  const load = () => api.get(`/invoices?status=${status}`).then(r => setInvoices(r.data));
  useEffect(() => { load(); }, [status]);

  const send = async id => {
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

  const voidInv = async id => {
    if (!confirm('Void this invoice? The appointment will become available for re-invoicing.')) return;
    await api.patch(`/invoices/${id}/void`);
    load();
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <table className="min-w-full divide-y divide-gray-100">
        <thead className="bg-gray-50">
          <tr>
            {['Invoice','Client','Practitioner','Funder','Issued','Due','Total','Status',''].map(h => (
              <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {invoices.length === 0 && (
            <tr><td colSpan={9} className="py-12 text-center text-gray-400">{emptyMsg}</td></tr>
          )}
          {invoices.map(inv => {
            const overdue = status === 'sent' && inv.due_date && inv.due_date < localToday();
            return (
              <tr key={inv.id} className={`hover:bg-gray-50 ${overdue ? 'bg-red-50/50' : ''}`}>
                <td className="px-4 py-3 font-mono text-sm font-medium text-gray-900">{inv.invoice_number}</td>
                <td className="px-4 py-3 text-sm text-gray-700">{inv.client_name}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{inv.practitioner_name || '—'}</td>
                <td className="px-4 py-3 text-sm text-gray-500">{inv.funds_manager_name || '—'}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{fmtDate(inv.issue_date)}</td>
                <td className={`px-4 py-3 text-sm ${overdue ? 'text-red-600 font-medium' : 'text-gray-600'}`}>{fmtDate(inv.due_date)}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{currency(inv.total)}</td>
                <td className="px-4 py-3">
                  <Badge color={overdue ? 'red' : STATUS_COLOR[inv.status] || 'gray'}>
                    {overdue ? 'overdue' : inv.status}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 justify-end">
                    <a href={`/api/invoices/${inv.id}/pdf`} target="_blank" rel="noreferrer">
                      <Button variant="ghost" size="sm" title="Download PDF"><Download className="h-3.5 w-3.5" /></Button>
                    </a>
                    {(inv.status === 'draft' || inv.status === 'sent') && (
                      <Button variant="ghost" size="sm" title={inv.status === 'draft' ? 'Send to funder' : 'Resend'}
                        disabled={sending === inv.id} onClick={() => send(inv.id)}>
                        <Send className="h-3.5 w-3.5 text-indigo-500" />
                      </Button>
                    )}
                    {inv.status === 'sent' && (
                      <Button variant="ghost" size="sm" title="Mark as paid" onClick={() => markPaid(inv.id)}>
                        <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                      </Button>
                    )}
                    {(inv.status === 'draft' || inv.status === 'sent') && (
                      <Button variant="ghost" size="sm" title="Void invoice" onClick={() => voidInv(inv.id)}>
                        <XCircle className="h-3.5 w-3.5 text-red-400" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Invoices page ─────────────────────────────────────────────────────
export default function Invoices() {
  const [tab, setTab] = useState('to_send');

  const TABS = [
    ['to_send',    'To Send'],
    ['to_receive', 'To Receive'],
    ['paid',       'Paid'],
  ];

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Invoices</h1>

      <div className="border-b border-gray-200">
        <div className="flex gap-0">
          {TABS.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === id ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'to_send' && <ToSendTab />}
      {tab === 'to_receive' && <InvoiceListTab status="draft,sent" emptyMsg="No invoices awaiting payment." />}
      {tab === 'paid' && <InvoiceListTab status="paid" emptyMsg="No paid invoices." />}
    </div>
  );
}
