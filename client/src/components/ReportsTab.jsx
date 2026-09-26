import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Upload, Clock, Mail, Unlock, Trash2, RotateCw, Ban, FileText, Download, Link2, Check, PenLine, Lock } from 'lucide-react';
import api from '../lib/api';
import Button from './ui/Button';
import Badge from './ui/Badge';
import Input from './ui/Input';
import Modal from './ui/Modal';
import ReportNotifyModal from './ReportNotifyModal';
import { useAuth } from '../context/AuthContext';
import { currency, localToday, downloadFile } from '../lib/utils';
import { useConfirm } from './ui/ConfirmDialog';

// Client → Reports tab: bill a report in chunks while writing it, upload the finished copy, and
// let the system hold it back (blurred draft) until every invoice for it is paid.
// Server side: server/routes/billableReports.js + server/services/reportRelease.js.

const fmtDMY = d => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');
const isAdmin = user => ['owner', 'admin'].includes(user?.role);
// Same cap as the server (reportRedact.js maxVisiblePages): half the pages, rounded down, max 10.
const maxShownPages = pageCount => (pageCount == null ? 10 : Math.min(10, Math.floor(pageCount / 2)));
const pagesLabel = n => `${n} page${n === 1 ? '' : 's'}`;

async function countPdfPages(file) {
  const { PDFDocument } = await import('pdf-lib'); // only loaded when someone uploads a PDF
  const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true, updateMetadata: false });
  return doc.getPageCount();
}

const isAccounts = user => ['owner', 'admin', 'finance'].includes(user?.role);

function statusBadge(report) {
  if (report.status === 'released') return <Badge color="green">Released to client</Badge>;
  if (report.status === 'draft_sent') return <Badge color="amber" title={report.release_blocker || ''}>Draft sent · {report.release_blocker || 'ready to release'}</Badge>;
  if (report.status === 'uploaded') return <Badge color="orange">Uploaded · client not emailed yet</Badge>;
  return <Badge color="blue">In progress</Badge>;
}

function entryStatus(e) {
  if (e.voided) return <span className="text-gray-400">Voided</span>;
  if (!e.myob_exported_at) return <span className="text-red-600">Not sent to accounts</span>;
  if (!e.myob_invoice_number) return <span className="text-gray-500">Sent to accounts</span>;
  if (e.myob_status === 'closed') return <span className="text-green-700">Paid</span>;
  if (e.myob_status === 'open') return <span className="text-amber-700">Open · {currency(e.myob_amount_due ?? 0)} due</span>;
  return <span className="text-gray-500">Invoiced · awaiting status</span>;
}

function NewReportModal({ clientId, onClose, onCreated }) {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [fundingPeriods, setFundingPeriods] = useState([]);
  const [fundingTypes, setFundingTypes] = useState([]);
  const [fundingPeriodId, setFundingPeriodId] = useState('');
  const [services, setServices] = useState([]);
  const [serviceId, setServiceId] = useState('');
  const [practitioners, setPractitioners] = useState([]);
  const [practitionerId, setPractitionerId] = useState(user?.id || '');
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get(`/funding-periods?client_id=${clientId}`).then(r => {
      const fps = r.data || [];
      setFundingPeriods(fps);
      const today = localToday();
      const current = fps.filter(fp => (!fp.start_date || fp.start_date <= today) && (!fp.end_date || fp.end_date >= today));
      if (current.length === 1) setFundingPeriodId(String(current[0].id));
      else if (fps.length === 1) setFundingPeriodId(String(fps[0].id));
    }).catch(() => {});
    api.get('/funding-types').then(r => setFundingTypes(r.data || [])).catch(() => {});
    api.get('/report-doc-templates').then(r => setTemplates(r.data || [])).catch(() => {});
    if (isAdmin(user)) api.get('/practitioners?role=practitioner').then(r => setPractitioners(r.data || [])).catch(() => {});
  }, []);

  const fp = fundingPeriods.find(f => String(f.id) === String(fundingPeriodId));
  const fundingTypeId = fp ? fundingTypes.find(ft => ft.name === fp.funding_type)?.id : null;

  useEffect(() => {
    if (!fundingTypeId) { setServices([]); return; }
    api.get(`/funding-types/${fundingTypeId}/service-rates`, { params: { date: localToday() } }).then(r => {
      const list = r.data || [];
      setServices(list);
      // Pre-pick the obvious one — the practice bills reports under a "report writing" service.
      const guess = list.filter(s => /report/i.test(s.service_name));
      if (guess.length === 1) setServiceId(String(guess[0].service_id));
    }).catch(() => setServices([]));
  }, [fundingTypeId]);

  const save = async () => {
    setError('');
    if (!title.trim()) return setError('Enter a report title');
    if (!fundingPeriodId) return setError('Choose the funding this report is billed to');
    if (!serviceId) return setError('Choose the service');
    setSaving(true);
    try {
      const { data } = await api.post('/billable-reports', {
        client_id: clientId, title: title.trim(), funding_period_id: Number(fundingPeriodId),
        service_id: Number(serviceId), practitioner_id: isAdmin(user) ? Number(practitionerId) || undefined : undefined,
        template_id: templateId ? Number(templateId) : undefined,
      });
      onCreated(data);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to start report');
    } finally {
      setSaving(false);
    }
  };

  const selectCls = 'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none';
  return (
    <Modal title="Start a report" onClose={onClose}>
      <div className="space-y-4">
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Input label="Report title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Functional capacity assessment" autoFocus />
        {isAdmin(user) && (
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Practitioner</label>
            <select className={selectCls} value={practitionerId} onChange={e => setPractitionerId(e.target.value)}>
              <option value={user.id}>{user.first_name} {user.last_name} (me)</option>
              {practitioners.filter(p => p.id !== user.id).map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
            </select>
          </div>
        )}
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700">Funding</label>
          <select className={selectCls} value={fundingPeriodId} onChange={e => { setFundingPeriodId(e.target.value); setServiceId(''); }}>
            <option value="">Choose…</option>
            {fundingPeriods.map(f => (
              <option key={f.id} value={f.id}>{f.funding_type}{f.start_date ? ` (${fmtDMY(f.start_date)} – ${f.end_date ? fmtDMY(f.end_date) : 'ongoing'})` : ''}</option>
            ))}
          </select>
          {!fundingPeriods.length && <p className="text-xs text-amber-700">This client has no funding set up yet — add it on the Funding tab first.</p>}
        </div>
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700">Service</label>
          <select className={selectCls} value={serviceId} onChange={e => setServiceId(e.target.value)} disabled={!fundingTypeId}>
            <option value="">Choose…</option>
            {services.map(s => <option key={s.service_id} value={s.service_id}>{s.service_name} — {currency(s.rate)}/{s.unit || 'hr'}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700">Write it in the system using</label>
          <select className={selectCls} value={templateId} onChange={e => setTemplateId(e.target.value)}>
            <option value="">Blank page</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {templateId && templates.find(t => String(t.id) === templateId)?.description && (
            <p className="text-xs text-gray-500">{templates.find(t => String(t.id) === templateId).description}</p>
          )}
          <p className="text-xs text-gray-500">You can still upload a finished report file instead.</p>
        </div>
        <p className="text-xs text-gray-500">Nothing is billed yet. Use “Log hours” on the report each time you work on it.</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Starting…' : 'Start report'}</Button>
        </div>
      </div>
    </Modal>
  );
}

function LogHoursModal({ report, onClose, onSaved }) {
  const [date, setDate] = useState(localToday());
  const [hours, setHours] = useState('');
  const [pct, setPct] = useState('');
  const [rate, setRate] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const lastPct = report.progress_pct || 0;

  useEffect(() => {
    setRate(null);
    if (!date) return;
    // Rate on the chosen date under the report's funding — same lookup the server bills with.
    Promise.all([api.get('/funding-types'), api.get(`/funding-periods?client_id=${report.client_id}`)]).then(([ft, fps]) => {
      const fp = (fps.data || []).find(f => f.id === report.funding_period_id);
      const ftId = fp && (ft.data || []).find(t => t.name === fp.funding_type)?.id;
      if (!ftId) return setRate(undefined);
      return api.get(`/funding-types/${ftId}/service-rates`, { params: { date } }).then(r => {
        const row = (r.data || []).find(s => s.service_id === report.service_id);
        setRate(row ? Number(row.rate) : undefined);
      });
    }).catch(() => setRate(undefined));
  }, [date]);

  const hoursNum = Math.round(Number(hours) * 100) / 100;
  const amount = rate && hoursNum > 0 ? hoursNum * rate : null;

  const save = async () => {
    setError('');
    if (!(hoursNum > 0)) return setError('Enter the hours worked');
    const p = Number(pct);
    if (!Number.isInteger(p) || p < 1 || p > 100) return setError('Enter how complete the report is now, 1–100%');
    if (p < lastPct) return setError(`The report was already ${lastPct}% complete — enter the new total`);
    setSaving(true);
    try {
      const { data } = await api.post(`/billable-reports/${report.id}/entries`, { service_date: date, hours: hoursNum, progress_pct: p });
      onSaved(data.report, data.sendError);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to bill hours');
      setSaving(false);
    }
  };

  return (
    <Modal title={`Log hours — ${report.title}`} onClose={onClose}>
      <div className="space-y-4">
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <Input label="Service date" type="date" value={date} max={localToday()} onChange={e => setDate(e.target.value)} />
          <Input label="Hours worked" type="number" min="0.25" step="0.25" value={hours} onChange={e => setHours(e.target.value)} placeholder="2.5" autoFocus />
          <div className="space-y-1">
            <Input label="Report now complete (%)" type="number" min={Math.max(1, lastPct)} max="100" step="1" value={pct}
              onChange={e => setPct(e.target.value)} placeholder={lastPct ? `more than ${lastPct}` : '50'} />
            <p className="text-xs text-gray-500">The running total, not this entry's share.{lastPct ? ` Currently ${lastPct}%.` : ''}</p>
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Rate</label>
            <p className="py-2 text-sm text-gray-700">
              {rate === null ? '…' : rate === undefined ? <span className="text-red-600">No rate on this date</span> : `${currency(rate)} / hr`}
            </p>
          </div>
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">
          {amount != null ? <>Bills <strong>{currency(amount)}</strong>. </> : null}
          It's emailed to accounts as a MYOB import straight away and can't be edited afterwards. The invoice line will say “Report: {report.title} - {pct || '…'}% complete”.
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={saving || rate === undefined}>{saving ? 'Sending…' : 'Bill and send'}</Button>
        </div>
      </div>
    </Modal>
  );
}

function InvoiceNumberCell({ report, entry, onChanged }) {
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  if (entry.voided || !entry.myob_exported_at) return <span className="text-gray-400">—</span>;
  if (!isAccounts(user)) return <span>{entry.myob_invoice_number || <span className="text-gray-400">pending</span>}</span>;
  if (!editing) {
    return (
      <button className="text-left hover:text-indigo-600" title="Set MYOB invoice number"
        onClick={() => { setValue(entry.myob_invoice_number || ''); setError(''); setEditing(true); }}>
        {entry.myob_invoice_number || <span className="text-indigo-600">Add inv #</span>}
      </button>
    );
  }
  const save = async () => {
    try {
      const { data } = await api.patch(`/billable-reports/${report.id}/entries/${entry.id}/invoice-number`, { invoice_no: value.trim() || null });
      setEditing(false);
      onChanged(data);
    } catch (e) { setError(e.response?.data?.error || 'Failed'); }
  };
  return (
    <div>
      <input className="w-24 rounded border border-gray-300 px-1.5 py-0.5 text-sm" value={value} autoFocus
        onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }} onBlur={save} />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function ReportCard({ report, client, onChanged, onDeleted, justCommitted }) {
  const confirm = useConfirm();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [logging, setLogging] = useState(false);
  const [notifying, setNotifying] = useState(false);
  // Arriving from the editor right after a commit: the client needs the new version's link.
  useEffect(() => {
    if (!justCommitted || !report.file) return;
    setMessage({ type: 'ok', text: `Version ${justCommitted} committed and shared as a blurred draft. Email the client the link.` });
    setNotifying(true);
  }, [justCommitted]);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null); // { type: 'error'|'warn'|'ok', text }
  const fileRef = useRef();
  const [pendingFile, setPendingFile] = useState(null); // picked, waiting for the pages-shown choice
  const [pagesDraft, setPagesDraft] = useState(1);
  const [pendingPageCount, setPendingPageCount] = useState(null); // null = counting/unknown
  const [editingPages, setEditingPages] = useState(false);
  const [copied, setCopied] = useState(false);
  const mine = isAdmin(user) || report.practitioner_id === user?.id;
  const released = report.status === 'released';

  const act = async (key, fn) => {
    setBusy(key); setMessage(null);
    try { await fn(); } catch (e) { setMessage({ type: 'error', text: e.response?.data?.error || 'Something went wrong' }); }
    finally { setBusy(''); }
  };

  const reload = async () => {
    const { data } = await api.get(`/billable-reports?client_id=${report.client_id}`);
    const fresh = data.find(r => r.id === report.id);
    if (fresh) onChanged(fresh);
  };

  // Same "pages shown in full" choice as sharing from the Files tab — asked before uploading a
  // PDF; images have no pages, so they upload straight away.
  const pickFile = e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (f.type !== 'application/pdf') return uploadFile(f, 0);
    setPendingPageCount(null);
    setPagesDraft(report.file?.report_visible_pages ?? 1);
    setPendingFile(f);
    // Counted in the browser before uploading, so the choice can't exceed what the PDF has. If it
    // can't be read here (e.g. an unusual PDF), the server still caps it when making the preview.
    countPdfPages(f).then(n => {
      setPendingPageCount(n);
      setPagesDraft(d => Math.min(d, maxShownPages(n)));
    }).catch(() => {});
  };

  const uploadFile = (f, visiblePages) => {
    setPendingFile(null);
    act('upload', async () => {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('visible_pages', String(visiblePages));
      const { data } = await api.post(`/billable-reports/${report.id}/upload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      onChanged(data);
      setNotifying(true);
    });
  };

  const saveVisiblePages = () => act('pages', async () => {
    await api.patch(`/client-files/${report.file.id}/report-visible-pages`, { visible_pages: pagesDraft });
    setEditingPages(false);
    await reload();
    setMessage({ type: 'ok', text: `The client's preview now shows ${pagesDraft} page${pagesDraft === 1 ? '' : 's'} in full.` });
  });

  // The client's link — shows the blurred draft until release, then the real report, same URL.
  const copyLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/report/${report.file.report_view_token}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const clampPages = (v, pageCount) => Math.max(0, Math.min(maxShownPages(pageCount), parseInt(v, 10) || 0));

  const resend = entry => act(`resend-${entry.id}`, async () => {
    const { data } = await api.post(`/billable-reports/${report.id}/entries/${entry.id}/resend`);
    onChanged(data);
    setMessage({ type: 'ok', text: `${entry.ref} emailed to accounts` });
  });

  const voidEntry = async entry => {
    const reason = await confirm({ title: 'Void entry', message: `Void ${entry.ref} (${entry.hours} hrs, ${currency(entry.amount)})?\n\nIf it's already invoiced in MYOB, raise a credit note there too.`, input: { label: 'Reason', required: true, multiline: true }, confirmLabel: 'Void entry', danger: true });
    if (!reason) return;
    act(`void-${entry.id}`, async () => {
      const { data } = await api.post(`/billable-reports/${report.id}/entries/${entry.id}/void`, { reason });
      onChanged(data);
    });
  };

  const releaseNow = async () => {
    const warn = report.release_blocker ? `\n\nNot ready yet: ${report.release_blocker}.` : '';
    if (!await confirm({ title: 'Release report', message: `Release "${report.title}" to the client now?${warn}\n\nThe client's link will show the full report${report.notify_to.length ? ' and they will be emailed' : ''}.`, confirmLabel: 'Release' })) return;
    act('release', async () => {
      const { data } = await api.post(`/billable-reports/${report.id}/release`);
      onChanged(data);
    });
  };

  const remove = async () => {
    // A report started from a template (or written in) has a draft that goes with it.
    const written = report.draft
      ? `\n\nThe report written in the system${report.draft.word_count ? ` (${report.draft.word_count.toLocaleString()} words)` : ''} will be deleted too and can't be recovered.`
      : '';
    if (!await confirm({ title: 'Delete report', message: `Delete "${report.title}"? Nothing has been billed on it yet.${written}`, confirmLabel: 'Delete', danger: true })) return;
    act('delete', async () => { await api.delete(`/billable-reports/${report.id}`); onDeleted(report.id); });
  };

  const liveEntries = report.entries.filter(e => !e.voided);
  const notSent = liveEntries.filter(e => !e.myob_exported_at).length;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900">{report.title}</h3>
          <p className="text-xs text-gray-500">
            {report.service_name} · {report.practitioner_name} · {report.funding_type} · started {fmtDMY(report.created_at)}
          </p>
        </div>
        {statusBadge(report)}
      </div>

      {message && (
        <p className={`rounded-lg px-3 py-2 text-sm ${message.type === 'error' ? 'bg-red-50 text-red-700' : message.type === 'warn' ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-700'}`}>{message.text}</p>
      )}

      <div>
        <div className="flex justify-between text-xs text-gray-600 mb-1">
          <span>Progress</span>
          <span>{report.progress_pct}% · {report.total_hours.toFixed(2)} hrs · {currency(report.total_amount)}</span>
        </div>
        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
          <div className="h-full bg-indigo-500" style={{ width: `${report.progress_pct}%` }} />
        </div>
      </div>

      {report.entries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th className="py-1.5 pr-3 font-medium">Service date</th>
                <th className="py-1.5 pr-3 font-medium">Hours</th>
                <th className="py-1.5 pr-3 font-medium">Total %</th>
                <th className="py-1.5 pr-3 font-medium">Amount</th>
                <th className="py-1.5 pr-3 font-medium">MYOB inv #</th>
                <th className="py-1.5 pr-3 font-medium">Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {report.entries.map(e => (
                <tr key={e.id} className={`border-t border-gray-100 ${e.voided ? 'text-gray-400 line-through decoration-gray-300' : ''}`}>
                  <td className="py-2 pr-3" title={e.ref}>{fmtDMY(e.start_time)}</td>
                  <td className="py-2 pr-3">{Number(e.hours).toFixed(2)}</td>
                  <td className="py-2 pr-3">{e.report_progress_pct}%</td>
                  <td className="py-2 pr-3">{currency(e.amount)}</td>
                  <td className="py-2 pr-3 no-underline"><InvoiceNumberCell report={report} entry={e} onChanged={onChanged} /></td>
                  <td className="py-2 pr-3">{entryStatus(e)}</td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {!e.voided && !e.myob_exported_at && (mine || isAccounts(user)) && (
                      <button className="text-indigo-600 hover:text-indigo-800 text-xs mr-3 inline-flex items-center gap-1" disabled={!!busy} onClick={() => resend(e)}>
                        <RotateCw className="h-3 w-3" /> Resend
                      </button>
                    )}
                    {!e.voided && isAccounts(user) && (
                      <button className="text-gray-400 hover:text-red-600" title="Void this entry" disabled={!!busy} onClick={() => voidEntry(e)}>
                        <Ban className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {notSent > 0 && <p className="mt-1 text-xs text-red-600">{notSent} entr{notSent === 1 ? 'y hasn’t' : 'ies haven’t'} reached accounts — use Resend, or export it from the Invoices page.</p>}
        </div>
      )}

      {report.file && (
        <div className="flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-2 text-sm">
          <FileText className="h-4 w-4 text-gray-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-gray-800">{report.file.original_name}</p>
            <p className="text-xs text-gray-500">
              {released ? `Released ${fmtDMY(report.released_at)}` : report.status === 'draft_sent' ? `Blurred draft sent to ${report.notify_to.join(', ')}` : 'Uploaded — the client hasn’t been emailed the draft yet'}
              {!released && report.file.mime_type === 'application/pdf' && (report.file.report_page_count
                ? ` · ${report.file.report_visible_pages ?? 0} of ${pagesLabel(report.file.report_page_count)} shown in full`
                : ` · ${pagesLabel(report.file.report_visible_pages ?? 0)} shown in full`)}
            </p>
          </div>
          {mine && !released && report.file.mime_type === 'application/pdf' && !editingPages && (
            <button className="text-xs text-indigo-600 hover:text-indigo-800 whitespace-nowrap"
              onClick={() => { setPagesDraft(report.file.report_visible_pages ?? 1); setEditingPages(true); }}>
              Edit pages shown
            </button>
          )}
          {report.file.report_view_token && (
            <button className={`inline-flex items-center gap-1 text-xs whitespace-nowrap ${copied ? 'text-green-600' : 'text-indigo-600 hover:text-indigo-800'}`}
              title="Copy the client's preview link" onClick={copyLink}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />} {copied ? 'Copied' : 'Copy link'}
            </button>
          )}
          <button className="text-gray-400 hover:text-gray-700" title="Download" onClick={() => downloadFile(api, `/client-files/${report.file.id}/download`, report.file.original_name)}>
            <Download className="h-4 w-4" />
          </button>
        </div>
      )}

      {editingPages && report.file && (
        <div className="flex items-center gap-2 rounded-lg bg-gray-50 border border-gray-200 p-2">
          <label className="text-xs font-medium text-gray-600">Pages to show in full</label>
          <input type="number" min={0} max={maxShownPages(report.file.report_page_count)} value={pagesDraft}
            onChange={e => setPagesDraft(clampPages(e.target.value, report.file.report_page_count))}
            className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none" />
          {report.file.report_page_count && <span className="text-xs text-gray-500">of {pagesLabel(report.file.report_page_count)} (up to {maxShownPages(report.file.report_page_count)})</span>}
          <Button size="sm" variant="ghost" onClick={() => setEditingPages(false)}>Cancel</Button>
          <Button size="sm" onClick={saveVisiblePages} disabled={busy === 'pages'}>{busy === 'pages' ? 'Saving…' : 'Save'}</Button>
        </div>
      )}

      {report.draft && (
        <button onClick={() => navigate(`/clients/${report.client_id}/reports/${report.id}/write`)}
          className="flex w-full items-center gap-3 rounded-lg bg-indigo-50/60 px-3 py-2 text-left text-sm hover:bg-indigo-50">
          {report.doc_locked ? <Lock className="h-4 w-4 text-indigo-500 shrink-0" /> : <PenLine className="h-4 w-4 text-indigo-500 shrink-0" />}
          <span className="flex-1 text-gray-800">
            Written in the system · {(report.draft.word_count || 0).toLocaleString()} words
            {report.versions?.[0] && (report.doc_locked
              ? ` · version ${report.versions[0].version} committed, locked`
              : ` · revising version ${report.versions[0].version}`)}
          </span>
          <span className="text-xs text-gray-500">
            {report.doc_locked && report.versions?.[0]
              ? `committed ${new Date(report.versions[0].committed_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`
              : `last saved ${new Date(report.draft.updated_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}${report.draft.updated_by_name ? ` by ${report.draft.updated_by_name}` : ''}`}
          </span>
        </button>
      )}

      <div className="flex flex-wrap gap-2">
        {/* A written report stays reachable after release — unlocking it there is how it's revised. */}
        {mine && (report.draft || !released) && (
          <Button size="sm" variant="secondary" onClick={() => navigate(`/clients/${report.client_id}/reports/${report.id}/write`)}>
            <PenLine className="h-3.5 w-3.5" /> {report.doc_locked ? 'Open report' : report.draft ? 'Continue writing' : 'Write report'}
          </Button>
        )}
        {mine && !released && report.progress_pct < 100 && (
          <Button size="sm" onClick={() => setLogging(true)}><Clock className="h-3.5 w-3.5" /> Log hours</Button>
        )}
        {mine && !released && (
          <Button size="sm" variant="secondary" onClick={() => fileRef.current.click()} disabled={busy === 'upload'}>
            <Upload className="h-3.5 w-3.5" /> {busy === 'upload' ? 'Uploading…' : report.file ? 'Replace report' : 'Upload final report'}
          </Button>
        )}
        {mine && report.file && (
          <Button size="sm" variant="secondary" onClick={() => setNotifying(true)}>
            <Mail className="h-3.5 w-3.5" /> {report.status === 'uploaded' ? 'Email draft to client' : 'Email client again'}
          </Button>
        )}
        {isAdmin(user) && report.file && !released && (
          <Button size="sm" variant="ghost" onClick={releaseNow} disabled={busy === 'release'}><Unlock className="h-3.5 w-3.5" /> Release now</Button>
        )}
        {mine && report.entries.length === 0 && !report.file && (
          <Button size="sm" variant="ghost" onClick={remove}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
        )}
        <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={pickFile} />
      </div>

      {pendingFile && (
        <Modal title={report.file ? 'Replace report' : 'Upload final report'} onClose={() => setPendingFile(null)}>
          <div className="space-y-4">
            <p className="text-sm text-gray-600 truncate">{pendingFile.name}</p>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Pages to show in full</label>
              <div className="flex items-center gap-2">
                <input type="number" min={0} max={maxShownPages(pendingPageCount)} value={pagesDraft} autoFocus
                  onChange={e => setPagesDraft(clampPages(e.target.value, pendingPageCount))}
                  className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
                <span className="text-sm text-gray-600">
                  {pendingPageCount == null ? 'Counting pages…' : `of ${pagesLabel(pendingPageCount)} — up to ${maxShownPages(pendingPageCount)} (half) can be shown`}
                </span>
              </div>
              <p className="text-xs text-gray-500">The client sees these first pages clearly (still watermarked “draft”) so they know the report is theirs and finished. Every other page stays blurred until it’s released.</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setPendingFile(null)}>Cancel</Button>
              <Button size="sm" onClick={() => uploadFile(pendingFile, pagesDraft)}>Upload</Button>
            </div>
          </div>
        </Modal>
      )}
      {logging && (
        <LogHoursModal report={report} onClose={() => setLogging(false)} onSaved={(data, sendError) => {
          setLogging(false);
          onChanged(data);
          setMessage(sendError
            ? { type: 'warn', text: `Hours saved, but the email to accounts failed: ${sendError}. Use Resend once it's fixed.` }
            : { type: 'ok', text: 'Hours billed and emailed to accounts.' });
        }} />
      )}
      {notifying && report.file && (
        <ReportNotifyModal client={client} file={report.file} onClose={() => setNotifying(false)} onSent={async () => {
          setNotifying(false);
          await reload();
          setMessage({ type: 'ok', text: 'Client emailed.' });
        }} />
      )}
    </div>
  );
}

export default function ReportsTab({ clientId, client }) {
  const [reports, setReports] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = () => api.get(`/billable-reports?client_id=${clientId}`).then(r => setReports(r.data)).catch(() => setReports([]));
  useEffect(() => { load(); }, [clientId]);

  const replace = updated => setReports(rs => rs.map(r => (r.id === updated.id ? updated : r)));

  // ?notify=<report id>&committed=<version> — set by the editor after a commit.
  const [searchParams, setSearchParams] = useSearchParams();
  const notifyId = Number(searchParams.get('notify')) || null;
  const committedVersion = searchParams.get('committed');
  useEffect(() => {
    if (!notifyId || !reports) return;
    const next = new URLSearchParams(searchParams); next.delete('notify'); next.delete('committed');
    setSearchParams(next, { replace: true }); // don't reopen on refresh
  }, [notifyId, reports]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Bill report writing as you go. The finished report stays blurred for the client until every invoice for it is paid.</p>
        <Button size="sm" onClick={() => setCreating(true)}><Plus className="h-3.5 w-3.5" /> Start report</Button>
      </div>
      {reports === null ? (
        <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
      ) : reports.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">No reports yet.</p>
      ) : (
        reports.map(r => <ReportCard key={r.id} report={r} client={client} onChanged={replace} onDeleted={id => setReports(rs => rs.filter(x => x.id !== id))}
          justCommitted={r.id === notifyId ? committedVersion : null} />)
      )}
      {creating && (
        <NewReportModal clientId={clientId} onClose={() => setCreating(false)} onCreated={r => { setCreating(false); setReports(rs => [r, ...(rs || [])]); }} />
      )}
    </div>
  );
}
