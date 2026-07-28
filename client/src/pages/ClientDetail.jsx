import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { ArrowLeft, Plus, Pencil, Trash2, AlertTriangle, Upload, Download, File, X, UserX, UserCheck } from 'lucide-react';
import api from '../lib/api';
import AddressAutocomplete from '../components/AddressAutocomplete';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Input from '../components/ui/Input';
import SearchSelect from '../components/ui/SearchSelect';
import { EmbeddedCalendar } from '../components/CalendarViews';
import { localToday, fmtDateTime, fmtDateOnly, downloadFile, currency } from '../lib/utils';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import AgreementPricingTable from '../components/AgreementPricingTable';
import SessionNoteEmailModal from '../components/SessionNoteEmailModal';
import EntityAuditLog from '../components/EntityAuditLog';

const AGREEMENT_STATUS_COLOR = {
  draft: 'bg-gray-100 text-gray-600', sent: 'bg-blue-100 text-blue-700', viewed: 'bg-amber-100 text-amber-700',
  signed: 'bg-green-100 text-green-700', declined: 'bg-red-100 text-red-700', voided: 'bg-gray-100 text-gray-400',
};

function AgreementsTab({ clientId }) {
  const { user } = useAuth();
  const canCreateAgreement = !!user?.permissions?.clients;
  const { timezone } = useSettings();
  const [agreements, setAgreements] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [newTemplateId, setNewTemplateId] = useState('');
  const [activeId, setActiveId] = useState(null);
  const [active, setActive] = useState(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [agreementError, setAgreementError] = useState('');
  const [meta, setMeta] = useState({ start_date: '', end_date: '', budget_amount: '', reminder_end_date: '' });
  const [savingMeta, setSavingMeta] = useState(false);
  const [fundingPeriods, setFundingPeriods] = useState([]);
  const [spend, setSpend] = useState(null);
  const [reminderDurationDays, setReminderDurationDays] = useState(10);
  const [savingReminderEndDate, setSavingReminderEndDate] = useState(false);
  const pricingTableRef = useRef();

  const load = () => api.get(`/agreements?client_id=${clientId}`).then(r => setAgreements(r.data));
  useEffect(() => {
    load();
    api.get('/templates?type=agreement').then(r => setTemplates(r.data));
    api.get(`/funding-periods?client_id=${clientId}`).then(r => setFundingPeriods(r.data)).catch(() => {});
    api.get('/settings').then(r => setReminderDurationDays(parseInt(r.data.agreement_reminder_duration_days || '10'))).catch(() => {});
  }, []);

  useEffect(() => {
    if (activeId) api.get(`/agreements/${activeId}`).then(r => setActive(r.data));
    else setActive(null);
  }, [activeId]);

  useEffect(() => {
    if (!active) { setSpend(null); return; }
    // Default the draft's reminder end date to today + agreement_reminder_duration_days until
    // the user (or finalize, server-side) sets a real one.
    const defaultReminderEnd = active.status === 'draft' && !active.reminder_end_date
      ? new Date(Date.now() + reminderDurationDays * 86400000).toISOString().slice(0, 10)
      : (active.reminder_end_date || '');
    setMeta({
      start_date: active.start_date || '', end_date: active.end_date || '', budget_amount: active.budget_amount ?? '',
      reminder_end_date: defaultReminderEnd,
    });
    api.get(`/agreements/${active.id}/spend`).then(r => setSpend(r.data)).catch(() => setSpend(null));
  }, [active?.id, active?.start_date, active?.end_date, active?.budget_amount, active?.reminder_end_date, reminderDurationDays]);

  // Non-blocking warning if the agreement's dates fall outside the client's funding period
  // for the same funding type — save is never prevented, this is purely informational.
  const fundingWarning = (() => {
    if (!active?.funding_type_name || !meta.start_date) return '';
    const period = fundingPeriods.find(p => p.funding_type === active.funding_type_name);
    if (!period || !period.start_date || !period.end_date) return '';
    const s = meta.start_date, e = meta.end_date || meta.start_date;
    if (s < period.start_date || e > period.end_date) {
      return `This agreement's dates extend beyond the client's ${active.funding_type_name} funding period (${period.start_date} – ${period.end_date}).`;
    }
    return '';
  })();

  const saveMeta = async () => {
    setSavingMeta(true);
    setAgreementError('');
    try {
      const res = await api.patch(`/agreements/${active.id}`, {
        start_date: meta.start_date || null,
        end_date: meta.end_date || null,
        budget_amount: meta.budget_amount === '' ? null : Number(meta.budget_amount),
        reminder_end_date: meta.reminder_end_date || null,
      });
      setActive(res.data);
    } catch (e) {
      setAgreementError(e.response?.data?.error || 'Failed to save');
    } finally {
      setSavingMeta(false);
    }
  };

  // Reminder end date can also be changed after the agreement has already been sent —
  // dedicated endpoint since the main PATCH /:id route is draft-only.
  const changeReminderEndDate = async newDate => {
    setSavingReminderEndDate(true);
    setAgreementError('');
    try {
      const res = await api.patch(`/agreements/${active.id}/reminder-end-date`, { reminder_end_date: newDate || null });
      setActive(res.data);
    } catch (e) {
      setAgreementError(e.response?.data?.error || 'Failed to update reminder end date');
    } finally {
      setSavingReminderEndDate(false);
    }
  };

  const createAgreement = async () => {
    if (!newTemplateId) return;
    setAgreementError('');
    try {
      const res = await api.post('/agreements', { client_id: clientId, template_id: newTemplateId });
      setShowNew(false); setNewTemplateId('');
      await load();
      setActiveId(res.data.id);
    } catch (e) {
      setAgreementError(e.response?.data?.error || 'Failed to create agreement');
    }
  };

  const finalize = async sendEmail => {
    setAgreementError('');
    // Flush any pending pricing table edits first — otherwise a quantity/service change made
    // just before clicking Send would silently go out with whatever was last explicitly saved.
    if (pricingTableRef.current) {
      const savedOk = await pricingTableRef.current.save();
      if (!savedOk) return;
    }
    try {
      const res = await api.post(`/agreements/${activeId}/finalize`, { send_email: sendEmail });
      setActive(res.data);
      load();
    } catch (e) {
      setAgreementError(e.response?.data?.error || 'Failed to send agreement');
    }
  };

  const signingUrl = active?.signing_token ? `${window.location.origin}/sign/${active.signing_token}` : '';

  const copyLink = () => {
    navigator.clipboard.writeText(signingUrl);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const resendEmail = async () => {
    setAgreementError('');
    setResending(true);
    try {
      await api.post(`/agreements/${activeId}/resend`);
      setResent(true);
      setTimeout(() => setResent(false), 3000);
    } catch (e) {
      setAgreementError(e.response?.data?.error || 'Failed to resend agreement');
    } finally {
      setResending(false);
    }
  };

  const downloadPdf = async () => {
    setAgreementError('');
    // Draft PDFs are rendered live from current pricing data — flush pending edits first so
    // the preview always matches what's on screen (same reasoning as before Send/Get-link).
    if (active.status === 'draft' && pricingTableRef.current) {
      const savedOk = await pricingTableRef.current.save();
      if (!savedOk) return;
    }
    try {
      await downloadFile(api, `/agreements/${activeId}/pdf`, `${active.title}.pdf`);
    } catch (e) {
      setAgreementError(e.response?.data?.error || 'Failed to download PDF');
    }
  };

  const voidAgreement = async () => {
    if (!confirm('Void this agreement?')) return;
    setAgreementError('');
    try {
      await api.post(`/agreements/${activeId}/void`);
      const res = await api.get(`/agreements/${activeId}`);
      setActive(res.data);
      load();
    } catch (e) {
      setAgreementError(e.response?.data?.error || 'Failed to void agreement');
    }
  };

  return (
    <div className="space-y-4">
      {agreementError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{agreementError}</div>
      )}
      {!active && (
        <>
          {canCreateAgreement && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setShowNew(s => !s)}><Plus className="h-3.5 w-3.5" /> New agreement</Button>
            </div>
          )}
          {showNew && canCreateAgreement && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 flex items-center gap-2">
              <select className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
                value={newTemplateId} onChange={e => setNewTemplateId(e.target.value)}>
                <option value="">Select a template…</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <Button size="sm" onClick={createAgreement} disabled={!newTemplateId}>Create draft</Button>
            </div>
          )}
          {agreements.length === 0 && <p className="text-sm text-gray-400 py-6 text-center">No agreements yet.</p>}
          {agreements.map(a => (
            <div key={a.id} onClick={() => setActiveId(a.id)}
              className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 cursor-pointer hover:bg-gray-50">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800">{a.title}</p>
                <p className="text-xs text-gray-400">Created {fmtDateOnly(a.created_at, timezone)}{a.signed_at ? ` · Signed ${fmtDateOnly(a.signed_at, timezone)}` : ''}</p>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${AGREEMENT_STATUS_COLOR[a.status] || 'bg-gray-100 text-gray-600'}`}>{a.status}</span>
            </div>
          ))}
        </>
      )}

      {active && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <button onClick={() => setActiveId(null)} className="text-sm text-gray-500 hover:text-gray-700">&larr; Back to agreements</button>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${AGREEMENT_STATUS_COLOR[active.status] || 'bg-gray-100 text-gray-600'}`}>{active.status}</span>
          </div>
          <p className="text-lg font-semibold text-gray-900">{active.title}</p>

          {active.status === 'draft' ? (
            <div className="rounded-lg border border-gray-200 p-3 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <DateInput label="Start date" value={meta.start_date} onChange={v => setMeta(m => ({ ...m, start_date: v }))} />
                <ClearableDateInput label="End date" value={meta.end_date} onChange={v => setMeta(m => ({ ...m, end_date: v }))} />
                <div className="space-y-1">
                  <label className="block text-sm font-medium text-gray-700">Budget <span className="text-gray-400">(optional)</span></label>
                  <input type="number" step="0.01" placeholder={active.items?.length ? active.items.reduce((s, i) => s + Number(i.line_total || 0), 0).toFixed(2) : '0.00'}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                    value={meta.budget_amount} onChange={e => setMeta(m => ({ ...m, budget_amount: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <ClearableDateInput label="Reminder end date" value={meta.reminder_end_date} onChange={v => setMeta(m => ({ ...m, reminder_end_date: v }))} />
              </div>
              <p className="text-xs text-gray-400 -mt-2">Signing reminders stop after this date. Defaults to {reminderDurationDays} days from send.</p>
              {fundingWarning && (
                <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />{fundingWarning}
                </div>
              )}
              <div className="flex justify-end">
                <Button size="sm" variant="secondary" onClick={saveMeta} disabled={savingMeta}>{savingMeta ? 'Saving…' : 'Save dates & budget'}</Button>
              </div>
            </div>
          ) : (active.start_date || active.end_date || active.budget_amount) && (
            <p className="text-sm text-gray-500">
              {active.start_date || '…'} – {active.end_date || 'ongoing'}
              {active.budget_amount ? ` · Budget ${currency(active.budget_amount)}` : ''}
            </p>
          )}

          {spend?.budget_amount ? (
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">{currency(spend.total)} of {currency(spend.budget_amount)} used ({Math.round(spend.pct_used)}%)</span>
                <span className="text-xs text-gray-400">{currency(spend.invoiced)} invoiced + {currency(spend.projected)} scheduled</span>
              </div>
              <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                <div className={`h-full ${spend.pct_used >= 100 ? 'bg-red-500' : spend.pct_used >= 80 ? 'bg-amber-500' : 'bg-indigo-500'}`}
                  style={{ width: `${Math.min(spend.pct_used, 100)}%` }} />
              </div>
              {spend.pct_used >= 80 && (
                <p className={`text-xs ${spend.pct_used >= 100 ? 'text-red-600' : 'text-amber-600'}`}>
                  {spend.pct_used >= 100 ? 'Budget exceeded — appointments can still be added.' : 'Approaching budget limit.'}
                </p>
              )}
            </div>
          ) : spend && (spend.invoiced > 0 || spend.projected > 0) ? (
            <p className="text-sm text-gray-500">Spend to date: {currency(spend.total)} ({currency(spend.invoiced)} invoiced + {currency(spend.projected)} scheduled)</p>
          ) : null}

          <AgreementPricingTable ref={pricingTableRef} agreement={active} onUpdate={setActive} />

          {signingUrl && (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-800 space-y-2">
              <div className="break-all">Signing link: <a href={signingUrl} target="_blank" rel="noreferrer" className="underline">{signingUrl}</a></div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={copyLink}>{linkCopied ? 'Copied!' : 'Copy link'}</Button>
                {active.client_email && (
                  <Button size="sm" variant="secondary" onClick={resendEmail} disabled={resending}>
                    {resending ? 'Sending…' : resent ? 'Sent!' : 'Resend email'}
                  </Button>
                )}
              </div>
              {active.status !== 'signed' && active.status !== 'voided' && active.status !== 'declined' && (
                <div className="flex items-center gap-2 pt-1">
                  <label className="text-xs text-indigo-700">Reminders until:</label>
                  <input type="date" className="rounded border border-indigo-200 px-2 py-1 text-xs bg-white"
                    value={active.reminder_end_date || ''} disabled={savingReminderEndDate}
                    onChange={e => changeReminderEndDate(e.target.value)} />
                  {active.reminder_count > 0 && <span className="text-xs text-indigo-600">{active.reminder_count} sent so far</span>}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            {active.status === 'draft' && (
              <>
                <Button size="sm" onClick={() => finalize(true)}>Send by email</Button>
                <Button size="sm" variant="secondary" onClick={() => finalize(false)}>Get link (sign in person)</Button>
                <Button size="sm" variant="ghost" onClick={voidAgreement}>Void</Button>
              </>
            )}
            {active.items?.length > 0 && (
              <Button size="sm" variant="secondary" onClick={downloadPdf}>
                {active.status === 'draft' ? 'Preview PDF' : 'Download PDF'}
              </Button>
            )}
          </div>

          <EntityAuditLog entityType="agreement" entityId={active.id} defaultOpen
            actionColors={{
              created: 'text-green-700', sent: 'text-blue-700', resent: 'text-blue-700',
              viewed: 'text-amber-600', signed: 'text-green-700', declined: 'text-red-600',
              voided: 'text-red-600', reminder_sent: 'text-indigo-600', reminder_end_date_changed: 'text-gray-500',
            }} />
        </div>
      )}
    </div>
  );
}

const FUNDING_COLOR_FALLBACK = { NDIS: 'blue', Medicare: 'green', Private: 'purple', 'Aged Care': 'orange', Other: 'gray' };

// ─── Date input helper (reliable cross-browser) ───────────────────────────────
function DateInput({ label, value, onChange }) {
  const ref = useRef();
  const externalVal = useRef(value);
  useEffect(() => {
    if (externalVal.current !== value && ref.current) {
      ref.current.value = value || '';
      externalVal.current = value;
    }
  }, [value]);
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <input ref={ref} type="date"
        defaultValue={value || ''}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        onChange={e => { externalVal.current = e.target.value; onChange(e.target.value); }}
      />
    </div>
  );
}

function ClearableDateInput({ label, value, onChange }) {
  const ref = useRef();
  const externalVal = useRef(value);
  useEffect(() => {
    if (externalVal.current !== value && ref.current) {
      ref.current.value = value || '';
      externalVal.current = value;
    }
  }, [value]);
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-700">{label} <span className="text-gray-400">(optional)</span></label>
      <div className="flex gap-1 items-center">
        <input ref={ref} type="date"
          defaultValue={value || ''}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          onChange={e => { externalVal.current = e.target.value; onChange(e.target.value); }}
        />
        {value && (
          <button type="button" onClick={() => { onChange(''); if (ref.current) { ref.current.value = ''; externalVal.current = ''; } }}
            className="p-1.5 text-gray-400 hover:text-red-500">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Add Funds Manager mini-modal ─────────────────────────────────────────────
function AddFundsManagerInline({ initialName, onClose, onSaved }) {
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try { const res = await api.post('/funds-managers', { name, email }); onSaved(res.data); }
    finally { setSaving(false); }
  };
  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 space-y-2">
      <p className="text-sm font-medium text-indigo-700">New funder</p>
      <div className="grid grid-cols-2 gap-2">
        <Input label="Name" value={name} onChange={e => setName(e.target.value)} />
        <Input label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={save} disabled={saving || !name}>{saving ? 'Saving…' : 'Add'}</Button>
      </div>
    </div>
  );
}

// ─── Funding tab ──────────────────────────────────────────────────────────────
const EMPTY_PERIOD = { funding_type: '', funds_manager_id: '', client_identifier: '', start_date: '', end_date: '', ndis_management: '', self_managed_email: '' };

function FundingTab({ clientId }) {
  const { user } = useAuth();
  const canEdit = !!user?.permissions?.funding_periods;
  const canAddFunder = !!user?.permissions?.funds_managers;
  const [periods, setPeriods] = useState([]);
  const [fundsManagers, setFundsManagers] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_PERIOD);
  const [overlapWarning, setOverlapWarning] = useState('');
  const [saving, setSaving] = useState(false);
  const [addFMName, setAddFMName] = useState(null);

  const [fundingTypesList, setFundingTypesList] = useState([]);
  const loadPeriods = () => api.get(`/funding-periods?client_id=${clientId}`).then(r => setPeriods(r.data));
  const loadFMs    = () => api.get('/funds-managers').then(r => setFundsManagers(r.data));
  useEffect(() => { loadPeriods(); loadFMs(); api.get('/funding-types').then(r => setFundingTypesList(r.data)); }, []);

  const FUNDING_COLOR = Object.fromEntries(fundingTypesList.map(ft => [ft.name, ft.color]));
  const ndisTypes = fundingTypesList.filter(ft => ft.has_ndis_management).map(ft => ft.name);

  const fmOptions = fundsManagers.map(fm => ({ value: fm.id, label: fm.email ? `${fm.name} — ${fm.email}` : fm.name }));
  const handleAddFM = name => new Promise(resolve => setAddFMName({ name, resolve }));
  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setOverlapWarning(''); };
  const openAdd  = () => { setEditing('new'); setForm(EMPTY_PERIOD); setOverlapWarning(''); };
  const openEdit = p  => { setEditing(p); setForm({ funding_type: p.funding_type, funds_manager_id: p.funds_manager_id || '', client_identifier: p.client_identifier || '', start_date: p.start_date === '1111-01-01' ? '' : p.start_date, end_date: p.end_date === '9999-09-09' ? '' : p.end_date, ndis_management: p.ndis_management || '', self_managed_email: p.self_managed_email || '' }); setOverlapWarning(''); };
  const cancel   = () => { setEditing(null); setOverlapWarning(''); };

  const save = async () => {
    setOverlapWarning('');
    if (ndisTypes.includes(form.funding_type) && !form.client_identifier?.trim()) {
      setOverlapWarning('NDIS number is required for NDIS funding periods.');
      return;
    }
    const payload = { ...form, funds_manager_id: form.funds_manager_id || null };
    if (!payload.start_date || !payload.end_date) {
      if (!confirm('No period dates defined — this will save as an indefinite period. Continue?')) return;
      if (!payload.start_date) payload.start_date = '1111-01-01';
      if (!payload.end_date) payload.end_date = '9999-09-09';
    }
    setSaving(true);
    try {
      if (editing === 'new') await api.post('/funding-periods', { ...payload, client_id: clientId });
      else await api.patch(`/funding-periods/${editing.id}`, payload);
      setEditing(null); loadPeriods();
    } catch (e) {
      if (e.response?.status === 422) setOverlapWarning(e.response.data.error);
    } finally { setSaving(false); }
  };

  const remove = async id => {
    if (!confirm('Delete this funding period?')) return;
    await api.delete(`/funding-periods/${id}`); loadPeriods();
  };

  const today = localToday();
  const isActive = p => (!p.start_date || p.start_date === '1111-01-01' || p.start_date <= today) && (!p.end_date || p.end_date === '9999-09-09' || p.end_date >= today);

  return (
    <div className="space-y-3">
      {periods.length === 0 && !editing && <p className="text-sm text-gray-400 py-4 text-center">No funding periods added yet.</p>}

      {periods.map(p => (
        <div key={p.id} className={`rounded-lg border p-3 ${isActive(p) ? 'border-indigo-200 bg-indigo-50/40' : 'border-gray-200 bg-white'}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Badge color={FUNDING_COLOR[p.funding_type] || 'gray'}>{p.funding_type}</Badge>
                {isActive(p) && <span className="text-xs text-indigo-600 font-medium">Active</span>}
              </div>
              {(p.start_date || p.end_date) && (
                <p className="text-sm text-gray-700 mt-1">
                  {!p.start_date || p.start_date === '1111-01-01' ? 'Indefinite' : format(parseISO(p.start_date), 'd MMM yyyy')} – {!p.end_date || p.end_date === '9999-09-09' ? 'Indefinite' : format(parseISO(p.end_date), 'd MMM yyyy')}
                </p>
              )}
              {p.ndis_management && <p className="text-xs text-gray-500">{p.ndis_management === 'plan' ? 'Plan managed' : p.ndis_management === 'agency' ? 'Agency managed' : 'Self managed'}</p>}
              {p.funds_manager_name && <p className="text-xs text-gray-500">Funder: {p.funds_manager_name}</p>}
              {p.self_managed_email && <p className="text-xs text-gray-500">Invoice email: {p.self_managed_email}</p>}
              {p.client_identifier && <p className="text-xs text-gray-500">Client ID: {p.client_identifier}</p>}
            </div>
            {canEdit && (
              <div className="flex gap-1 shrink-0">
                <button onClick={() => openEdit(p)} className="text-gray-400 hover:text-gray-600 p-1"><Pencil className="h-3.5 w-3.5" /></button>
                <button onClick={() => remove(p.id)} className="text-red-300 hover:text-red-500 p-1"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            )}
          </div>
        </div>
      ))}

      {editing ? (
        <div className="rounded-lg border border-gray-200 p-4 space-y-3 bg-gray-50">
          <p className="text-sm font-medium text-gray-700">{editing === 'new' ? 'Add funding period' : 'Edit funding period'}</p>
          {overlapWarning && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />{overlapWarning}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Funding type</label>
              <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={form.funding_type} onChange={e => set('funding_type', e.target.value)}>
                <option value="">Select…</option>
                {fundingTypesList.map(f => <option key={f.id} value={f.name}>{f.name}</option>)}
              </select>
            </div>
            {ndisTypes.includes(form.funding_type) ? (
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Management type</label>
                <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={form.ndis_management} onChange={e => { set('ndis_management', e.target.value); if (e.target.value !== 'plan') set('funds_manager_id', ''); if (e.target.value !== 'self') set('self_managed_email', ''); }}>
                  <option value="">Select…</option>
                  <option value="plan">Plan managed</option>
                  <option value="agency">Agency managed</option>
                  <option value="self">Self managed</option>
                </select>
              </div>
            ) : (
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Funder <span className="text-gray-400">(optional)</span></label>
                <SearchSelect options={fmOptions} value={form.funds_manager_id} onChange={v => set('funds_manager_id', v)} placeholder="None" onAddNew={canAddFunder ? handleAddFM : undefined} addNewLabel="Add funder" />
              </div>
            )}
            {ndisTypes.includes(form.funding_type) && form.ndis_management === 'plan' && (
              <div className="col-span-2 space-y-1">
                <label className="block text-sm font-medium text-gray-700">Plan manager</label>
                <SearchSelect options={fmOptions} value={form.funds_manager_id} onChange={v => set('funds_manager_id', v)} placeholder="Select funder…" onAddNew={canAddFunder ? handleAddFM : undefined} addNewLabel="Add funder" />
              </div>
            )}
            {ndisTypes.includes(form.funding_type) && form.ndis_management === 'self' && (
              <div className="col-span-2 space-y-1">
                <label className="block text-sm font-medium text-gray-700">Invoice email</label>
                <input type="email" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  value={form.self_managed_email} onChange={e => set('self_managed_email', e.target.value)} placeholder="client@example.com" />
              </div>
            )}
            <div className="col-span-2 space-y-1">
              <label className="block text-sm font-medium text-gray-700">{ndisTypes.includes(form.funding_type) ? 'NDIS number' : 'Client ID'} {!ndisTypes.includes(form.funding_type) && <span className="text-gray-400">(optional)</span>}</label>
              <input className={`w-full rounded-lg border px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none ${ndisTypes.includes(form.funding_type) && !form.client_identifier ? 'border-red-300' : 'border-gray-300'}`}
                value={form.client_identifier} onChange={e => set('client_identifier', e.target.value)} placeholder={ndisTypes.includes(form.funding_type) ? 'NDIS participant number' : 'e.g. NDIS participant number'} />
            </div>
            <ClearableDateInput label="Start date" value={form.start_date} onChange={v => set('start_date', v)} />
            <ClearableDateInput label="End date"   value={form.end_date}   onChange={v => set('end_date',   v)} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={cancel}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving || !form.funding_type}>
              {saving ? 'Saving…' : editing === 'new' ? 'Add period' : 'Save changes'}
            </Button>
          </div>
        </div>
      ) : canEdit && (
        <Button variant="secondary" size="sm" onClick={openAdd}><Plus className="h-3.5 w-3.5" /> Add funding period</Button>
      )}

      {addFMName && (
        <AddFundsManagerInline
          initialName={addFMName.name}
          onClose={() => setAddFMName(null)}
          onSaved={async fm => {
            await loadFMs();
            set('funds_manager_id', fm.id);
            addFMName.resolve({ value: fm.id, label: fm.email ? `${fm.name} — ${fm.email}` : fm.name });
            setAddFMName(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Billing summary tab ──────────────────────────────────────────────────────
function BillingSummaryTab({ clientId }) {
  const [range, setRange] = useState({ from: '', to: '' });
  const [spend, setSpend] = useState(null);

  const load = params => api.get(`/clients/${clientId}/spend${params ? `?${params}` : ''}`).then(r => {
    setSpend(r.data);
    setRange({ from: r.data.from, to: r.data.to });
  });
  useEffect(() => { load(); }, []);

  const applyRange = () => load(`from=${range.from}&to=${range.to}`);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 max-w-sm">
        <DateInput label="From" value={range.from} onChange={v => setRange(r => ({ ...r, from: v }))} />
        <DateInput label="To" value={range.to} onChange={v => setRange(r => ({ ...r, to: v }))} />
      </div>
      <Button size="sm" variant="secondary" onClick={applyRange}>Update range</Button>

      {spend && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-400">Invoiced</p>
            <p className="text-xl font-semibold text-gray-900">{currency(spend.invoiced)}</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-400">Scheduled (not yet invoiced)</p>
            <p className="text-xl font-semibold text-gray-900">{currency(spend.projected)}</p>
          </div>
          <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-4">
            <p className="text-xs text-indigo-500">Total</p>
            <p className="text-xl font-semibold text-indigo-900">{currency(spend.total)}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Files tab ────────────────────────────────────────────────────────────────
function FilesTab({ clientId }) {
  const { timezone } = useSettings();
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const inputRef = useRef();

  const load = () => api.get(`/client-files?client_id=${clientId}`).then(r => setFiles(r.data));
  useEffect(() => { load(); }, []);

  const upload = async e => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    setUploadError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('client_id', clientId);
      await api.post('/client-files', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      load();
    } catch (err) {
      const reason = err.response?.data?.error
        || (err.response?.status === 413 ? 'File is too large to upload.' : null)
        || 'Failed to upload file. Please try again.';
      setUploadError(reason);
    } finally { setUploading(false); e.target.value = ''; }
  };

  const remove = async id => {
    if (!confirm('Delete this file?')) return;
    await api.delete(`/client-files/${id}`);
    load();
  };

  const download = id => {
    const file = files.find(f => f.id === id);
    downloadFile(api, `/client-files/${id}/download`, file?.original_name || 'download');
  };

  const fmt = bytes => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

  return (
    <div className="space-y-3">
      {uploadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{uploadError}</div>
      )}
      <div className="flex justify-end">
        <input ref={inputRef} type="file" className="hidden" onChange={upload} />
        <Button size="sm" onClick={() => inputRef.current.click()} disabled={uploading}>
          <Upload className="h-3.5 w-3.5" /> {uploading ? 'Uploading…' : 'Upload file'}
        </Button>
      </div>
      {files.length === 0 && <p className="text-sm text-gray-400 py-6 text-center">No files uploaded yet.</p>}
      {files.map(f => (
        <div key={f.id} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5">
          <File className="h-4 w-4 text-gray-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-800 truncate">{f.original_name}</p>
            <p className="text-xs text-gray-400">{fmt(f.size)} · {fmtDateOnly(f.created_at, timezone)}</p>
          </div>
          <button onClick={() => download(f.id)} className="text-indigo-500 hover:text-indigo-700 p-1"><Download className="h-4 w-4" /></button>
          <button onClick={() => remove(f.id)} className="text-red-300 hover:text-red-500 p-1"><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
    </div>
  );
}

// ─── Session Notes tab ────────────────────────────────────────────────────────
function SessionNotesTab({ clientId, client }) {
  const { user } = useAuth();
  const { timezone } = useSettings();
  const [notes, setNotes] = useState([]);
  const [noteTemplates, setNoteTemplates] = useState([]);
  const [newNote, setNewNote] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [actionError, setActionError] = useState('');

  const [nextAppt, setNextAppt] = useState('');

  const load = () => api.get(`/session-notes?client_id=${clientId}`).then(r => setNotes(r.data));
  useEffect(() => {
    load();
    if (user?.permissions?.settings) {
      api.get('/templates?type=session_note').then(r => setNoteTemplates(r.data)).catch(() => {});
    }
    const today = new Date().toISOString().slice(0, 10);
    api.get(`/appointments?client_id=${clientId}&from=${today}`)
      .then(r => {
        const future = (r.data || []).filter(a => a.status !== 'cancelled');
        if (future.length > 0) {
          const d = new Date(future[0].start_time);
          const day = d.toLocaleDateString('en-AU', { weekday: 'long' });
          const dd = String(d.getDate()).padStart(2, '0');
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const yyyy = d.getFullYear();
          setNextAppt(`${day} ${dd}/${mm}/${yyyy}`);
        }
      })
      .catch(() => {});
  }, []);

  const applyTemplate = t => {
    const today = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
    const vars = {
      client_name:       [client?.first_name, client?.last_name].filter(Boolean).join(' '),
      client_first_name: client?.first_name || '',
      practitioner_name: user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : '',
      date:              today,
      next_appointment:  nextAppt,
    };
    // Strip HTML tags (templates now use rich text) then substitute variables
    const plain = (t.body || '')
      .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
      .replace(/\n{3,}/g, '\n\n').trim();
    const rendered = plain.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] !== undefined ? vars[k] : `{{${k}}}`);
    setNewNote(rendered);
  };

  const saveNew = async () => {
    if (!newNote.trim()) return;
    setSaving(true);
    try {
      await api.post('/session-notes', { client_id: clientId, note: newNote });
      setNewNote('');
      setShowNew(false);
      load();
    } finally { setSaving(false); }
  };

  const saveEdit = async id => { await api.patch(`/session-notes/${id}`, { note: editText }); setEditingId(null); load(); };
  const remove   = async id => { if (!confirm('Delete this note?')) return; await api.delete(`/session-notes/${id}`); load(); };

  const toggleSelect = id => setSelectedIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);

  const downloadSelected = async () => {
    setActionError('');
    try {
      const clientName = `${client?.first_name || ''}_${client?.last_name || ''}`.replace(/\s+/g, '');
      await downloadFile(api, '/session-notes/pdf', `SessionNotes_${clientName}.pdf`, { method: 'post', data: { note_ids: selectedIds } });
    } catch (e) {
      setActionError(e.response?.data?.error || 'Failed to download PDF');
    }
  };

  return (
    <div className="space-y-3">
      {actionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</div>
      )}
      {selectedIds.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-indigo-100 bg-indigo-50/40 px-3 py-2">
          <span className="text-sm text-indigo-700">{selectedIds.length} note{selectedIds.length > 1 ? 's' : ''} selected</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={downloadSelected}>Download PDF</Button>
            <Button size="sm" onClick={() => setShowEmailModal(true)}>Email</Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>Clear</Button>
          </div>
        </div>
      )}
      {!showNew && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setShowNew(true)}><Plus className="h-3.5 w-3.5" /> Add note</Button>
        </div>
      )}

      {showNew && (
        <div className="rounded-lg border border-indigo-100 bg-indigo-50/30 p-3 space-y-2">
          {noteTemplates.length > 0 && (
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs text-gray-500">Use template:</span>
              {noteTemplates.map(t => (
                <button key={t.id} onClick={() => applyTemplate(t)}
                  className="rounded-full border border-indigo-200 bg-white px-2.5 py-0.5 text-xs text-indigo-700 hover:bg-indigo-50 transition-colors">
                  {t.name}
                </button>
              ))}
            </div>
          )}
          <textarea rows={5} autoFocus
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-y focus:border-indigo-500 focus:outline-none"
            placeholder="Write your session note…"
            value={newNote} onChange={e => setNewNote(e.target.value)} />
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" size="sm" onClick={() => { setShowNew(false); setNewNote(''); }}>Cancel</Button>
            <Button size="sm" onClick={saveNew} disabled={saving || !newNote.trim()}>{saving ? 'Saving…' : 'Save note'}</Button>
          </div>
        </div>
      )}

      {notes.length === 0 && !showNew && (
        <p className="text-sm text-gray-400 py-6 text-center">No session notes yet.</p>
      )}

      {notes.map(n => (
        <div key={n.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
          {editingId === n.id ? (
            <div className="space-y-2">
              <textarea rows={4} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm resize-y" value={editText} onChange={e => setEditText(e.target.value)} autoFocus />
              <div className="flex gap-2 justify-end">
                <Button variant="secondary" size="sm" onClick={() => setEditingId(null)}>Cancel</Button>
                <Button size="sm" onClick={() => saveEdit(n.id)}>Save</Button>
              </div>
            </div>
          ) : (
            <div className="group flex gap-2">
              <input type="checkbox" className="mt-1 accent-indigo-600 shrink-0"
                checked={selectedIds.includes(n.id)} onChange={() => toggleSelect(n.id)} />
              <div className="flex-1">
                <p className="text-sm text-gray-800 whitespace-pre-wrap">{n.note}</p>
                <p className="text-xs text-gray-400 mt-1.5">
                  {n.practitioner_name && <span className="font-medium">{n.practitioner_name} · </span>}
                  {fmtDateTime(n.created_at, timezone)}
                </p>
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button onClick={() => { setEditingId(n.id); setEditText(n.note); }} className="text-gray-400 hover:text-gray-600"><Pencil className="h-3.5 w-3.5" /></button>
                <button onClick={() => remove(n.id)} className="text-red-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          )}
        </div>
      ))}

      {showEmailModal && (
        <SessionNoteEmailModal
          clientId={clientId}
          client={client}
          noteIds={selectedIds}
          notes={notes.filter(n => selectedIds.includes(n.id))}
          onClose={() => setShowEmailModal(false)}
          onSent={() => { setShowEmailModal(false); setSelectedIds([]); }}
        />
      )}
    </div>
  );
}

// ─── Main detail page ─────────────────────────────────────────────────────────
const EMPTY_FORM = {
  first_name: '', last_name: '', email: '', phone: '', date_of_birth: '', address: '', gender: '',
  ndis_number: '', notes: '', alert: '',
  emergency_contact_name: '', emergency_contact_phone: '', emergency_contact_relationship: '', emergency_contact_email: '',
  diagnosis: '', allergies: '', regular_medication: '',
};

export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = id === 'new';
  const { user } = useAuth();
  const [client, setClient] = useState(isNew ? {} : null);
  const [tab, setTab] = useState('details');
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [createdClient, setCreatedClient] = useState(null);
  const load = () => {
    if (isNew) return;
    api.get(`/clients/${id}`).then(r => {
      setClient(r.data);
      setForm({
        first_name: r.data.first_name || '',
        last_name:  r.data.last_name  || '',
        email:      r.data.email      || '',
        phone:      r.data.phone      || '',
        date_of_birth: r.data.date_of_birth || '',
        address:    r.data.address    || '',
        gender:     r.data.gender     || '',
        ndis_number: r.data.ndis_number || '',
        notes:      r.data.notes      || '',
        alert:      r.data.alert      || '',
        emergency_contact_name:         r.data.emergency_contact_name         || '',
        emergency_contact_phone:        r.data.emergency_contact_phone        || '',
        emergency_contact_relationship: r.data.emergency_contact_relationship || '',
        emergency_contact_email:        r.data.emergency_contact_email        || '',
        diagnosis:         r.data.diagnosis         || '',
        allergies:         r.data.allergies         || '',
        regular_medication: r.data.regular_medication || '',
      });
    });
  };

  useEffect(() => { load(); }, [id]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      if (isNew) {
        const res = await api.post('/clients', form);
        setCreatedClient(res.data);
      } else {
        await api.patch(`/clients/${id}`, form);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        load();
      }
    } finally { setSaving(false); }
  };

  if (!client) return <div className="p-6 text-gray-400">Loading…</div>;

  const TABS = [
    ['details', 'Details'], ['funding', 'Funding'], ['medical', 'Medical'],
    ['notes', 'Session Notes'], ['agreements', 'Agreements'], ['billing', 'Billing'], ['files', 'Files'], ['calendar', 'Calendar'], ['history', 'History'],
  ];

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/clients')} className="text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className={`text-2xl font-semibold ${client.active === 0 ? 'text-gray-400' : ''}`}>
              {isNew ? 'New Client' : <><span className="font-mono text-base text-indigo-500 mr-2">C{String(client.id).padStart(4,'0')}</span>{client.first_name} {client.last_name}</>}
            </h1>
            {!isNew && client.active === 0 && <span className="text-xs bg-gray-100 text-gray-500 rounded-full px-2 py-0.5 font-medium">Inactive</span>}
          </div>
          {!isNew && client.active_funding_type && (
            <Badge color={FUNDING_COLOR_FALLBACK[client.active_funding_type] || 'gray'} className="mt-0.5">{client.active_funding_type}</Badge>
          )}
        </div>
        {!isNew && (
          <button
            onClick={async () => { await api.patch(`/clients/${id}/active`, { active: client.active === 0 ? 1 : 0 }); load(); }}
            className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors ${client.active === 0 ? 'border-green-300 text-green-700 hover:bg-green-50' : 'border-red-200 text-red-500 hover:bg-red-50'}`}
          >
            {client.active === 0 ? <><UserCheck className="h-4 w-4" /> Reactivate</> : <><UserX className="h-4 w-4" /> Deactivate</>}
          </button>
        )}
      </div>

      {/* Alert banner */}
      {client.alert && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-300 px-4 py-3 text-amber-800">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <p className="text-sm font-medium">{client.alert}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <div className="flex gap-0">
          {TABS.map(([tid, label]) => (
            <button key={tid} onClick={() => setTab(tid)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === tid ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        {tab === 'details' && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <Input label="First name" value={form.first_name} onChange={e => set('first_name', e.target.value)} />
              <Input label="Last name"  value={form.last_name}  onChange={e => set('last_name',  e.target.value)} />
              <Input label="Email"      value={form.email}      onChange={e => set('email',      e.target.value)} type="email" />
              <Input label="Phone"      value={form.phone}      onChange={e => set('phone',      e.target.value)} />
              <DateInput label="Date of birth" value={form.date_of_birth} onChange={v => set('date_of_birth', v)} />
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Gender</label>
                <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  value={form.gender} onChange={e => set('gender', e.target.value)}>
                  <option value="">—</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Non-binary">Non-binary</option>
                  <option value="Other">Other</option>
                  <option value="Prefer not to say">Prefer not to say</option>
                </select>
              </div>
              <div className="col-span-2">
                <AddressAutocomplete label="Address" value={form.address} onChange={v => set('address', v)} />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Alert <span className="text-gray-400 font-normal">(shown prominently on client profile)</span></label>
              <input className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400 placeholder:text-amber-400"
                value={form.alert} onChange={e => set('alert', e.target.value)}
                placeholder="e.g. Latex allergy, do not photograph" />
            </div>

            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Emergency contact</p>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Name"         value={form.emergency_contact_name}         onChange={e => set('emergency_contact_name',         e.target.value)} />
                <Input label="Phone"        value={form.emergency_contact_phone}        onChange={e => set('emergency_contact_phone',        e.target.value)} />
                <Input label="Email" type="email" value={form.emergency_contact_email} onChange={e => set('emergency_contact_email', e.target.value)} />
                <Input label="Relationship" value={form.emergency_contact_relationship} onChange={e => set('emergency_contact_relationship', e.target.value)} placeholder="e.g. Parent" />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Notes</label>
              <textarea rows={3} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none focus:border-indigo-500 focus:outline-none"
                value={form.notes} onChange={e => set('notes', e.target.value)} />
            </div>
          </div>
        )}

        {tab === 'medical' && (
          <div className="space-y-4">
            {[['Diagnosis', 'diagnosis', 3], ['Allergies', 'allergies', 2], ['Regular medication', 'regular_medication', 3]].map(([label, key, rows]) => (
              <div key={key} className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">{label}</label>
                <textarea rows={rows} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none focus:border-indigo-500 focus:outline-none"
                  value={form[key] || ''} onChange={e => set(key, e.target.value)} />
              </div>
            ))}
          </div>
        )}

        {tab === 'funding'   && (isNew ? <p className="text-sm text-gray-400 py-8 text-center">Save the client first to manage funding.</p> : <FundingTab  clientId={id} />)}
        {tab === 'notes'     && (isNew ? <p className="text-sm text-gray-400 py-8 text-center">Save the client first to add notes.</p> : <SessionNotesTab clientId={id} client={client} />)}
        {tab === 'agreements' && (isNew ? <p className="text-sm text-gray-400 py-8 text-center">Save the client first to create agreements.</p> : <AgreementsTab clientId={id} />)}
        {tab === 'billing'   && (isNew ? <p className="text-sm text-gray-400 py-8 text-center">Save the client first to view billing.</p> : <BillingSummaryTab clientId={id} />)}
        {tab === 'files'     && (isNew ? <p className="text-sm text-gray-400 py-8 text-center">Save the client first to upload files.</p> : <FilesTab     clientId={id} />)}
        {tab === 'calendar'  && (isNew ? <p className="text-sm text-gray-400 py-8 text-center">Save the client first to view calendar.</p> : <EmbeddedCalendar clientId={id} />)}
        {tab === 'history'   && (isNew ? <p className="text-sm text-gray-400 py-8 text-center">Save the client first to view history.</p> : (
          <EntityAuditLog entityType="client" entityId={id} defaultOpen
            actionColors={{ created: 'text-green-700', updated: 'text-blue-700', deactivated: 'text-red-600', reactivated: 'text-green-700' }} />
        ))}
      </div>

      {/* Save bar */}
      {(isNew || tab === 'details' || tab === 'medical') && (
        <div className="flex justify-end gap-2">
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : saved ? '✓ Saved' : isNew ? 'Create client' : 'Save changes'}
          </Button>
        </div>
      )}

      {createdClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <h3 className="font-semibold text-gray-900">Client created</h3>
            <p className="text-sm text-gray-600">{createdClient.first_name} {createdClient.last_name} has been added successfully.</p>
            <Button onClick={() => { const newId = createdClient.id; setCreatedClient(null); navigate(`/clients/${newId}`, { replace: true }); }} className="w-full justify-center">Close</Button>
          </div>
        </div>
      )}
    </div>
  );
}
