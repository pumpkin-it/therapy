import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { ArrowLeft, Plus, Pencil, Trash2, AlertTriangle, Upload, Download, File, Folder, FolderPlus, Paperclip, X, UserX, UserCheck, Search, ChevronDown, ChevronRight, Link2 } from 'lucide-react';
import api from '../lib/api';
import AddressAutocomplete from '../components/AddressAutocomplete';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Input from '../components/ui/Input';
import SearchSelect from '../components/ui/SearchSelect';
import Modal from '../components/ui/Modal';
import { EmbeddedCalendar } from '../components/CalendarViews';
import { localToday, fmtDateTime, fmtDateOnly, downloadFile, currency, noteHtml, notePlainText } from '../lib/utils';
import RichEditor from '../components/RichEditor';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import AgreementPricingTable from '../components/AgreementPricingTable';
import SessionNoteEmailModal from '../components/SessionNoteEmailModal';
import ReportNotifyModal from '../components/ReportNotifyModal';
import ReportsTab from '../components/ReportsTab';
import FormFillModal from '../components/FormFillModal';
import EntityAuditLog from '../components/EntityAuditLog';
import BudgetModal from '../components/BudgetModal';
import { buildFolderTree, sortedChildren, sortedItems, countItems } from '../lib/formFolders';

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
  const [newLabel, setNewLabel] = useState('');
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
  const [clientBudgets, setClientBudgets] = useState([]);
  const [linkBudgetId, setLinkBudgetId] = useState('');
  const [showCreateBudgetModal, setShowCreateBudgetModal] = useState(false);
  const pricingTableRef = useRef();

  const load = () => api.get(`/agreements?client_id=${clientId}`).then(r => setAgreements(r.data));
  const loadClientBudgets = () => api.get(`/budgets?client_id=${clientId}`).then(r => setClientBudgets(r.data)).catch(() => {});
  useEffect(() => {
    load();
    api.get('/templates?type=agreement').then(r => setTemplates(r.data));
    api.get(`/funding-periods?client_id=${clientId}`).then(r => setFundingPeriods(r.data)).catch(() => {});
    api.get('/settings').then(r => setReminderDurationDays(parseInt(r.data.agreement_reminder_duration_days || '10'))).catch(() => {});
    loadClientBudgets();
  }, []);

  // Agreement dates and budget dates are deliberately independent (an agreement can span
  // several budgets across disciplines with different periods, and aged-care services often
  // have no plan-period equivalent to sync to) — so linking only *suggests* a starting point by
  // filling in whichever agreement date fields are still blank, never overwriting a value the
  // practitioner already set.
  const prefillDatesFromBudget = budget => {
    if (!budget) return;
    setMeta(m => ({
      ...m,
      start_date: m.start_date || budget.start_date || m.start_date,
      end_date: m.end_date || budget.end_date || m.end_date,
    }));
  };

  const linkBudget = async () => {
    if (!linkBudgetId || !active) return;
    const res = await api.post(`/agreements/${active.id}/budgets`, { budget_id: Number(linkBudgetId) });
    setActive(res.data);
    prefillDatesFromBudget(res.data.linked_budgets?.find(b => b.id === Number(linkBudgetId)));
    setLinkBudgetId('');
  };
  const unlinkBudget = async budgetId => {
    const res = await api.delete(`/agreements/${active.id}/budgets/${budgetId}`);
    setActive(res.data);
  };
  // Explicit only — never automatic. A budget's rate indexation already updates live in place
  // (current_total_amount) without touching this at all; this is purely for an actual revision
  // (new session counts, new services, etc.), which the client needs to be made aware of before
  // it changes what the agreement is tracked against. The old link is kept as history, not
  // deleted — see the "Budget history" section below.
  const [switchingBudgetId, setSwitchingBudgetId] = useState(null);
  const switchBudget = async budgetId => {
    setSwitchingBudgetId(budgetId);
    try {
      const res = await api.post(`/agreements/${active.id}/budgets/${budgetId}/switch`);
      setActive(res.data);
    } finally {
      setSwitchingBudgetId(null);
    }
  };
  // Create-then-link in one action — no need to leave the agreement screen to go build a
  // budget in Billing first just to come straight back and link it.
  const onBudgetCreatedFromAgreement = async budget => {
    setShowCreateBudgetModal(false);
    const res = await api.post(`/agreements/${active.id}/budgets`, { budget_id: budget.id });
    setActive(res.data);
    prefillDatesFromBudget(budget);
    loadClientBudgets();
  };

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

  // Non-blocking — agreement dates and linked budget dates are allowed to differ on purpose
  // (an agreement can span multiple budgets, and aged care has no plan period to align to), so
  // this is purely a heads-up, not a validation error.
  const budgetDateWarning = (() => {
    if (!active?.linked_budgets?.length) return '';
    const mismatched = active.linked_budgets.filter(b =>
      (b.start_date || null) !== (meta.start_date || null) || (b.end_date || null) !== (meta.end_date || null)
    );
    if (!mismatched.length) return '';
    const detail = mismatched.map(b => `${b.discipline_name || 'Unassigned'} (${b.start_date || '…'} – ${b.end_date || 'ongoing'})`).join(', ');
    return `This agreement's dates don't match the linked budget: ${detail}. That's fine if intentional.`;
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
      const res = await api.post('/agreements', { client_id: clientId, template_id: newTemplateId, label: newLabel || undefined });
      setShowNew(false); setNewTemplateId(''); setNewLabel('');
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
              <input className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
                value={newLabel} onChange={e => setNewLabel(e.target.value)}
                placeholder="Label (optional) — defaults to template name" />
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
              <div className="grid grid-cols-2 gap-3">
                <DateInput label="Start date" value={meta.start_date} onChange={v => setMeta(m => ({ ...m, start_date: v }))} />
                <ClearableDateInput label="End date" value={meta.end_date} onChange={v => setMeta(m => ({ ...m, end_date: v }))} />
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
              {budgetDateWarning && (
                <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />{budgetDateWarning}
                </div>
              )}
              <div className="flex justify-end">
                <Button size="sm" variant="secondary" onClick={saveMeta} disabled={savingMeta}>{savingMeta ? 'Saving…' : 'Save dates'}</Button>
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

          <div className="rounded-lg border border-gray-200 p-3 space-y-2">
            <span className="text-sm font-medium text-gray-700">Linked Budgets</span>
            {(active.linked_budgets || []).length === 0 && (
              <p className="text-xs text-gray-400">No budgets linked — link one below to track this agreement against a real Billing-tab budget.</p>
            )}
            {(active.linked_budgets || []).map(b => (
              <div key={b.id} className="rounded border border-gray-100 bg-gray-50/60 px-2 py-1.5 text-sm space-y-1">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-gray-800">{b.discipline_name || 'Unassigned discipline'}</span>
                    <span className="text-xs text-gray-400 ml-2">{b.start_date || '…'} – {b.end_date || 'ongoing'}</span>
                    <span className="text-xs text-gray-400 ml-2">
                      {currency(b.spend.total)} of {currency(b.spend.current_total_amount)} used ({Math.round(b.spend.pct_used || 0)}%)
                    </span>
                  </div>
                  <button type="button" onClick={() => unlinkBudget(b.id)} className="text-xs text-red-500 hover:text-red-700">Unlink</button>
                </div>
                {b.superseded_by && (
                  <div className="flex items-center justify-between gap-2 rounded bg-amber-50 border border-amber-200 px-2 py-1 text-xs text-amber-700">
                    <span>This budget has been revised since it was linked.</span>
                    <button type="button" onClick={() => switchBudget(b.id)} disabled={switchingBudgetId === b.id}
                      className="shrink-0 font-medium underline hover:no-underline disabled:opacity-50">
                      {switchingBudgetId === b.id ? 'Switching…' : 'Switch to current version'}
                    </button>
                  </div>
                )}
              </div>
            ))}
            <div className="flex gap-2">
              <select className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
                value={linkBudgetId} onChange={e => setLinkBudgetId(e.target.value)}>
                <option value="">Link a budget…</option>
                {clientBudgets
                  .filter(b => b.status === 'active' && !(active.linked_budgets || []).some(lb => lb.id === b.id))
                  .map(b => <option key={b.id} value={b.id}>{b.discipline_name || 'Unassigned discipline'} — {currency(b.total_amount)} ({b.start_date || '…'} – {b.end_date || 'ongoing'})</option>)}
              </select>
              <Button size="sm" variant="secondary" onClick={linkBudget} disabled={!linkBudgetId}>Link</Button>
              <Button size="sm" variant="secondary" onClick={() => setShowCreateBudgetModal(true)}>+ Create budget</Button>
            </div>
          </div>

          {showCreateBudgetModal && (
            <BudgetModal
              clientId={clientId}
              revising={null}
              onClose={() => setShowCreateBudgetModal(false)}
              onSaved={onBudgetCreatedFromAgreement}
            />
          )}

          {(active.linked_budgets || []).length > 0 ? (
            <p className="text-xs text-gray-400 italic">
              Pricing for this agreement is generated from the linked budget{(active.linked_budgets || []).length > 1 ? 's' : ''} above — unlink to enter pricing manually instead.
            </p>
          ) : (
            <AgreementPricingTable ref={pricingTableRef} agreement={active} onUpdate={setActive} />
          )}

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

          {(active.historical_budgets || []).length > 0 && (
            <div className="rounded-lg border border-gray-200 p-3 space-y-2">
              <span className="text-sm font-medium text-gray-700">Budget history</span>
              <p className="text-xs text-gray-400">Budgets this agreement was previously tracked against, kept for the record — figures are frozen as of when each was switched out.</p>
              {active.historical_budgets.map(b => (
                <div key={b.id} className="rounded border border-gray-100 bg-gray-50/40 px-2 py-1.5 text-sm">
                  <span className="font-medium text-gray-600">{b.discipline_name || 'Unassigned discipline'}</span>
                  <span className="text-xs text-gray-400 ml-2">{b.start_date || '…'} – {b.end_date || 'ongoing'}</span>
                  <span className="text-xs text-gray-400 ml-2">
                    {currency(b.spend.total)} of {currency(b.spend.current_total_amount)} used ({Math.round(b.spend.pct_used || 0)}%)
                  </span>
                  <div className="text-xs text-gray-400">Superseded {fmtDateOnly(b.superseded_at, timezone)}</div>
                </div>
              ))}
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
            {(active.items?.length > 0 || active.linked_budgets?.length > 0) && (
              <Button size="sm" variant="secondary" onClick={downloadPdf}>
                {active.status === 'draft' ? 'Download PDF (for manual sign)' : 'Download PDF'}
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
// Colour tiers match the 75/90/100% notification thresholds exactly, so a glance at the bar
// tells you the same story the alert emails will — no separate mental mapping to keep in sync.
function budgetTierColor(pct) {
  if (pct >= 100) return { bar: 'bg-red-500', text: 'text-red-600' };
  if (pct >= 90) return { bar: 'bg-orange-500', text: 'text-orange-600' };
  if (pct >= 75) return { bar: 'bg-amber-500', text: 'text-amber-600' };
  return { bar: 'bg-indigo-500', text: null };
}

function BudgetCard({ budget, compact = false, action, disciplines, onReload }) {
  const spend = budget.spend;
  const pct = spend?.pct_used ?? 0;
  const tier = budgetTierColor(pct);
  const [editingDiscipline, setEditingDiscipline] = useState(false);
  const [disciplineDraft, setDisciplineDraft] = useState(budget.discipline_id || '');
  const [savingDiscipline, setSavingDiscipline] = useState(false);
  const [showItems, setShowItems] = useState(false);

  const saveDiscipline = async () => {
    if (!disciplineDraft) return;
    setSavingDiscipline(true);
    try {
      await api.patch(`/budgets/${budget.id}`, { discipline_id: Number(disciplineDraft) });
      setEditingDiscipline(false);
      onReload?.();
    } finally {
      setSavingDiscipline(false);
    }
  };

  return (
    <div className={`rounded-lg border p-4 space-y-2 ${compact ? 'border-gray-100 bg-gray-50/60' : 'border-gray-200'}`}>
      <div className="flex items-start justify-between">
        <div>
          {editingDiscipline ? (
            <div className="flex items-center gap-2">
              <select className="rounded border border-gray-300 px-2 py-1 text-sm" value={disciplineDraft} onChange={e => setDisciplineDraft(e.target.value)}>
                <option value="">Select…</option>
                {(disciplines || []).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <Button size="sm" onClick={saveDiscipline} disabled={!disciplineDraft || savingDiscipline}>{savingDiscipline ? 'Saving…' : 'Save'}</Button>
              <button type="button" onClick={() => setEditingDiscipline(false)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
            </div>
          ) : (
            <p className="font-medium text-gray-900">
              {budget.discipline_name || 'Unassigned discipline'}
              {!compact && !budget.discipline_id && (
                <button type="button" onClick={() => setEditingDiscipline(true)} className="ml-2 text-xs font-normal text-indigo-600 hover:text-indigo-800">
                  Assign discipline
                </button>
              )}
            </p>
          )}
          <p className="text-xs text-gray-400">
            {budget.start_date || '…'} – {budget.end_date || 'ongoing'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {action}
          <Badge color={budget.status === 'active' ? 'green' : 'gray'}>
            {budget.status === 'active' ? 'Active' : 'Superseded'}
          </Badge>
        </div>
      </div>
      {spend && (
        <>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">{currency(spend.total)} of {currency(spend.current_total_amount)} used ({Math.round(pct)}%)</span>
          </div>
          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
            <div className={`h-full ${compact ? 'bg-gray-300' : tier.bar}`} style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
          {!compact && tier.text && (
            <p className={`text-xs ${tier.text}`}>
              {pct >= 100 ? 'Budget exceeded.' : pct >= 90 ? 'Nearing budget limit.' : 'Approaching budget limit.'}
            </p>
          )}
          {Math.abs(spend.current_total_amount - budget.total_amount) >= 0.01 && (
            <p className="text-xs text-gray-400">
              Quoted at {currency(budget.total_amount)} — rates have since changed.
            </p>
          )}
        </>
      )}
      {budget.notes && <p className="text-xs text-gray-400 italic">{budget.notes}</p>}
      {budget.items?.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowItems(s => !s)} className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-0.5">
            {showItems ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {showItems ? 'Hide' : 'Show'} services ({budget.items.length})
          </button>
          {showItems && (
            <div className="mt-2 space-y-1">
              {budget.items.map(it => (
                <div key={it.id} className="flex items-center justify-between text-xs text-gray-600 rounded bg-gray-50/60 px-2 py-1">
                  <span>{it.description} <span className="text-gray-400">({it.session_duration_min || 60} min × {it.sessions} sessions)</span></span>
                  <span className="font-medium text-gray-700">{currency(it.line_total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// One card per revision chain, the head (whichever budget nothing else has superseded) as the
// headline with every predecessor tucked behind a collapsible "Revision history" disclosure.
// Deliberately keyed off the superseded_by chain rather than discipline+status — multiple
// budgets can share a discipline without being revisions of each other (e.g. the legacy
// migrated agreement budgets, which have no discipline assigned yet and never reference one
// another), and grouping by discipline+"the one marked active" alone would silently hide every
// budget past the first found instead of rendering each as its own card.
function BudgetChainCard({ head, history, onRevise, disciplines, onReload }) {
  const [showHistory, setShowHistory] = useState(false);
  return (
    <div className="space-y-2">
      <BudgetCard budget={head} disciplines={disciplines} onReload={onReload} action={head.status === 'active' && (
        <button type="button" onClick={() => onRevise(head)} className="text-xs text-indigo-600 hover:text-indigo-800">
          Revise
        </button>
      )} />
      {history.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowHistory(s => !s)}
            className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-0.5">
            {showHistory ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {showHistory ? 'Hide' : 'Show'} revision history ({history.length})
          </button>
          {showHistory && (
            <div className="mt-2 space-y-2 pl-3 border-l-2 border-gray-100">
              {history.map(b => <BudgetCard key={b.id} budget={b} compact />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BudgetsSection({ clientId }) {
  const [budgets, setBudgets] = useState(null);
  const [disciplines, setDisciplines] = useState([]);
  const [modal, setModal] = useState(null); // null | 'new' | full budget-with-items object (revise)

  const reload = () => api.get(`/budgets?client_id=${clientId}`).then(r => setBudgets(r.data));
  useEffect(() => { reload(); api.get('/disciplines').then(r => setDisciplines(r.data)).catch(() => {}); }, [clientId]);

  const openRevise = head => api.get(`/budgets/${head.id}`).then(r => setModal(r.data));
  const closeModal = () => setModal(null);
  const onSaved = () => { closeModal(); reload(); };

  // A "head" is any budget nothing else supersedes — the current end of its own chain (or a
  // standalone budget that was never revised at all). Every other budget hangs off exactly one
  // head via its own superseded_by chain, walked here rather than assumed to be one level deep.
  const heads = (budgets || []).filter(b => b.superseded_by == null);
  const chains = heads.map(head => {
    const history = [];
    const visited = new Set([head.id]);
    let frontier = [head.id];
    while (frontier.length) {
      const predecessors = budgets.filter(b => frontier.includes(b.superseded_by) && !visited.has(b.id));
      predecessors.forEach(b => visited.add(b.id));
      history.push(...predecessors);
      frontier = predecessors.map(b => b.id);
    }
    history.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { head, history };
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="secondary" onClick={() => setModal('new')}>
          <Plus className="h-3.5 w-3.5" /> New budget
        </Button>
      </div>

      {budgets === null ? null : budgets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
          No budgets set up for this client yet.
        </div>
      ) : (
        chains.map(({ head, history }) => <BudgetChainCard key={head.id} head={head} history={history} onRevise={openRevise} disciplines={disciplines} onReload={reload} />)
      )}

      {modal && (
        <BudgetModal
          clientId={clientId}
          revising={modal === 'new' ? null : modal}
          onClose={closeModal}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

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
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Budgets</h3>
        <BudgetsSection clientId={clientId} />
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-700">Billed period</h3>
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
    </div>
  );
}

// Reports are authored externally in Word and shared here as a finished PDF already in Files —
// never a separate upload. A blurred/watermarked preview is rendered server-side when a file is
// shared, so a client can be sent proof the report is done without reading/extracting it before
// release. Release is a manual finance/admin toggle (this practice has no in-app payment
// tracking). See FilesTab below — reports live as ordinary files, not a separate tab.
const REPORT_STATUS_COLOR = { pending: 'bg-amber-100 text-amber-700', released: 'bg-green-100 text-green-700' };
// Word/Excel have no rasterization path (would need converting to PDF first) — not worth the
// dependency until there's an actual need. PDF and images cover the real workflow today.
const SHAREABLE_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

// ─── Files tab ────────────────────────────────────────────────────────────────
// Same cap the server applies when generating the preview: half the pages, rounded down, max 10.
// report_page_count is NULL for shares made before page counts were stored — fall back to 10.
const maxShownPages = pageCount => (pageCount == null ? 10 : Math.min(10, Math.floor(pageCount / 2)));

function FilesTab({ clientId, client }) {
  const { timezone } = useSettings();
  const [view, setView] = useState('folder'); // 'folder' | 'shared' — shared flattens every shared file across all folders
  const [folders, setFolders] = useState([]);
  const [currentFolder, setCurrentFolder] = useState(null); // folder object, or null = root
  const [files, setFiles] = useState([]);
  const [sharedFiles, setSharedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [pendingFile, setPendingFile] = useState(null); // File awaiting a label before upload
  const [labelDraft, setLabelDraft] = useState('');
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [editingLabelId, setEditingLabelId] = useState(null);
  const [editLabelDraft, setEditLabelDraft] = useState('');
  const [blockedFolder, setBlockedFolder] = useState(null); // { name, usage }
  const [copiedId, setCopiedId] = useState(null);
  const [editingPagesId, setEditingPagesId] = useState(null);
  const [editVisiblePages, setEditVisiblePages] = useState(1);
  const [savingPages, setSavingPages] = useState(false);
  const [reportError, setReportError] = useState('');
  const [sharingId, setSharingId] = useState(null);
  const [notifyingFile, setNotifyingFile] = useState(null);
  const [notifySent, setNotifySent] = useState(null);
  const inputRef = useRef();

  const loadFolders = () => api.get(`/client-file-folders?client_id=${clientId}`).then(r => setFolders(r.data));
  const loadFiles = () => api.get(`/client-files?client_id=${clientId}&folder_id=${currentFolder ? currentFolder.id : 'root'}`).then(r => setFiles(r.data));
  const loadShared = () => api.get(`/client-files?client_id=${clientId}&shared=1`).then(r => setSharedFiles(r.data));
  const refreshCurrentView = () => view === 'shared' ? loadShared() : loadFiles();

  useEffect(() => { loadFolders(); }, []);
  useEffect(() => { loadFiles(); }, [currentFolder]);
  useEffect(() => { if (view === 'shared') loadShared(); }, [view]);

  const pickFile = e => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadError('');
    setPendingFile(file);
    setLabelDraft(file.name.replace(/\.[^.]+$/, ''));
  };

  const confirmUpload = async () => {
    if (!pendingFile) return;
    setUploading(true);
    setUploadError('');
    try {
      const fd = new FormData();
      fd.append('file', pendingFile);
      fd.append('client_id', clientId);
      if (currentFolder) fd.append('folder_id', currentFolder.id);
      if (labelDraft.trim()) fd.append('label', labelDraft.trim());
      await api.post('/client-files', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setPendingFile(null);
      loadFiles();
      if (currentFolder) loadFolders();
    } catch (err) {
      const reason = err.response?.data?.error
        || (err.response?.status === 413 ? 'File is too large to upload.' : null)
        || 'Failed to upload file. Please try again.';
      setUploadError(reason);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async id => {
    if (!confirm('Delete this file?')) return;
    await api.delete(`/client-files/${id}`);
    refreshCurrentView();
    loadFolders();
  };

  const download = id => {
    const file = (view === 'shared' ? sharedFiles : files).find(f => f.id === id);
    downloadFile(api, `/client-files/${id}/download`, file?.original_name || 'download');
  };

  const saveLabel = async id => {
    await api.patch(`/client-files/${id}`, { label: editLabelDraft.trim() || null });
    setEditingLabelId(null);
    refreshCurrentView();
  };

  const moveFile = async (id, folderId) => {
    await api.patch(`/client-files/${id}`, { folder_id: folderId || null });
    refreshCurrentView();
    loadFolders();
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    const res = await api.post('/client-file-folders', { client_id: clientId, name: newFolderName.trim() });
    setFolders(f => [...f, res.data]);
    setNewFolderName('');
    setNewFolderOpen(false);
  };

  const deleteFolder = async f => {
    if (!confirm(`Delete folder "${f.name}"?`)) return;
    try {
      await api.delete(`/client-file-folders/${f.id}`);
      setFolders(fs => fs.filter(x => x.id !== f.id));
    } catch (e) {
      if (e.response?.status === 409) setBlockedFolder({ name: f.name, usage: e.response.data.usage });
    }
  };

  const fmt = bytes => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

  const shareReport = async f => {
    if (sharingId) return; // preview generation takes a few seconds — ignore repeat clicks rather than fire twice
    setReportError('');
    setSharingId(f.id);
    try {
      await api.post(`/client-files/${f.id}/share-report`, { visible_pages: 1 });
      refreshCurrentView();
    } catch (e) {
      setReportError(e.response?.data?.error || 'Failed to share file');
    } finally {
      setSharingId(null);
    }
  };

  const stopSharing = async f => {
    if (!confirm(`Stop sharing "${f.label || f.original_name}"? Its link will no longer work.`)) return;
    await api.delete(`/client-files/${f.id}/share-report`);
    refreshCurrentView();
  };

  const toggleReportStatus = async f => {
    const next = f.report_status === 'released' ? 'pending' : 'released';
    if (next === 'pending' && !confirm('Revert this report to draft? The client\'s link will show the blurred preview again.')) return;
    await api.patch(`/client-files/${f.id}/report-status`, { status: next });
    refreshCurrentView();
  };

  const startEditPages = f => {
    setEditingPagesId(f.id);
    setEditVisiblePages(f.report_visible_pages ?? 1);
  };

  const saveVisiblePages = async f => {
    setSavingPages(true);
    setReportError('');
    try {
      await api.patch(`/client-files/${f.id}/report-visible-pages`, { visible_pages: editVisiblePages });
      setEditingPagesId(null);
      refreshCurrentView();
    } catch (e) {
      setReportError(e.response?.data?.error || 'Failed to update visible pages');
    } finally {
      setSavingPages(false);
    }
  };

  const copyReportLink = f => {
    navigator.clipboard.writeText(`${window.location.origin}/report/${f.report_view_token}`);
    setCopiedId(f.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-3">
      {uploadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{uploadError}</div>
      )}
      {reportError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{reportError}</div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm min-w-0">
          <button onClick={() => setView('folder')}
            className={`px-2.5 py-1 rounded-md font-medium shrink-0 ${view === 'folder' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}>
            Files
          </button>
          <button onClick={() => setView('shared')}
            className={`px-2.5 py-1 rounded-md font-medium shrink-0 ${view === 'shared' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}>
            Shared
          </button>
          {view === 'folder' && currentFolder && (
            <>
              <span className="text-gray-300">/</span>
              <span className="font-medium text-gray-700 truncate">{currentFolder.name}</span>
              <button onClick={() => setCurrentFolder(null)} className="text-gray-400 hover:text-indigo-600 shrink-0 ml-1" title="Back to all files">
                <ArrowLeft className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
        {view === 'folder' && (
          <div className="flex gap-2 shrink-0">
            {!currentFolder && (
              <Button size="sm" variant="secondary" onClick={() => setNewFolderOpen(o => !o)}>
                <FolderPlus className="h-3.5 w-3.5" /> New folder
              </Button>
            )}
            <input ref={inputRef} type="file" className="hidden" onChange={pickFile} />
            <Button size="sm" onClick={() => inputRef.current.click()} disabled={uploading}>
              <Upload className="h-3.5 w-3.5" /> {uploading ? 'Uploading…' : 'Upload file'}
            </Button>
          </div>
        )}
      </div>

      {view === 'folder' && newFolderOpen && !currentFolder && (
        <div className="flex gap-2">
          <input autoFocus className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="Folder name" value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && createFolder()} />
          <Button size="sm" onClick={createFolder}>Create</Button>
        </div>
      )}

      {view === 'folder' && !currentFolder && folders.map(f => (
        <div key={f.id} onClick={() => setCurrentFolder(f)}
          className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 cursor-pointer hover:border-indigo-300">
          <Folder className="h-4 w-4 text-indigo-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-800 truncate">{f.name}</p>
            <p className="text-xs text-gray-400">{f.file_count} file{f.file_count === 1 ? '' : 's'}</p>
          </div>
          <button onClick={e => { e.stopPropagation(); deleteFolder(f); }} className="text-red-300 hover:text-red-500 p-1">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}

      {view === 'folder' && !currentFolder && folders.length === 0 && files.length === 0 && (
        <p className="text-sm text-gray-400 py-6 text-center">No files uploaded yet.</p>
      )}
      {view === 'folder' && currentFolder && files.length === 0 && (
        <p className="text-sm text-gray-400 py-6 text-center">No files in this folder yet.</p>
      )}
      {view === 'shared' && sharedFiles.length === 0 && (
        <p className="text-sm text-gray-400 py-6 text-center">Nothing has been shared yet.</p>
      )}

      {(view === 'shared' ? sharedFiles : files).map(f => (
        <div key={f.id} className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 space-y-2">
          <div className="flex items-center gap-3">
            <File className="h-4 w-4 text-gray-400 shrink-0" />
            <div className="flex-1 min-w-0">
              {editingLabelId === f.id ? (
                <div className="flex gap-1.5">
                  <input autoFocus className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
                    value={editLabelDraft} onChange={e => setEditLabelDraft(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && saveLabel(f.id)} placeholder="Label" />
                  <button onClick={() => saveLabel(f.id)} className="text-xs font-medium text-indigo-500 hover:text-indigo-700">Save</button>
                  <button onClick={() => setEditingLabelId(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                </div>
              ) : (
                <p className="text-sm font-medium text-gray-800 truncate flex items-center gap-1.5 group">
                  <span className="truncate">{f.label || f.original_name}</span>
                  <Pencil className="h-3 w-3 text-gray-300 opacity-0 group-hover:opacity-100 cursor-pointer shrink-0"
                    onClick={() => { setEditingLabelId(f.id); setEditLabelDraft(f.label || ''); }} />
                </p>
              )}
              <p className="text-xs text-gray-400 truncate">
                {view === 'shared' && `in ${f.folder_name || 'Files (root)'} · `}
                {f.label ? `${f.original_name} · ` : ''}{fmt(f.size)} · {fmtDateOnly(f.created_at, timezone)}
                {f.report_status && f.mime_type === 'application/pdf' && ` · ${f.report_visible_pages || 0}${f.report_page_count ? ` of ${f.report_page_count}` : ''} page${(f.report_page_count || f.report_visible_pages) === 1 ? '' : 's'} shown in full`}
              </p>
            </div>
            {f.report_status && (
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${REPORT_STATUS_COLOR[f.report_status]}`}>
                {f.report_status === 'released' ? 'Released' : 'Draft shared'}
              </span>
            )}
            {folders.length > 0 && (
              <select value={f.folder_id || ''} onChange={e => moveFile(f.id, e.target.value)} title="Move to folder"
                className="text-xs border border-gray-200 rounded px-1.5 py-1 text-gray-500 max-w-[8rem] shrink-0">
                <option value="">Root</option>
                {folders.map(fo => <option key={fo.id} value={fo.id}>{fo.name}</option>)}
              </select>
            )}
            {SHAREABLE_MIME_TYPES.includes(f.mime_type) && !f.report_status && (
              <Button size="sm" variant="ghost" onClick={() => shareReport(f)} disabled={sharingId === f.id}>
                {sharingId === f.id ? 'Sharing…' : 'Share file'}
              </Button>
            )}
            <button onClick={() => download(f.id)} className="text-indigo-500 hover:text-indigo-700 p-1"><Download className="h-4 w-4" /></button>
            {!f.billable_report_id && (
              <button onClick={() => remove(f.id)} className="text-red-300 hover:text-red-500 p-1"><Trash2 className="h-4 w-4" /></button>
            )}
          </div>

          {f.report_status && (
            <div className="flex items-center gap-1.5 pt-2 border-t border-gray-100">
              <Button size="sm" variant="ghost" onClick={() => copyReportLink(f)}>{copiedId === f.id ? 'Copied!' : 'Copy link'}</Button>
              <Button size="sm" variant="ghost" onClick={() => setNotifyingFile(f)}>
                {notifySent === f.id ? 'Sent!' : 'Notify client'}
              </Button>
              {f.mime_type === 'application/pdf' && (
                <Button size="sm" variant="ghost" onClick={() => startEditPages(f)}>Edit pages shown</Button>
              )}
              {f.billable_report_id ? (
                // Held back until its invoices are paid — released from the Reports tab, not here.
                <span className="ml-auto text-xs text-gray-400">Billed report · released from the Reports tab once paid</span>
              ) : (
                <>
                  <Button size="sm" variant={f.report_status === 'released' ? 'ghost' : 'secondary'} onClick={() => toggleReportStatus(f)}>
                    {f.report_status === 'released' ? 'Revert to draft' : 'Mark as released'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => stopSharing(f)} className="ml-auto text-gray-400">Stop sharing</Button>
                </>
              )}
            </div>
          )}

          {editingPagesId === f.id && (
            <div className="flex items-center gap-2 rounded-lg bg-gray-50 border border-gray-200 p-2">
              <label className="text-xs font-medium text-gray-600">Pages to show in full</label>
              <input type="number" min={0} max={maxShownPages(f.report_page_count)} value={editVisiblePages}
                onChange={e => setEditVisiblePages(Math.max(0, Math.min(maxShownPages(f.report_page_count), parseInt(e.target.value, 10) || 0)))}
                className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
              {f.report_page_count && <span className="text-xs text-gray-500">of {f.report_page_count} (up to {maxShownPages(f.report_page_count)})</span>}
              <Button size="sm" variant="ghost" onClick={() => setEditingPagesId(null)}>Cancel</Button>
              <Button size="sm" onClick={() => saveVisiblePages(f)} disabled={savingPages}>{savingPages ? 'Saving…' : 'Save'}</Button>
            </div>
          )}
        </div>
      ))}

      {pendingFile && (
        <Modal title="Upload file" onClose={() => !uploading && setPendingFile(null)}>
          <p className="text-sm text-gray-500 mb-3 truncate">{pendingFile.name}</p>
          <label className="block text-sm font-medium text-gray-700 mb-1">Label (optional)</label>
          <input autoFocus className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="e.g. Initial Assessment Report" value={labelDraft} onChange={e => setLabelDraft(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && confirmUpload()} />
          <p className="text-xs text-gray-400 mt-1.5">Shown instead of the filename to give this file more context.</p>
          <div className="flex justify-end gap-2 mt-5">
            <Button variant="secondary" onClick={() => setPendingFile(null)} disabled={uploading}>Cancel</Button>
            <Button onClick={confirmUpload} disabled={uploading}>{uploading ? 'Uploading…' : 'Upload'}</Button>
          </div>
        </Modal>
      )}

      {blockedFolder && (
        <Modal title="Folder in use" onClose={() => setBlockedFolder(null)}>
          <p className="text-sm text-gray-700">
            <span className="font-medium">{blockedFolder.name}</span> can't be removed because it still contains:
          </p>
          <ul className="mt-2 text-sm text-gray-700 list-disc list-inside">
            {blockedFolder.usage.files.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
          <p className="text-xs text-gray-400 mt-3">Move or delete those files first, then try again.</p>
          <div className="flex justify-end mt-5">
            <Button onClick={() => setBlockedFolder(null)}>Got it</Button>
          </div>
        </Modal>
      )}

      {notifyingFile && (
        <ReportNotifyModal
          client={client}
          file={notifyingFile}
          onClose={() => setNotifyingFile(null)}
          onSent={() => {
            setNotifyingFile(null);
            setNotifySent(notifyingFile.id);
            setTimeout(() => setNotifySent(null), 2000);
          }}
        />
      )}
    </div>
  );
}

// ─── Forms tab ────────────────────────────────────────────────────────────────
const RESPONSE_STATUS_COLOR = { draft: 'gray', sent: 'blue', viewed: 'blue', submitted: 'green', accepted: 'indigo', declined: 'red' };

// Recursive folder tree for the "Fill in a form" picker — subfolders (collapsible, sorted)
// before this level's own forms (sorted), same convention as the admin Templates → Forms list.
function FormPickerNode({ node, path, openFolders, toggleFolder, onPick }) {
  return (
    <>
      {sortedChildren(node).map(name => {
        const fullPath = path ? `${path}/${name}` : name;
        const isOpen = openFolders.has(fullPath);
        const child = node.children[name];
        return (
          <div key={fullPath}>
            <button type="button" onClick={() => toggleFolder(fullPath)}
              className="w-full flex items-center gap-1.5 text-left px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-400" />}
              <Folder className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
              <span className="truncate">{name}</span>
              <span className="ml-auto text-xs text-gray-400 font-normal shrink-0">{countItems(child)}</span>
            </button>
            {isOpen && (
              <div className="pl-4 border-l border-gray-100 ml-4">
                <FormPickerNode node={child} path={fullPath} openFolders={openFolders} toggleFolder={toggleFolder} onPick={onPick} />
              </div>
            )}
          </div>
        );
      })}
      {sortedItems(node).map(t => (
        <button key={t.id} onClick={() => onPick(t)} className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">{t.name}</button>
      ))}
    </>
  );
}

function FormsTab({ clientId, client }) {
  const [templates, setTemplates] = useState([]);
  const [responses, setResponses] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [openFolders, setOpenFolders] = useState(() => new Set());
  const [fillTarget, setFillTarget] = useState(null); // { formTemplate } or { responseId }

  const load = () => {
    api.get('/form-templates').then(r => setTemplates(r.data));
    api.get(`/form-responses?client_id=${clientId}`).then(r => setResponses(r.data));
  };
  useEffect(() => { load(); }, []);

  const startNew = async template => {
    setPickerOpen(false);
    setFillTarget({ formTemplate: template });
  };

  const toggleFolder = path => setOpenFolders(prev => {
    const next = new Set(prev);
    next.has(path) ? next.delete(path) : next.add(path);
    return next;
  });

  const tree = buildFolderTree(templates);

  return (
    <div className="space-y-3">
      <div className="flex justify-end relative">
        <Button size="sm" onClick={() => setPickerOpen(o => !o)}><Plus className="h-3.5 w-3.5" /> Fill in a form</Button>
        {pickerOpen && (
          <div className="absolute right-0 top-10 z-10 w-72 max-h-80 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg py-1">
            {templates.length === 0 && <p className="px-3 py-2 text-sm text-gray-400">No form templates yet — build one under Templates → Forms.</p>}
            <FormPickerNode node={tree} path="" openFolders={openFolders} toggleFolder={toggleFolder} onPick={startNew} />
          </div>
        )}
      </div>

      {responses.length === 0 && <p className="text-sm text-gray-400 py-8 text-center">No forms filled in for this client yet.</p>}

      {responses.map(r => (
        <button key={r.id} onClick={() => setFillTarget({ responseId: r.id })}
          className="w-full text-left rounded-xl border border-gray-200 bg-white shadow-sm p-4 flex items-center justify-between gap-3 hover:border-indigo-200">
          <div>
            <p className="font-medium text-gray-900 text-sm">{r.template_name}</p>
            <p className="text-xs text-gray-400 mt-0.5">{r.submitted_at ? fmtDateTime(r.submitted_at) : '—'}</p>
          </div>
          <Badge color={RESPONSE_STATUS_COLOR[r.status] || 'gray'}>{r.status}</Badge>
        </button>
      ))}

      {fillTarget && (
        <FormFillModal
          clientId={clientId}
          client={client}
          formTemplate={fillTarget.formTemplate}
          responseId={fillTarget.responseId}
          onClose={() => setFillTarget(null)}
          onSaved={() => { setFillTarget(null); load(); }}
        />
      )}
    </div>
  );
}

// ─── Session Notes tab ────────────────────────────────────────────────────────
// Splits text on a case-insensitive match of `query` and wraps each match in <mark>.
function highlightText(text, query) {
  if (!query.trim()) return text;
  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'ig'));
  return parts.map((part, i) =>
    part.toLowerCase() === query.trim().toLowerCase()
      ? <mark key={i} className="bg-amber-200 text-gray-900 rounded-sm px-0.5">{part}</mark>
      : part
  );
}

// appointment_time is naive LOCAL practice time (same convention as every other
// appointments.start_time read in this codebase) — parsed directly, no 'Z' appended, no timezone
// conversion. e.g. "Monday 14/09/2026 at 10am".
function fmtApptDateTime(localStr) {
  const d = new Date(localStr);
  const day = d.toLocaleDateString('en-AU', { weekday: 'long' });
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  const time = m === 0 ? `${h}${ampm}` : `${h}:${String(m).padStart(2, '0')}${ampm}`;
  return `${day} ${dd}/${mm}/${yyyy} at ${time}`;
}

// Recovers in-progress note text after an accidental tab/window close — debounce-free
// localStorage write on every keystroke (cheap: no network, no server load) rather than a
// server-side draft, which would need every note-reading path (list, PDF, email) to correctly
// exclude an unfinished draft. Cleared on successful save or explicit Cancel; left behind
// (and restored) only when the compose box was never closed cleanly, matching the reported
// scenario. Attachments staged on the compose box are NOT recovered — a File object can't be
// serialized to localStorage, so re-attaching after a lost tab is an acceptable gap.
const noteDraftKey = clientId => `therapy:session-note-draft:client:${clientId}`;

function SessionNotesTab({ clientId, client }) {
  const { user } = useAuth();
  const { timezone } = useSettings();
  const [notes, setNotes] = useState([]);
  const [noteTemplates, setNoteTemplates] = useState([]);
  const [newNote, setNewNote] = useState('');
  const [showNew, setShowNew] = useState(false);
  const setNewNoteDraft = v => {
    setNewNote(v);
    try { v ? localStorage.setItem(noteDraftKey(clientId), v) : localStorage.removeItem(noteDraftKey(clientId)); } catch {}
  };
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [actionError, setActionError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const [expandedIds, setExpandedIds] = useState([]);
  const [filesByNote, setFilesByNote] = useState({});
  const [pendingFile, setPendingFile] = useState(null); // { file, noteId }
  const [fileLabelDraft, setFileLabelDraft] = useState('');
  const [uploadingFile, setUploadingFile] = useState(false);
  const [fileError, setFileError] = useState('');
  const [editingFileLabelId, setEditingFileLabelId] = useState(null);
  const [editFileLabelDraft, setEditFileLabelDraft] = useState('');
  const fileInputRefs = useRef({});
  const newNoteHtmlRef = useRef(); // full-content replace on the compose editor (template apply)

  // Files staged on the "new note" compose box, before the note (and therefore a session_note_id) exists
  const [stagedFiles, setStagedFiles] = useState([]);
  const [pendingStagedFile, setPendingStagedFile] = useState(null); // File awaiting a label
  const [stagedLabelDraft, setStagedLabelDraft] = useState('');
  const stagedInputRef = useRef();

  const pickStagedFile = e => {
    const file = e.target.files[0];
    if (!file) return;
    setPendingStagedFile(file);
    setStagedLabelDraft(file.name.replace(/\.[^.]+$/, ''));
    e.target.value = '';
  };
  const confirmStageFile = () => {
    if (!pendingStagedFile) return;
    setStagedFiles(fs => [...fs, { key: `${Date.now()}-${Math.random()}`, file: pendingStagedFile, label: stagedLabelDraft.trim() }]);
    setPendingStagedFile(null);
  };
  const removeStagedFile = key => setStagedFiles(fs => fs.filter(f => f.key !== key));

  const [nextAppt, setNextAppt] = useState('');

  const [linkingNote, setLinkingNote] = useState(null); // note object being linked
  const [linkAppointments, setLinkAppointments] = useState([]);
  const [loadingLinkAppointments, setLoadingLinkAppointments] = useState(false);
  const [linkSaving, setLinkSaving] = useState(null); // appointment id currently being saved
  const [linkError, setLinkError] = useState('');

  const openLinkPicker = note => {
    setLinkingNote(note);
    setLinkError('');
    setLoadingLinkAppointments(true);
    api.get(`/appointments?client_id=${clientId}`)
      .then(r => setLinkAppointments([...(r.data || [])].reverse())) // most recent first
      .finally(() => setLoadingLinkAppointments(false));
  };

  const confirmLink = async apptId => {
    setLinkSaving(apptId);
    setLinkError('');
    try {
      await api.patch(`/session-notes/${linkingNote.id}`, { appointment_id: apptId });
      setLinkingNote(null);
      load();
    } catch (e) {
      setLinkError(e.response?.data?.error || 'Failed to link appointment');
    } finally {
      setLinkSaving(null);
    }
  };

  const load = () => api.get(`/session-notes?client_id=${clientId}`).then(r => setNotes(r.data));
  useEffect(() => {
    try {
      const saved = localStorage.getItem(noteDraftKey(clientId));
      if (saved) { setNewNote(saved); setShowNew(true); }
    } catch {}
  }, [clientId]);

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
    // Templates are themselves Quill-authored HTML — substitute vars directly into it (rather
    // than stripping to plain text first) so a template's own formatting carries into the note.
    const rendered = (t.body || '').replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] !== undefined ? vars[k] : `{{${k}}}`);
    newNoteHtmlRef.current?.(rendered);
  };

  const saveNew = async () => {
    if (!newNote.trim()) return;
    setSaving(true);
    try {
      const res = await api.post('/session-notes', { client_id: clientId, note: newNote });
      for (const sf of stagedFiles) {
        const fd = new FormData();
        fd.append('file', sf.file);
        fd.append('session_note_id', res.data.id);
        if (sf.label) fd.append('label', sf.label);
        await api.post('/session-note-files', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      setNewNoteDraft('');
      setStagedFiles([]);
      setShowNew(false);
      load();
    } finally { setSaving(false); }
  };

  const saveEdit = async id => { await api.patch(`/session-notes/${id}`, { note: editText }); setEditingId(null); load(); };
  const remove   = async id => { if (!confirm('Delete this note?')) return; await api.delete(`/session-notes/${id}`); load(); };

  const toggleSelect = id => setSelectedIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);

  const loadNoteFiles = id => api.get(`/session-note-files?session_note_id=${id}`).then(r => setFilesByNote(f => ({ ...f, [id]: r.data })));

  const toggleExpand = id => {
    const isOpen = expandedIds.includes(id);
    setExpandedIds(ids => isOpen ? ids.filter(x => x !== id) : [...ids, id]);
    if (!isOpen && !filesByNote[id]) loadNoteFiles(id);
  };

  const pickFile = (noteId, e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileError('');
    setPendingFile({ file, noteId });
    setFileLabelDraft(file.name.replace(/\.[^.]+$/, ''));
    e.target.value = '';
  };

  const confirmUploadFile = async () => {
    if (!pendingFile) return;
    setUploadingFile(true);
    setFileError('');
    try {
      const fd = new FormData();
      fd.append('file', pendingFile.file);
      fd.append('session_note_id', pendingFile.noteId);
      if (fileLabelDraft.trim()) fd.append('label', fileLabelDraft.trim());
      await api.post('/session-note-files', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const noteId = pendingFile.noteId;
      setPendingFile(null);
      loadNoteFiles(noteId);
      load();
    } catch (err) {
      setFileError(err.response?.data?.error || 'Failed to upload file');
    } finally { setUploadingFile(false); }
  };

  const removeFile = async (noteId, fileId) => {
    if (!confirm('Delete this file?')) return;
    await api.delete(`/session-note-files/${fileId}`);
    loadNoteFiles(noteId);
    load();
  };

  const downloadNoteFile = (noteId, fileId) => {
    const file = (filesByNote[noteId] || []).find(f => f.id === fileId);
    downloadFile(api, `/session-note-files/${fileId}/download`, file?.original_name || 'download');
  };

  const saveFileLabel = async (noteId, fileId) => {
    await api.patch(`/session-note-files/${fileId}`, { label: editFileLabelDraft.trim() || null });
    setEditingFileLabelId(null);
    loadNoteFiles(noteId);
  };

  const downloadSelected = async () => {
    setActionError('');
    try {
      const clientName = `${client?.first_name || ''}_${client?.last_name || ''}`.replace(/\s+/g, '');
      await downloadFile(api, '/session-notes/pdf', `SessionNotes_${clientName}.pdf`, { method: 'post', data: { note_ids: selectedIds } });
    } catch (e) {
      setActionError(e.response?.data?.error || 'Failed to download PDF');
    }
  };

  const q = searchQuery.trim().toLowerCase();
  const visibleNotes = q ? notes.filter(n => notePlainText(n.note).toLowerCase().includes(q)) : notes;

  return (
    <div className="space-y-3">
      {actionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</div>
      )}
      {notes.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search notes… e.g. incident"
            className="w-full rounded-lg border border-gray-300 pl-9 pr-8 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
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
          <RichEditor defaultValue={newNote} onChange={setNewNoteDraft} htmlRef={newNoteHtmlRef} toolbar="session-note" />
          {stagedFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {stagedFiles.map(sf => (
                <span key={sf.key} className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">
                  <File className="h-3 w-3" /> {sf.label || sf.file.name}
                  <button onClick={() => removeStagedFile(sf.key)} className="text-indigo-400 hover:text-indigo-700"><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          )}
          <div className="flex justify-between items-center">
            <input ref={stagedInputRef} type="file" className="hidden" onChange={pickStagedFile} />
            <button type="button" onClick={() => stagedInputRef.current.click()} className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1">
              <Paperclip className="h-3.5 w-3.5" /> Attach file
            </button>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => { setShowNew(false); setNewNoteDraft(''); setStagedFiles([]); }}>Cancel</Button>
              <Button size="sm" onClick={saveNew} disabled={saving || !newNote.trim()}>{saving ? 'Saving…' : 'Save note'}</Button>
            </div>
          </div>
        </div>
      )}

      {pendingStagedFile && (
        <Modal title="Attach file" onClose={() => setPendingStagedFile(null)}>
          <p className="text-sm text-gray-500 mb-3 truncate">{pendingStagedFile.name}</p>
          <label className="block text-sm font-medium text-gray-700 mb-1">Label (optional)</label>
          <input autoFocus className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="e.g. Referral letter" value={stagedLabelDraft} onChange={e => setStagedLabelDraft(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && confirmStageFile()} />
          <p className="text-xs text-gray-400 mt-1.5">This file will upload once the note is saved.</p>
          <div className="flex justify-end gap-2 mt-5">
            <Button variant="secondary" onClick={() => setPendingStagedFile(null)}>Cancel</Button>
            <Button onClick={confirmStageFile}>Attach</Button>
          </div>
        </Modal>
      )}

      {notes.length === 0 && !showNew && (
        <p className="text-sm text-gray-400 py-6 text-center">No session notes yet.</p>
      )}
      {notes.length > 0 && visibleNotes.length === 0 && (
        <p className="text-sm text-gray-400 py-6 text-center">No notes match "{searchQuery}".</p>
      )}

      {visibleNotes.map(n => {
        const isExpanded = expandedIds.includes(n.id) || !!q;
        const plain = notePlainText(n.note);
        const snippet = plain.length > 90 ? `${plain.slice(0, 90).trim()}…` : plain;
        return (
          <div key={n.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
            {editingId === n.id ? (
              <div className="space-y-2">
                <RichEditor defaultValue={editText} onChange={setEditText} toolbar="session-note" />
                <div className="flex gap-2 justify-end">
                  <Button variant="secondary" size="sm" onClick={() => setEditingId(null)}>Cancel</Button>
                  <Button size="sm" onClick={() => saveEdit(n.id)}>Save</Button>
                </div>
              </div>
            ) : (
              <div className="group">
                <div className="flex items-start gap-2 cursor-pointer" onClick={() => toggleExpand(n.id)}>
                  <input type="checkbox" className="mt-1 accent-indigo-600 shrink-0"
                    checked={selectedIds.includes(n.id)} onClick={e => e.stopPropagation()} onChange={() => toggleSelect(n.id)} />
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm text-gray-800 ${q ? 'whitespace-pre-wrap' : isExpanded ? '' : 'truncate'}`}>
                      {q
                        ? highlightText(plain, searchQuery)
                        : isExpanded
                          ? <div dangerouslySetInnerHTML={{ __html: noteHtml(n.note) }} />
                          : snippet}
                    </div>
                    <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1">
                      {n.practitioner_name && <span className="font-medium">{n.practitioner_name} · </span>}
                      {n.appointment_time ? fmtApptDateTime(n.appointment_time) : fmtDateTime(n.created_at, timezone)}
                      {n.file_count > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-gray-400">
                          · <Paperclip className="h-3 w-3" /> {n.file_count}
                        </span>
                      )}
                    </p>
                    {!n.appointment_id && (
                      <button onClick={e => { e.stopPropagation(); openLinkPicker(n); }}
                        className="text-xs text-indigo-500 hover:text-indigo-700 flex items-center gap-1 mt-1">
                        <Link2 className="h-3 w-3" /> Link to appointment
                      </button>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <input ref={el => (fileInputRefs.current[n.id] = el)} type="file" className="hidden" onChange={e => pickFile(n.id, e)} />
                    <button onClick={e => { e.stopPropagation(); fileInputRefs.current[n.id]?.click(); }} className="text-gray-400 hover:text-indigo-600" title="Attach file"><Paperclip className="h-3.5 w-3.5" /></button>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={e => { e.stopPropagation(); setEditingId(n.id); setEditText(noteHtml(n.note)); }} className="text-gray-400 hover:text-gray-600"><Pencil className="h-3.5 w-3.5" /></button>
                      <button onClick={e => { e.stopPropagation(); remove(n.id); }} className="text-red-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-gray-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Attachments</span>
                      <button onClick={() => fileInputRefs.current[n.id]?.click()} className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1">
                        <Upload className="h-3 w-3" /> Attach file
                      </button>
                    </div>
                    {(filesByNote[n.id] || []).length === 0 && <p className="text-xs text-gray-400">No files attached.</p>}
                    {(filesByNote[n.id] || []).map(f => (
                      <div key={f.id} className="flex items-center gap-2 rounded border border-gray-200 bg-white px-2.5 py-1.5">
                        <File className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          {editingFileLabelId === f.id ? (
                            <div className="flex gap-1.5">
                              <input autoFocus className="flex-1 rounded border border-gray-300 px-1.5 py-0.5 text-xs focus:border-indigo-500 focus:outline-none"
                                value={editFileLabelDraft} onChange={e => setEditFileLabelDraft(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && saveFileLabel(n.id, f.id)} placeholder="Label" />
                              <button onClick={() => saveFileLabel(n.id, f.id)} className="text-xs font-medium text-indigo-500 hover:text-indigo-700">Save</button>
                              <button onClick={() => setEditingFileLabelId(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                            </div>
                          ) : (
                            <p className="text-xs font-medium text-gray-700 truncate flex items-center gap-1 group/file">
                              <span className="truncate">{f.label || f.original_name}</span>
                              <Pencil className="h-2.5 w-2.5 text-gray-300 opacity-0 group-hover/file:opacity-100 cursor-pointer shrink-0"
                                onClick={() => { setEditingFileLabelId(f.id); setEditFileLabelDraft(f.label || ''); }} />
                            </p>
                          )}
                          <p className="text-[11px] text-gray-400 truncate">{f.label ? `${f.original_name} · ` : ''}{fmtDateOnly(f.created_at, timezone)}</p>
                        </div>
                        <button onClick={() => downloadNoteFile(n.id, f.id)} className="text-indigo-500 hover:text-indigo-700 p-0.5"><Download className="h-3.5 w-3.5" /></button>
                        <button onClick={() => removeFile(n.id, f.id)} className="text-red-300 hover:text-red-500 p-0.5"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {pendingFile && (
        <Modal title="Attach file" onClose={() => !uploadingFile && setPendingFile(null)}>
          <p className="text-sm text-gray-500 mb-3 truncate">{pendingFile.file.name}</p>
          <label className="block text-sm font-medium text-gray-700 mb-1">Label (optional)</label>
          <input autoFocus className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="e.g. Referral letter" value={fileLabelDraft} onChange={e => setFileLabelDraft(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && confirmUploadFile()} />
          <p className="text-xs text-gray-400 mt-1.5">Shown instead of the filename to give this file more context.</p>
          {fileError && <p className="text-xs text-red-600 mt-1.5">{fileError}</p>}
          <div className="flex justify-end gap-2 mt-5">
            <Button variant="secondary" onClick={() => setPendingFile(null)} disabled={uploadingFile}>Cancel</Button>
            <Button onClick={confirmUploadFile} disabled={uploadingFile}>{uploadingFile ? 'Uploading…' : 'Upload'}</Button>
          </div>
        </Modal>
      )}

      {linkingNote && (
        <Modal title="Link to appointment" onClose={() => setLinkingNote(null)}>
          <p className="text-xs text-gray-500 mb-3">
            Pick the appointment this note was written for — its date/time will then show on the note instead of when it was typed.
          </p>
          {linkError && <p className="text-xs text-red-600 mb-2">{linkError}</p>}
          {loadingLinkAppointments && <p className="text-sm text-gray-400 py-4 text-center">Loading appointments…</p>}
          {!loadingLinkAppointments && linkAppointments.length === 0 && (
            <p className="text-sm text-gray-400 py-4 text-center">No appointments found for this client.</p>
          )}
          {!loadingLinkAppointments && linkAppointments.length > 0 && (
            <div className="max-h-80 overflow-y-auto space-y-1.5 -mx-1 px-1">
              {linkAppointments.map(a => (
                <button key={a.id} onClick={() => confirmLink(a.id)} disabled={linkSaving === a.id}
                  className="w-full text-left rounded-lg border border-gray-200 px-3 py-2 text-sm hover:border-indigo-300 hover:bg-indigo-50/40 flex items-center justify-between gap-2 disabled:opacity-50">
                  <span>
                    {fmtApptDateTime(a.start_time)}
                    {a.practitioner_name && <span className="text-gray-400"> · {a.practitioner_name}</span>}
                  </span>
                  {a.status === 'cancelled'
                    ? <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-500">Cancelled</span>
                    : linkSaving === a.id
                      ? <span className="shrink-0 text-xs text-indigo-500">Linking…</span>
                      : null}
                </button>
              ))}
            </div>
          )}
          <div className="flex justify-end mt-4">
            <Button variant="secondary" size="sm" onClick={() => setLinkingNote(null)}>Cancel</Button>
          </div>
        </Modal>
      )}

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
  notes: '', alert: '',
  emergency_contact_name: '', emergency_contact_phone: '', emergency_contact_relationship: '', emergency_contact_email: '',
  case_manager_name: '', case_manager_organisation: '', case_manager_phone: '', case_manager_email: '',
  diagnosis: '', allergies: '', regular_medication: '', is_test_data: false,
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
  const [duplicates, setDuplicates] = useState([]);
  const [portalLinkCopied, setPortalLinkCopied] = useState(false);
  const dupTimer = useRef(null);
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
        notes:      r.data.notes      || '',
        alert:      r.data.alert      || '',
        emergency_contact_name:         r.data.emergency_contact_name         || '',
        emergency_contact_phone:        r.data.emergency_contact_phone        || '',
        emergency_contact_relationship: r.data.emergency_contact_relationship || '',
        emergency_contact_email:        r.data.emergency_contact_email        || '',
        case_manager_name:         r.data.case_manager_name         || '',
        case_manager_organisation: r.data.case_manager_organisation || '',
        case_manager_phone:        r.data.case_manager_phone        || '',
        case_manager_email:        r.data.case_manager_email        || '',
        diagnosis:         r.data.diagnosis         || '',
        allergies:         r.data.allergies         || '',
        regular_medication: r.data.regular_medication || '',
        is_test_data: !!r.data.is_test_data,
      });
    });
  };

  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    clearTimeout(dupTimer.current);
    if (!form.first_name || !form.last_name) { setDuplicates([]); return; }
    dupTimer.current = setTimeout(() => {
      const params = new URLSearchParams({ first_name: form.first_name, last_name: form.last_name });
      if (form.date_of_birth) params.set('date_of_birth', form.date_of_birth);
      if (form.phone) params.set('phone', form.phone);
      if (form.email) params.set('email', form.email);
      if (!isNew) params.set('exclude_id', id);
      api.get(`/clients/check-duplicates?${params}`).then(r => setDuplicates(r.data)).catch(() => {});
    }, 500);
    return () => clearTimeout(dupTimer.current);
  }, [form.first_name, form.last_name, form.date_of_birth, form.phone, form.email]);

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

  // Durable per-client link (see server/routes/clientPortal.js) showing everything explicitly
  // shared for this client — lazily generated on first copy, same pattern as practitioners'
  // cal_token, so most clients that never need one never get an unused token.
  const copyPortalLink = async () => {
    let token = client.portal_token;
    if (!token) {
      const res = await api.post(`/clients/${id}/reset-portal-token`);
      token = res.data.portal_token;
      setClient(c => ({ ...c, portal_token: token }));
    }
    navigator.clipboard.writeText(`${window.location.origin}/portal/${token}`);
    setPortalLinkCopied(true);
    setTimeout(() => setPortalLinkCopied(false), 2000);
  };

  if (!client) return <div className="p-6 text-gray-400">Loading…</div>;

  const TABS = [
    ['details', 'Details'], ['funding', 'Funding'], ['medical', 'Medical'],
    ['notes', 'Session Notes'], ['agreements', 'Agreements'], ['forms', 'Forms'], ['billing', 'Billing'], ['reports', 'Reports'], ['files', 'Files'], ['calendar', 'Calendar'], ['history', 'History'],
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
          <button onClick={copyPortalLink}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors">
            {portalLinkCopied ? 'Copied!' : 'Copy portal link'}
          </button>
        )}
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

            {duplicates.length > 0 && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
                <p className="font-medium">Possible duplicate{duplicates.length > 1 ? 's' : ''}:</p>
                {duplicates.map(d => (
                  <p key={d.id} className="text-xs mt-0.5">
                    {d.first_name} {d.last_name} — {d.date_of_birth || 'no DOB'}, {d.phone || 'no phone'}, {d.email || 'no email'}
                    {' '}(matched on {d.match_reason})
                  </p>
                ))}
              </div>
            )}

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

            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Case manager / support coordinator</p>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Name"         value={form.case_manager_name}         onChange={e => set('case_manager_name',         e.target.value)} />
                <Input label="Organisation" value={form.case_manager_organisation} onChange={e => set('case_manager_organisation', e.target.value)} />
                <Input label="Phone"        value={form.case_manager_phone}        onChange={e => set('case_manager_phone',        e.target.value)} />
                <Input label="Email" type="email" value={form.case_manager_email} onChange={e => set('case_manager_email', e.target.value)} />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Notes</label>
              <textarea rows={3} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none focus:border-indigo-500 focus:outline-none"
                value={form.notes} onChange={e => set('notes', e.target.value)} />
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-500 cursor-pointer pt-2 border-t border-gray-100">
              <input type="checkbox" className="accent-gray-400" checked={form.is_test_data} onChange={e => set('is_test_data', e.target.checked)} />
              Test / dummy data <span className="text-gray-400">(hidden from all client lists, regardless of active status)</span>
            </label>
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
        {tab === 'forms'     && (isNew ? <p className="text-sm text-gray-400 py-8 text-center">Save the client first to fill in forms.</p> : <FormsTab clientId={id} client={client} />)}
        {tab === 'billing'   && (isNew ? <p className="text-sm text-gray-400 py-8 text-center">Save the client first to view billing.</p> : <BillingSummaryTab clientId={id} />)}
        {tab === 'reports'   && (isNew ? <p className="text-sm text-gray-400 py-8 text-center">Save the client first to start a report.</p> : <ReportsTab clientId={id} client={client} />)}
        {tab === 'files'     && (isNew ? <p className="text-sm text-gray-400 py-8 text-center">Save the client first to upload files.</p> : <FilesTab     clientId={id} client={client} />)}
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
