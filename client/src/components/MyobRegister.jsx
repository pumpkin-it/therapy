import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle, FileSpreadsheet } from 'lucide-react';
import { format, startOfWeek, endOfWeek, subWeeks, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import api from '../lib/api';
import Button from './ui/Button';
import Badge from './ui/Badge';
import AppointmentModal from './AppointmentModal';
import MyobInvoiceModal from './MyobInvoiceModal';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from './ui/ConfirmDialog';
import { currency, fmtDate, localToday, downloadFile, invoiceLabel } from '../lib/utils';

// The Invoices page for practices that bill through MYOB exports: every billable session and
// report entry, by where it's at in MYOB (server/routes/invoices.js /myob-register). Status tiles
// filter the list, like the invoicing software's dashboard.
//   • Tick any row to (re-)export it — a deleted export file can always be made again.
//   • Select all is offered where a bulk action makes sense: Not exported (export) and
//     Unpaid / Part paid (mark paid).
//   • Overdue reports: report invoices still not paid in full N days (Settings, default 14) after
//     the entry date — whatever the dates chosen. The sidebar badge links here (?tile=overdue_reports).
//   • No charge: adjusted to $0 on the appointment's Billing adjustment tab — listed for the
//     record, but never exported or invoiced, so those rows can't be ticked.

const STATUSES = [
  { key: 'not_exported', label: 'Not exported', sub: 'Not in a MYOB file yet', color: 'amber' },
  { key: 'exported',     label: 'Exported',     sub: 'Awaiting invoice number', color: 'purple' },
  { key: 'unpaid',       label: 'Unpaid',       sub: 'Invoiced, nothing paid', color: 'blue' },
  { key: 'part_paid',    label: 'Part paid',    sub: 'Balance still due', color: 'orange' },
  { key: 'paid',         label: 'Paid',         sub: 'Paid in full', color: 'green' },
  { key: 'overdue_reports', label: 'Overdue reports', sub: 'Report invoices unpaid', color: 'red' },
  { key: 'no_charge',    label: 'No charge',    sub: 'Adjusted to $0, not billed', color: 'gray' },
  { key: 'all',          label: 'All',          sub: 'Everything in view', color: 'gray' },
];
const STATUS = Object.fromEntries(STATUSES.map(s => [s.key, s]));
const SELECT_ALL = ['not_exported', 'unpaid', 'part_paid', 'overdue_reports'];
const PAYABLE = ['unpaid', 'part_paid'];

const iso = d => format(d, 'yyyy-MM-dd');
const RANGES = [
  ['this_week', 'This week', () => { const s = startOfWeek(new Date(), { weekStartsOn: 1 }); return [s, endOfWeek(s, { weekStartsOn: 1 })]; }],
  ['last_week', 'Last week', () => { const s = startOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 }); return [s, endOfWeek(s, { weekStartsOn: 1 })]; }],
  ['this_month', 'This month', () => [startOfMonth(new Date()), endOfMonth(new Date())]],
  ['last_month', 'Last month', () => { const m = subMonths(new Date(), 1); return [startOfMonth(m), endOfMonth(m)]; }],
  ['custom', 'Custom range', null],
  ['all', 'All dates', null],
];

export default function MyobRegister() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const canViewClients = !!user?.permissions?.clients;
  const canEditMyob = ['owner', 'admin', 'finance'].includes(user?.role);

  const [range, setRange] = useState('this_week');
  // Appointments after this week haven't happened yet, so they're hidden unless asked for.
  const [includeFuture, setIncludeFuture] = useState(false);
  const endOfThisWeek = iso(endOfWeek(new Date(), { weekStartsOn: 1 }));
  const until = includeFuture ? '' : endOfThisWeek;
  const [custom, setCustom] = useState({ from: localToday(), to: localToday() });
  const [clientFilter, setClientFilter] = useState('');
  const [practFilter, setPractFilter] = useState('');
  const [searchParams] = useSearchParams();
  const [active, setActive] = useState(searchParams.get('tile') || 'all');
  // The sidebar's overdue badge links here with ?tile=overdue_reports — also while already on this page.
  useEffect(() => { if (searchParams.get('tile')) setActive(searchParams.get('tile')); }, [searchParams]);
  const [data, setData] = useState(null);
  const [clients, setClients] = useState([]);
  const [practitioners, setPractitioners] = useState([]);
  const [selected, setSelected] = useState([]);
  const [myobDate, setMyobDate] = useState(localToday());
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [myobEdit, setMyobEdit] = useState(null);
  const [apptModal, setApptModal] = useState(null);

  const [from, to] = useMemo(() => {
    if (range === 'all') return ['', ''];
    if (range === 'custom') return [custom.from, custom.to];
    const [s, e] = RANGES.find(r => r[0] === range)[2]();
    return [iso(s), iso(e)];
  }, [range, custom]);

  // The server returns the tiles' figures for the chosen dates and for all dates, and the rows for
  // the chosen status a page (200) at a time — "Show more" appends the next page.
  const query = extra => {
    const params = new URLSearchParams({ status: active, ...extra });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (until) params.set('until', until);
    if (clientFilter) params.set('client_id', clientFilter);
    if (practFilter) params.set('practitioner_id', practFilter);
    return `/invoices/myob-register?${params}`;
  };
  const load = () => {
    setData(null);
    api.get(query({})).then(r => setData(r.data)).catch(() => setData({ rows: [], summary: {}, total: 0 }));
  };
  const loadMore = () => {
    setBusy('more');
    api.get(query({ offset: data.rows.length }))
      .then(r => setData(d => ({ ...r.data, rows: [...d.rows, ...r.data.rows] })))
      .finally(() => setBusy(''));
  };

  useEffect(() => {
    if (canViewClients) api.get('/clients?active=all').then(r => setClients(r.data));
    api.get('/practitioners?role=practitioner').then(r => setPractitioners(r.data));
  }, []); // lists for the filters, once
  useEffect(() => { load(); setSelected([]); }, [from, to, until, clientFilter, practFilter, active]); // reload on any filter or tile change

  const rows = data?.rows || [];
  const total = data?.total ?? rows.length;
  // Ticked rows can be on pages not loaded yet (select all) — they're all in the chosen tile's
  // status then; on the All tile only loaded rows can be ticked, so their status is known.
  const statusOfSelected = id => rows.find(r => r.id === id)?.myob || active;
  const toggle = id => setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));
  const canSelectAll = SELECT_ALL.includes(active);
  const allTicked = total > 0 && selected.length === total;
  const toggleAll = async () => {
    if (allTicked) return setSelected([]);
    if (rows.length === total) return setSelected(rows.map(r => r.id));
    const { data: d } = await api.get(query({ ids_only: 1 }));
    setSelected(d.ids);
  };
  const canMarkPaid = canEditMyob && selected.length > 0 && selected.every(id => PAYABLE.includes(statusOfSelected(id)));

  const exportMyob = async () => {
    const again = selected.filter(id => statusOfSelected(id) !== 'not_exported').length;
    if (again && !await confirm({
      title: 'Export again?',
      message: `${again === selected.length ? (again === 1 ? 'This row has' : `All ${again} selected rows have`) : `${again} of the ${selected.length} selected rows ${again === 1 ? 'has' : 'have'}`} already been exported to MYOB.\n\nImporting the same rows into MYOB twice creates duplicate invoices — only export them again if the original file was lost and hasn't been imported.`,
      confirmLabel: 'Export anyway',
    })) return;
    setBusy('export');
    try {
      await downloadFile(api, '/invoices/export-myob-appointments', `MYOB_Import_${myobDate}.csv`,
        { method: 'post', data: { appointment_ids: selected, invoice_date: myobDate } });
      setSelected([]);
      load();
    } finally { setBusy(''); }
  };

  const markPaid = async () => {
    if (!await confirm({
      title: 'Mark paid',
      message: `Mark the MYOB invoice${selected.length === 1 ? '' : 's'} of the ${selected.length === 1 ? 'selected row' : `${selected.length} selected rows`} paid in full?\n\nEvery appointment on ${selected.length === 1 ? 'that invoice' : 'those invoices'} is marked paid, and any report that's now fully paid is released to the client.`,
      confirmLabel: 'Mark paid',
    })) return;
    setBusy('paid');
    try {
      const { data: r } = await api.post('/myob-sync/mark-paid', { appointment_ids: selected });
      setNotice(`${r.invoicesUpdated} invoice${r.invoicesUpdated === 1 ? '' : 's'} marked paid (${r.appointmentsUpdated} appointment${r.appointmentsUpdated === 1 ? '' : 's'}).`);
      setSelected([]);
      load();
    } catch (e) {
      setNotice(e.response?.data?.error || 'Could not mark paid');
    } finally { setBusy(''); }
  };

  const openAppt = async id => { const { data: a } = await api.get(`/appointments/${id}`); setApptModal(a); };
  const summary = data?.summary || {};
  const summaryAll = data?.summary_all || {};
  const shownTo = until && (!to || to > until) ? until : to; // the date range actually shown
  const selectCls = 'rounded-lg border border-gray-300 px-2 py-1.5 text-sm';

  return (
    <div className="space-y-4">
      {notice && (
        <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-900">
          <span className="flex-1">{notice}</span>
          <button className="text-green-700 hover:text-green-900" onClick={() => setNotice('')}>Dismiss</button>
        </div>
      )}

      {/* Status tiles — "chosen dates / all dates" (both follow the client and practitioner filters); click one to show just that status. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        {STATUSES.map(s => {
          const t = summary[s.key] || { count: 0, amount: 0 };
          const a = summaryAll[s.key] || { count: 0, amount: 0 };
          const on = active === s.key;
          const dim = on ? 'text-indigo-200' : 'text-gray-400';
          if (s.key === 'overdue_reports') {
            // One figure (it ignores the dates chosen); red while there's anything to chase.
            const alert = !on && t.count > 0;
            return (
              <button key={s.key} onClick={() => setActive(on ? 'all' : s.key)}
                className={`rounded-xl border p-4 text-left transition-all ${on ? 'border-indigo-600 bg-indigo-600 text-white shadow-lg' : alert ? 'border-red-300 bg-red-50 text-red-900 hover:shadow' : 'border-gray-200 bg-white text-gray-800 hover:border-indigo-300 hover:shadow'}`}>
                <div className={`text-2xl font-bold leading-none ${on ? 'text-white' : alert ? 'text-red-700' : 'text-gray-900'}`}>{t.count}</div>
                <div className={`mt-1 text-sm font-semibold ${on ? 'text-indigo-50' : alert ? 'text-red-800' : 'text-gray-700'}`}>{s.label}</div>
                <div className={`text-xs ${on ? 'text-indigo-100' : alert ? 'text-red-600' : 'text-gray-400'}`}>Unpaid {t.days ?? 14}+ days, any date</div>
                <div className={`mt-2 text-sm font-semibold ${on ? 'text-white' : alert ? 'text-red-700' : 'text-gray-600'}`}>{currency(t.amount)} <span className="text-xs font-medium">still due</span></div>
              </button>
            );
          }
          return (
            <button key={s.key} onClick={() => setActive(on && s.key !== 'all' ? 'all' : s.key)}
              className={`rounded-xl border p-4 text-left transition-all ${on ? 'border-indigo-600 bg-indigo-600 text-white shadow-lg' : 'border-gray-200 bg-white text-gray-800 hover:border-indigo-300 hover:shadow'}`}>
              <div className={`text-2xl font-bold leading-none ${on ? 'text-white' : 'text-gray-900'}`}>
                {t.count}<span className={`text-base font-semibold ${dim}`}> / {a.count}</span>
              </div>
              <div className={`mt-1 text-sm font-semibold ${on ? 'text-indigo-50' : 'text-gray-700'}`}>{s.label}</div>
              <div className={`text-xs ${on ? 'text-indigo-100' : 'text-gray-400'}`}>{s.sub}</div>
              <div className={`mt-2 text-sm font-semibold ${on ? 'text-white' : 'text-gray-600'}`}>
                {currency(t.amount)}<span className={`font-medium ${dim}`}> / {currency(a.amount)}</span>
                {s.key === 'part_paid' && (t.due || a.due) ? <span className={`block text-xs font-medium ${on ? 'text-indigo-100' : 'text-orange-600'}`}>{currency(t.due || 0)} / {currency(a.due || 0)} still due</span> : null}
              </div>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select className={selectCls} value={range} onChange={e => setRange(e.target.value)} title="Dates">
          {RANGES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        {range === 'custom' ? (
          <span className="flex items-center gap-2 text-sm text-gray-600">
            <input type="date" className={selectCls} value={custom.from} onChange={e => setCustom(c => ({ ...c, from: e.target.value }))} />
            to
            <input type="date" className={selectCls} value={custom.to} onChange={e => setCustom(c => ({ ...c, to: e.target.value }))} />
          </span>
        ) : from ? (
          <span className="text-sm text-gray-500">{fmtDate(from)} – {fmtDate(shownTo)}</span>
        ) : until ? (
          <span className="text-sm text-gray-500">Up to {fmtDate(until)}</span>
        ) : null}
        <label className="flex items-center gap-1.5 text-sm text-gray-600" title="Appointments after this week haven't happened yet">
          <input type="checkbox" className="accent-indigo-600" checked={includeFuture} onChange={e => setIncludeFuture(e.target.checked)} />
          Include future appointments
        </label>
        <span className="text-xs text-gray-400">Tiles: chosen dates / all dates</span>
        {canViewClients && (
          <select className={`${selectCls} ml-auto`} value={clientFilter} onChange={e => setClientFilter(e.target.value)}>
            <option value="">All clients</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}{!c.active && ' (inactive)'}</option>)}
          </select>
        )}
        <select className={`${selectCls} ${canViewClients ? '' : 'ml-auto'}`} value={practFilter} onChange={e => setPractFilter(e.target.value)}>
          <option value="">All practitioners</option>
          {practitioners.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
        </select>
      </div>

      {/* List */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        {data === null ? <p className="p-10 text-center text-sm text-gray-400">Loading…</p>
          : !rows.length ? <p className="p-10 text-center text-sm text-gray-400">{active === 'overdue_reports' ? 'No overdue report invoices.' : `Nothing ${active === 'all' ? '' : `${STATUS[active].label.toLowerCase()} `}for these filters.`}</p>
          : (
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  <th className="w-10 px-4 py-3">
                    {canSelectAll && <input type="checkbox" className="accent-indigo-600" checked={allTicked} onChange={toggleAll} title="Select all" />}
                  </th>
                  {['Date', 'Client', 'Practitioner', 'Service', 'Amount', 'Funder', 'MYOB invoice', 'Status'].map(h => (
                    <th key={h} className={`px-4 py-3 text-xs font-medium uppercase text-gray-500 ${h === 'Amount' ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(r => {
                  const st = STATUS[r.myob];
                  const number = r.myob_invoice_number || null;
                  return (
                    <tr key={r.id} className={selected.includes(r.id) ? 'bg-indigo-50/40' : 'hover:bg-gray-50'}>
                      <td className="px-4 py-3">{r.myob !== 'no_charge' && <input type="checkbox" className="accent-indigo-600" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} />}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm">
                        <button onClick={() => openAppt(r.id)} className="text-gray-700 hover:text-indigo-600 hover:underline" title="View appointment">{fmtDate(r.start_time)}</button>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {r.client_name}
                        {r.status === 'cancelled' && r.late_cancel_billable ? <span className="ml-1.5"><Badge color="amber">Cancelled — {r.late_cancel_pct}%</Badge></span> : null}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.practitioner_color }} />{r.practitioner_name}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {r.services || '—'}
                        {r.billable_report_id && <span className="ml-1.5"><Badge color="teal" title="Billed from the client's Reports tab">Report · {r.report_progress_pct}%</Badge></span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium text-gray-900">{currency(r.amount)}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{r.funds_manager_name || <span className="text-gray-300">—</span>}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm">
                        {r.myob === 'no_charge' ? <span className="text-gray-300">—</span> : <button type="button" disabled={!canEditMyob} onClick={() => setMyobEdit(r)}
                          title={canEditMyob ? 'Edit the MYOB invoice number or payment' : undefined}
                          className={`rounded font-mono text-xs ${canEditMyob ? '-m-1 p-1 hover:bg-indigo-50' : 'cursor-default'}`}>
                          {number ? invoiceLabel(number) : <span className={canEditMyob ? 'font-sans text-indigo-600' : 'font-sans text-gray-300'}>{canEditMyob ? 'Add' : '—'}</span>}
                        </button>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm">
                        <Badge color={st.color}>{st.label}</Badge>
                        {r.myob === 'part_paid' && <span className="ml-1.5 text-xs text-orange-700">{currency(r.myob_amount_due)} due</span>}
                        {r.myob === 'exported' && <span className="ml-1.5 text-xs text-gray-400">{fmtDate(r.myob_exported_at)}</span>}
                        {r.overdue_days != null && <span className="ml-1.5"><Badge color="red" title="Report invoice not paid in full">Overdue · {r.overdue_days} days</Badge></span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
      </div>

      {/* Actions for the ticked rows */}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-3 text-sm text-gray-500">
            {selected.length} of {total} selected
            {rows.length < total && (
              <Button size="sm" variant="secondary" onClick={loadMore} disabled={busy === 'more'}>
                {busy === 'more' ? 'Loading…' : `Show more (${rows.length} of ${total} shown)`}
              </Button>
            )}
          </span>
          {selected.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm text-gray-600">Invoice date:</label>
              <input type="date" className={selectCls} value={myobDate} onChange={e => setMyobDate(e.target.value)} />
              <Button onClick={exportMyob} disabled={busy === 'export'}>
                <FileSpreadsheet className="h-4 w-4" /> {busy === 'export' ? 'Exporting…' : 'Export MYOB CSV'}
              </Button>
              {canMarkPaid && (
                <Button variant="secondary" onClick={markPaid} disabled={busy === 'paid'}>
                  <CheckCircle className="h-4 w-4" /> {busy === 'paid' ? 'Marking…' : 'Mark paid'}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {myobEdit && (
        <MyobInvoiceModal appointment={myobEdit} label={`${myobEdit.client_name}, ${fmtDate(myobEdit.start_time)}`}
          onClose={() => setMyobEdit(null)} onSaved={() => { setMyobEdit(null); load(); }} />
      )}
      {apptModal && (
        <AppointmentModal appointment={apptModal} onClose={() => setApptModal(null)} onSaved={() => { setApptModal(null); load(); }} />
      )}
    </div>
  );
}
