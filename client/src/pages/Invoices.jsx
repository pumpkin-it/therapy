import { useState, useEffect } from 'react';
import { Download, Send, CheckCircle, XCircle, FileText, FileSpreadsheet, Calendar as CalendarIcon } from 'lucide-react';
import { format, startOfWeek, endOfWeek, subWeeks, addWeeks } from 'date-fns';
import api from '../lib/api';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import AppointmentModal from '../components/AppointmentModal';
import InvoiceSync from './InvoiceSync';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import { currency, fmtDate, localToday, downloadFile, roundQty } from '../lib/utils';

const STATUS_COLOR = { draft:'gray', sent:'blue', paid:'green', void:'gray' };

// ─── To Send tab ─────────────────────────────────────────────────────────────
function ToSendTab({ mode }) {
  const { user } = useAuth();
  const canViewClients = !!user?.permissions?.clients;
  const exportOnlyMode = mode === 'export_only';
  const [appointments, setAppointments] = useState([]);
  const [clients, setClients] = useState([]);
  const [practitioners, setPractitioners] = useState([]);
  const [clientFilter, setClientFilter] = useState('');
  const [practFilter, setPractFilter] = useState('');
  const [weekOffset, setWeekOffset] = useState(0);
  const [selected, setSelected] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [myobDate, setMyobDate] = useState(localToday());
  const [pendingCount, setPendingCount] = useState(0);
  const [viewAll, setViewAll] = useState(false);
  const [apptModal, setApptModal] = useState(null);

  const openAppt = async id => {
    const { data } = await api.get(`/appointments/${id}`);
    setApptModal(data);
  };

  const weekStart = startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  const from = format(weekStart, 'yyyy-MM-dd');
  const to = format(weekEnd, 'yyyy-MM-dd');

  const load = () => {
    const params = new URLSearchParams();
    if (viewAll) {
      params.set('all', '1');
      params.set('pending_export_only', '1');
    } else {
      params.set('from', from);
      params.set('to', to);
    }
    if (clientFilter) params.set('client_id', clientFilter);
    if (practFilter) params.set('practitioner_id', practFilter);
    api.get(`/invoices/to-send?${params}`).then(r => setAppointments(r.data));
  };

  const loadPendingCount = () => {
    if (!exportOnlyMode) return;
    api.get('/invoices/pending-export-count').then(r => setPendingCount(r.data.count));
  };

  useEffect(() => {
    if (canViewClients) api.get('/clients?active=all').then(r => setClients(r.data));
    api.get('/practitioners?role=practitioner').then(r => setPractitioners(r.data));
  }, []);
  useEffect(() => { load(); setSelected([]); }, [weekOffset, clientFilter, practFilter, viewAll]);
  useEffect(() => { loadPendingCount(); }, [exportOnlyMode]);

  const toggle = id => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const toggleAll = () => setSelected(s => s.length === appointments.length ? [] : appointments.map(a => a.id));

  const exportMyob = async () => {
    const ids = selected.join(',');
    setExporting(true);
    try {
      await downloadFile(api, `/invoices/export-myob-appointments?appointment_ids=${ids}&invoice_date=${myobDate}`, `MYOB_Import_${myobDate}.csv`);
      if (exportOnlyMode) { load(); loadPendingCount(); }
    } finally { setExporting(false); }
  };

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
      {exportOnlyMode && pendingCount > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <span>{pendingCount} appointment{pendingCount !== 1 ? 's' : ''} not yet exported to MYOB — some may be outside the current week.</span>
          <button onClick={() => setViewAll(v => !v)} className="font-medium text-amber-900 hover:underline">
            {viewAll ? 'Back to weekly view' : 'View all outstanding'}
          </button>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        {!viewAll && (
          <>
            <Button variant="secondary" size="sm" onClick={() => setWeekOffset(w => w - 1)}>← Prev week</Button>
            <span className="text-sm font-medium text-gray-700 w-48 text-center">
              {format(weekStart, 'd MMM')} – {format(weekEnd, 'd MMM yyyy')}
            </span>
            <Button variant="secondary" size="sm" onClick={() => setWeekOffset(w => w + 1)}>Next week →</Button>
            <Button variant="ghost" size="sm" onClick={() => setWeekOffset(0)}>This week</Button>
          </>
        )}
        {viewAll && <span className="text-sm font-medium text-gray-700">All outstanding, oldest first</span>}

        {canViewClients && (
          <select className="ml-auto rounded-lg border border-gray-300 px-2 py-1.5 text-sm" value={clientFilter} onChange={e => setClientFilter(e.target.value)}>
            <option value="">All clients</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}{!c.active && ' (inactive)'}</option>)}
          </select>
        )}
        <select className={`rounded-lg border border-gray-300 px-2 py-1.5 text-sm ${canViewClients ? '' : 'ml-auto'}`} value={practFilter} onChange={e => setPractFilter(e.target.value)}>
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
                  {['Date','Client','Practitioner','Service','Duration','Amount','Funder', ...(exportOnlyMode ? ['MYOB'] : [])].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {appointments.map(a => {
                  const isBillableCancellation = a.status === 'cancelled' && a.late_cancel_billable && a.late_cancel_pct;
                  const total = (a.items || []).reduce((s, i) => {
                    let t = isBillableCancellation
                      ? roundQty(i.quantity) * i.unit_rate * (a.late_cancel_pct / 100)
                      : roundQty(i.billed_quantity ?? i.quantity) * (i.billed_unit_rate ?? i.unit_rate);
                    const travelMin = (i.travel_time_to || 0) + (i.travel_time_from || 0);
                    if (travelMin) t += roundQty(travelMin / 60) * (i.travel_rate_per_hour || i.unit_rate);
                    if (i.travel_km && i.km_rate) t += roundQty(i.travel_km) * i.km_rate;
                    if (i.notes_min) t += roundQty(i.notes_min / 60) * (i.notes_rate || i.unit_rate);
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
                      <td className="px-4 py-3 text-sm">
                        <button onClick={() => openAppt(a.id)} title="View appointment"
                          className="text-gray-700 hover:text-indigo-600 hover:underline">
                          {fmtDate(a.start_time)}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        <div className="flex items-center gap-2">
                          {a.client_name}
                          {a.status === 'cancelled' && a.late_cancel_billable ? (
                            <Badge color="amber">Cancelled — billable {a.late_cancel_pct}%</Badge>
                          ) : null}
                        </div>
                      </td>
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
                      {exportOnlyMode && (
                        <td className="px-4 py-3">
                          {a.myob_invoice_number ? (
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-xs text-gray-500">INV {a.myob_invoice_number}</span>
                              {a.myob_status === 'closed' ? (
                                <Badge color="green">Closed</Badge>
                              ) : a.myob_status === 'open' ? (
                                <Badge color="blue">Open{a.myob_amount_due ? ` · ${currency(a.myob_amount_due)} due` : ''}</Badge>
                              ) : (
                                <Badge color="purple">Linked</Badge>
                              )}
                            </div>
                          ) : a.myob_exported_at ? (
                            <Badge color="purple" title={new Date(a.myob_exported_at).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}>
                              Exported {fmtDate(a.myob_exported_at)}
                            </Badge>
                          ) : (
                            <Badge color="amber">Not exported</Badge>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">{selected.length} of {appointments.length} selected</span>
            <div className="flex items-center gap-2">
              {selected.length > 0 && (
                <>
                  <label className="text-sm text-gray-600">Invoice Date:</label>
                  <input type="date" className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                    value={myobDate} onChange={e => setMyobDate(e.target.value)} />
                  <Button variant={exportOnlyMode ? 'primary' : 'secondary'} onClick={exportMyob} disabled={!selected.length || exporting}>
                    <FileSpreadsheet className="h-4 w-4" /> {exporting ? 'Exporting…' : 'Export MYOB CSV'}
                  </Button>
                </>
              )}
              {!exportOnlyMode && (
                <Button onClick={generate} disabled={generating || !selected.length}>
                  <FileText className="h-4 w-4" /> {generating ? 'Generating…' : `Generate ${selected.length} invoice${selected.length !== 1 ? 's' : ''}`}
                </Button>
              )}
            </div>
          </div>
        </>
      )}

      {apptModal && (
        <AppointmentModal
          appointment={apptModal}
          onClose={() => setApptModal(null)}
          onSaved={() => { setApptModal(null); load(); }}
        />
      )}
    </div>
  );
}

// ─── Invoice list tab (sent / paid) ──────────────────────────────────────────
function InvoiceListTab({ status, emptyMsg }) {
  const [invoices, setInvoices] = useState([]);
  const [sending, setSending] = useState(null);
  const [selected, setSelected] = useState([]);
  const [exportOnly, setExportOnly] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [myobDate, setMyobDate] = useState(localToday());
  const [apptModal, setApptModal] = useState(null);
  const canExport = status === 'draft,sent';

  const load = () => api.get(`/invoices?status=${status}`).then(r => { setInvoices(r.data); setSelected([]); });
  useEffect(() => { load(); }, [status]);

  const openAppt = async id => {
    const { data } = await api.get(`/appointments/${id}`);
    setApptModal(data);
  };

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

  const notExportedCount = invoices.filter(i => !i.myob_exported_at).length;
  const visibleInvoices = exportOnly ? invoices.filter(i => !i.myob_exported_at) : invoices;

  const toggle = id => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const toggleAll = () => setSelected(s => s.length === visibleInvoices.length ? [] : visibleInvoices.map(i => i.id));

  const exportMyob = async () => {
    setExporting(true);
    try {
      await downloadFile(api, `/invoices/export-myob?invoice_ids=${selected.join(',')}&invoice_date=${myobDate}`, `MYOB_Import_${myobDate}.csv`);
      load();
    } finally { setExporting(false); }
  };

  return (
    <div className="space-y-3">
      {canExport && notExportedCount > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <span>{notExportedCount} invoice{notExportedCount !== 1 ? 's' : ''} not yet exported to MYOB.</span>
          <button onClick={() => setExportOnly(v => !v)} className="font-medium text-amber-900 hover:underline">
            {exportOnly ? 'Show all invoices' : 'Show only these'}
          </button>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>
              {canExport && (
                <th className="px-4 py-3 w-10">
                  <input type="checkbox" className="accent-indigo-600"
                    checked={selected.length === visibleInvoices.length && visibleInvoices.length > 0}
                    onChange={toggleAll} />
                </th>
              )}
              {['Invoice','Client','Practitioner','Funder','Issued','Due','Total','Status','MYOB',''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {visibleInvoices.length === 0 && (
              <tr><td colSpan={10} className="py-12 text-center text-gray-400">{emptyMsg}</td></tr>
            )}
            {visibleInvoices.map(inv => {
              const overdue = status === 'sent' && inv.due_date && inv.due_date < localToday();
              return (
                <tr key={inv.id} className={`hover:bg-gray-50 ${overdue ? 'bg-red-50/50' : ''}`}>
                  {canExport && (
                    <td className="px-4 py-3">
                      <input type="checkbox" className="accent-indigo-600"
                        checked={selected.includes(inv.id)} onChange={() => toggle(inv.id)} />
                    </td>
                  )}
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
                    {inv.myob_exported_at ? (
                      <Badge color="green" title={new Date(inv.myob_exported_at).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}>
                        Exported {fmtDate(inv.myob_exported_at)}
                      </Badge>
                    ) : (
                      <Badge color="amber">Not exported</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      {inv.appointment_id && (
                        <Button variant="ghost" size="sm" title="View appointment" onClick={() => openAppt(inv.appointment_id)}>
                          <CalendarIcon className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" title="Download PDF"
                        onClick={() => downloadFile(api, `/invoices/${inv.id}/pdf`, `${inv.invoice_number}.pdf`)}>
                        <Download className="h-3.5 w-3.5" />
                      </Button>
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

      {canExport && selected.length > 0 && (
        <div className="flex items-center justify-end gap-2">
          <span className="text-sm text-gray-500 mr-auto">{selected.length} selected</span>
          <label className="text-sm text-gray-600">Invoice Date:</label>
          <input type="date" className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            value={myobDate} onChange={e => setMyobDate(e.target.value)} />
          <Button variant="secondary" onClick={exportMyob} disabled={exporting}>
            <FileSpreadsheet className="h-4 w-4" /> {exporting ? 'Exporting…' : 'Export MYOB CSV'}
          </Button>
        </div>
      )}

      {apptModal && (
        <AppointmentModal
          appointment={apptModal}
          onClose={() => setApptModal(null)}
          onSaved={() => { setApptModal(null); load(); }}
        />
      )}
    </div>
  );
}

// ─── Main Invoices page ─────────────────────────────────────────────────────
export default function Invoices() {
  const { invoicingMode } = useSettings();
  const exportOnlyMode = invoicingMode === 'export_only';
  const [tab, setTab] = useState('to_send');

  const TABS = exportOnlyMode
    ? [['to_send', 'To Export'], ['sync', 'MYOB Sync']]
    : [
        ['to_send',    'To Send'],
        ['to_receive', 'To Receive'],
        ['paid',       'Paid'],
        ['void',       'Void'],
        ['sync',       'MYOB Sync'],
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

      {tab === 'to_send' && <ToSendTab mode={invoicingMode} />}
      {!exportOnlyMode && tab === 'to_receive' && <InvoiceListTab status="draft,sent" emptyMsg="No invoices awaiting payment." />}
      {!exportOnlyMode && tab === 'paid' && <InvoiceListTab status="paid" emptyMsg="No paid invoices." />}
      {!exportOnlyMode && tab === 'void' && <InvoiceListTab status="void" emptyMsg="No voided invoices." />}
      {tab === 'sync' && <InvoiceSync />}
    </div>
  );
}
