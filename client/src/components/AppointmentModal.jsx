import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../lib/api';
import Modal from './ui/Modal';
import Button from './ui/Button';
import AddressAutocomplete from './AddressAutocomplete';
import { Trash2, Plus, FileText, Pencil, RefreshCw, Mail, AlertCircle, CheckCircle, TriangleAlert } from 'lucide-react';
import { localToday, fmtDate, fmtDateTime } from '../lib/utils';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';

const EMPTY_ITEM = { service_id: '', description: '', quantity: 1, unit_rate: 0, travel_time_to: '', travel_time_from: '', travel_km: '', notes_min: '' };

// Split ISO datetime string into { date, time }
const splitDT = iso => {
  if (!iso) return { date: '', time: '' };
  const [date, time] = iso.slice(0, 16).split('T');
  return { date, time: time || '' };
};
// Combine date + time into ISO-ish string for API
const joinDT = (date, time) => (date && time) ? `${date}T${time}` : '';

// Advance an ISO datetime string by N days (or months)
function addInterval(iso, freq) {
  if (!iso) return iso;
  const d = new Date(iso);
  if (freq === 'weekly')       d.setDate(d.getDate() + 7);
  else if (freq === 'fortnightly') d.setDate(d.getDate() + 14);
  else if (freq === 'every3weeks') d.setDate(d.getDate() + 21);
  else if (freq === 'monthly') d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 16);
}

// Strip HTML tags to plain text, preserving line breaks from block elements
function htmlToPlain(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Format a datetime string as "Monday 06/07/2026"
function fmtNextAppt(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const day = d.toLocaleDateString('en-AU', { weekday: 'long' });
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${day} ${dd}/${mm}/${yyyy}`;
}

function SessionNotesSection({ appointmentId, clientId, appointment }) {
  const { timezone } = useSettings();
  const { user } = useAuth();
  const [notes, setNotes] = useState([]);
  const [noteTemplates, setNoteTemplates] = useState([]);
  const [nextAppt, setNextAppt] = useState('');
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => { if (appointmentId) api.get(`/session-notes?appointment_id=${appointmentId}`).then(r => setNotes(r.data)); };

  useEffect(() => {
    load();
    api.get('/templates?type=session_note').then(r => setNoteTemplates(r.data)).catch(() => {});
    // Find next appointment for this client after today, excluding current one
    if (clientId) {
      const today = new Date().toISOString().slice(0, 10);
      api.get(`/appointments?client_id=${clientId}&from=${today}`)
        .then(r => {
          const future = (r.data || []).filter(a => a.id !== appointmentId && a.status !== 'cancelled');
          if (future.length > 0) setNextAppt(fmtNextAppt(future[0].start_time));
        })
        .catch(() => {});
    }
  }, [appointmentId, clientId]);

  const applyTemplate = t => {
    const today = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
    const clientName = appointment?.client_name || '';
    const clientFirstName = clientName.split(' ')[0] || '';
    const vars = {
      client_name:        clientName,
      client_first_name:  clientFirstName,
      practitioner_name:  appointment?.practitioner_name || (user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : ''),
      date:               today,
      next_appointment:   nextAppt,
    };
    const body = htmlToPlain(t.body);
    const rendered = body.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] !== undefined ? vars[k] : `{{${k}}}`);
    setDraft(rendered);
  };

  const addNote = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await api.post('/session-notes', { appointment_id: appointmentId, client_id: clientId, note: draft.trim() });
      setDraft(''); load();
    } finally { setSaving(false); }
  };

  const saveEdit = async id => { await api.patch(`/session-notes/${id}`, { note: editText }); setEditingId(null); load(); };
  const remove   = async id => { if (!confirm('Delete this note?')) return; await api.delete(`/session-notes/${id}`); load(); };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
        <FileText className="h-4 w-4 text-indigo-400" /> Session Notes
      </div>
      {notes.map(n => (
        <div key={n.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
          {editingId === n.id ? (
            <div className="space-y-2">
              <textarea rows={3} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm resize-none"
                value={editText} onChange={e => setEditText(e.target.value)} autoFocus />
              <div className="flex gap-2 justify-end">
                <Button variant="secondary" size="sm" onClick={() => setEditingId(null)}>Cancel</Button>
                <Button size="sm" onClick={() => saveEdit(n.id)}>Save</Button>
              </div>
            </div>
          ) : (
            <div className="group flex gap-2">
              <div className="flex-1">
                <p className="text-sm text-gray-800 whitespace-pre-wrap">{n.note}</p>
                <p className="text-xs text-gray-400 mt-1">{n.practitioner_name && <span>{n.practitioner_name} · </span>}{fmtDateTime(n.created_at, timezone)}</p>
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button onClick={() => { setEditingId(n.id); setEditText(n.note); }} className="text-gray-400 hover:text-gray-600"><Pencil className="h-3.5 w-3.5" /></button>
                <button onClick={() => remove(n.id)} className="text-red-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          )}
        </div>
      ))}
      <div className="space-y-1.5">
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
        <textarea rows={3} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          placeholder="Add a session note…" value={draft} onChange={e => setDraft(e.target.value)} />
        <div className="flex justify-end">
          <Button size="sm" onClick={addNote} disabled={saving || !draft.trim()}>{saving ? 'Saving…' : 'Add note'}</Button>
        </div>
      </div>
    </div>
  );
}

// Uncontrolled date input — avoids React re-render breaking year typing
function DatePicker({ value, onChange, className }) {
  const ref = useRef();
  const ext = useRef(value);
  useEffect(() => {
    if (ext.current !== value && ref.current) {
      ref.current.value = value || '';
      ext.current = value;
    }
  }, [value]);
  return (
    <input ref={ref} type="date"
      defaultValue={value || ''}
      className={className}
      onChange={e => { ext.current = e.target.value; onChange(e.target.value); }}
    />
  );
}

// AM/PM time picker — value and onChange in "HH:MM" 24h format
function TimePicker({ value, onChange, className }) {
  const parse = v => {
    if (!v) return { h: 9, m: 0, ampm: 'AM' };
    const [hh, mm] = v.split(':').map(Number);
    return { h: hh === 0 ? 12 : hh > 12 ? hh - 12 : hh, m: mm, ampm: hh < 12 ? 'AM' : 'PM' };
  };
  const { h, m, ampm } = parse(value);
  const emit = (newH, newM, newAmpm) => {
    let h24 = newH % 12 + (newAmpm === 'PM' ? 12 : 0);
    onChange(`${String(h24).padStart(2,'0')}:${String(newM).padStart(2,'0')}`);
  };
  const selClass = 'rounded border border-gray-300 px-2 py-2 text-sm bg-white focus:border-indigo-500 focus:outline-none';
  return (
    <div className={`flex gap-1 ${className||''}`}>
      <select value={h} onChange={e => emit(Number(e.target.value), m, ampm)} className={selClass}>
        {[12,1,2,3,4,5,6,7,8,9,10,11].map(n => <option key={n} value={n}>{n}</option>)}
      </select>
      <select value={m} onChange={e => emit(h, Number(e.target.value), ampm)} className={selClass}>
        {[0,15,30,45].map(n => <option key={n} value={n}>{String(n).padStart(2,'0')}</option>)}
      </select>
      <select value={ampm} onChange={e => emit(h, m, e.target.value)} className={selClass}>
        <option>AM</option><option>PM</option>
      </select>
    </div>
  );
}

function AppointmentAuditLog({ appointmentId }) {
  const { timezone } = useSettings();
  const [logs, setLogs] = useState([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open && appointmentId) api.get(`/audit-logs?entity_type=appointment&entity_id=${appointmentId}`).then(r => setLogs(r.data));
  }, [open, appointmentId]);

  const ACTION_COLOR = {
    created: 'text-green-700', updated: 'text-blue-700', status_changed: 'text-amber-600',
    converted_to_series: 'text-indigo-600', voided: 'text-red-600', cancelled: 'text-red-500',
  };

  return (
    <div className="space-y-2">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-indigo-600">
        <FileText className="h-4 w-4 text-gray-400" /> Change History {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {logs.length === 0 ? (
            <p className="text-xs text-gray-400 py-2">No change history recorded.</p>
          ) : logs.map(log => (
            <div key={log.id} className="text-xs border-l-2 border-gray-200 pl-2 py-1">
              <span className={`font-medium ${ACTION_COLOR[log.action] || 'text-gray-600'}`}>{log.action}</span>
              <span className="text-gray-400 ml-1.5">{fmtDateTime(log.created_at, timezone)}</span>
              <p className="text-gray-600 mt-0.5">{log.details}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function NotifyBtn({ label, target, status, onClick }) {
  const sending = status === 'sending';
  const sent    = status === 'sent';
  const err     = status?.error;
  return (
    <div className="flex items-center gap-1.5">
      <Button variant="secondary" size="sm" onClick={onClick} disabled={sending}>
        <Mail className="h-3.5 w-3.5" />
        {sending ? 'Sending…' : label}
      </Button>
      {sent && <CheckCircle className="h-4 w-4 text-green-500" />}
      {err  && <span className="text-xs text-red-600 max-w-[120px] truncate" title={err}><AlertCircle className="h-3.5 w-3.5 inline mr-0.5" />{err}</span>}
    </div>
  );
}

export default function AppointmentModal({ appointment, defaultDate, defaultTime, defaultPractitioner, onClose, onSaved, onRefresh }) {
  const { timezone } = useSettings();
  const { user } = useAuth();
  const editing = !!appointment;
  const [practitioners, setPractitioners] = useState([]);
  const [clients, setClients] = useState([]);
  const [locations, setLocations] = useState([]);
  const [fundingTypes, setFundingTypes] = useState([]);
  // Services (and their rates) are scoped to the selected funder's funding type + the
  // appointment's date — a service only shows up here if it's priced under that scheme
  // for that date (see FundingTypeRates.jsx). Empty until a funder is picked.
  const [scopedServices, setScopedServices] = useState([]);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState(editing ? appointment.id : null);
  const [error, setError] = useState('');
  const [notifyStatus, setNotifyStatus] = useState({});
  const [conflicts, setConflicts] = useState([]);
  const [budgetWarnings, setBudgetWarnings] = useState([]);
  const [fundingPeriods, setFundingPeriods] = useState([]);
  const [fundingPeriodId, setFundingPeriodId] = useState(editing ? (appointment.funding_period_id || '') : '');
  // Item indices whose unit_rate was auto-filled from a service selection this session —
  // only these get refreshed when the date changes, so manual rate overrides and rates
  // already frozen on a loaded (existing) appointment are never silently clobbered.
  const autoRateIdxRef = useRef(new Set());

  const initStartTime = defaultTime || '09:00';
  const initEndTime = (() => {
    if (!defaultTime) return '10:00';
    const [h, m] = defaultTime.split(':').map(Number);
    return `${String(h + 1).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  })();

  const initSplit = iso => splitDT(iso || `${defaultDate}T${initStartTime}`);
  const [startDate, setStartDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState(initStartTime);
  const [endDate,   setEndDate]   = useState(defaultDate);
  const [endTime,   setEndTime]   = useState(initEndTime);

  const [form, setForm] = useState({
    practitioner_id: defaultPractitioner || (user?.role === 'practitioner' ? user.id : ''),
    client_id: '',
    location_type: 'home',
    location_id: '',
    location_other: '',
    title: '',
    status: 'scheduled',
    notes: '',
    items: [{ ...EMPTY_ITEM }],
    late_cancel_pct: '',
    late_cancel_billable: false,
  });

  const [recurrence, setRecurrence] = useState({ enabled: false, freq: 'weekly', days: [], endType: 'never', until: '', occurrences: '' });
  const [lateCancelConfirm, setLateCancelConfirm] = useState(null);
  const [makeRecurring, setMakeRecurring] = useState(null);
  const [convertingRecurring, setConvertingRecurring] = useState(false);
  const [seriesEndPrompt, setSeriesEndPrompt] = useState(null);
  const [seriesEditPrompt, setSeriesEditPrompt] = useState(null); // null | payload // null | { daysUntil, tier }

  // The initial `useState` above only runs once at mount, so if this modal is opened on the
  // main Calendar page — the default landing route right after login — before the async
  // GET /auth/me call resolves, `user` is still null at that instant and the practitioner
  // default never gets baked in. Re-apply it once `user` actually loads (a no-op if it was
  // already set correctly, e.g. when opened from a client page after the app has settled).
  useEffect(() => {
    if (!editing && !defaultPractitioner && user?.role === 'practitioner') {
      setForm(f => f.practitioner_id ? f : { ...f, practitioner_id: user.id });
    }
  }, [user, editing, defaultPractitioner]);

  useEffect(() => {
    Promise.all([
      api.get('/practitioners?role=practitioner').then(r => r.data),
      api.get('/clients').then(r => r.data),
      api.get('/funding-types').then(r => r.data),
      api.get('/locations').then(r => r.data),
    ]).then(([p, c, ft, l]) => { setPractitioners(p); setClients(c); setFundingTypes(ft); setLocations(l); });

    if (editing) {
      const s = splitDT(appointment.start_time);
      const e = splitDT(appointment.end_time);
      setStartDate(s.date); setStartTime(s.time);
      setEndDate(e.date);   setEndTime(e.time);

      const locType = appointment.location_other ? 'other' : appointment.location_id ? 'clinic' : 'home';
      setForm({
        practitioner_id: appointment.practitioner_id,
        client_id:       appointment.client_id,
        location_type:   locType,
        location_id:     appointment.location_id || '',
        location_other:  appointment.location_other || '',
        title:  appointment.title  || '',
        status: appointment.status || 'scheduled',
        notes:  appointment.notes  || '',
        late_cancel_pct:      appointment.late_cancel_pct ?? '',
        late_cancel_billable: appointment.late_cancel_billable ? true : false,
        items: appointment.items?.length ? appointment.items.map(i => ({
          service_id:     i.service_id || '',
          description:    i.description,
          quantity:       i.quantity,
          unit_rate:      i.unit_rate,
          travel_time_to:  i.travel_time_to || '',
          travel_time_from: i.travel_time_from || '',
          travel_km:      i.travel_km || '',
          notes_min:      i.notes_min || '',
        })) : [{ ...EMPTY_ITEM }],
      });
    }
  }, []);

  useEffect(() => {
    if (!form.client_id) { setFundingPeriods([]); setFundingPeriodId(''); return; }
    api.get(`/funding-periods?client_id=${form.client_id}`).then(r => {
      const fps = r.data || [];
      setFundingPeriods(fps);
      if (editing && appointment.funding_period_id) return;
      if (fps.length === 1) { setFundingPeriodId(fps[0].id); return; }
      // Only auto-select when exactly one period actually covers this appointment's date —
      // if multiple funding periods are valid for that date, leave it blank so the (now
      // mandatory) funder field forces an explicit choice rather than silently picking one.
      const apptDate = startDate || localToday();
      const matches = fps.filter(fp => (!fp.start_date || fp.start_date <= apptDate) && (!fp.end_date || fp.end_date >= apptDate));
      setFundingPeriodId(matches.length === 1 ? matches[0].id : '');
    }).catch(() => setFundingPeriods([]));
  }, [form.client_id]);

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const onStartChange = (date, time) => {
    const newStart = joinDT(date, time);
    if (!newStart) return;
    // Auto-set end time to +1 hour
    const end = new Date(new Date(newStart).getTime() + 60 * 60 * 1000);
    const pad = n => String(n).padStart(2, '0');
    setEndDate(`${end.getFullYear()}-${pad(end.getMonth()+1)}-${pad(end.getDate())}`);
    setEndTime(`${pad(end.getHours())}:${pad(end.getMinutes())}`);
  };

  const sessionHours = (() => {
    const s = joinDT(startDate, startTime);
    const e = joinDT(endDate, endTime);
    if (!s || !e) return 1;
    return Math.max((new Date(e) - new Date(s)) / 3600000, 0);
  })();

  // Sync predefined service item quantities when session duration changes
  useEffect(() => {
    setForm(f => {
      const hasServiceItems = f.items.some(i => i.service_id);
      if (!hasServiceItems) return f;
      return { ...f, items: f.items.map(i => i.service_id ? { ...i, quantity: sessionHours } : i) };
    });
  }, [sessionHours]);

  // Check for scheduling conflicts
  useEffect(() => {
    const st = joinDT(startDate, startTime);
    const et = joinDT(endDate, endTime);
    if (!form.practitioner_id && !form.client_id) { setConflicts([]); return; }
    if (!st || !et || st >= et) { setConflicts([]); return; }
    const params = new URLSearchParams({ start_time: st, end_time: et });
    if (form.practitioner_id) params.set('practitioner_id', form.practitioner_id);
    if (form.client_id) params.set('client_id', form.client_id);
    if (editing) params.set('exclude_id', appointment.id);
    const t = setTimeout(() => {
      api.get(`/appointments/check-conflicts?${params}`).then(r => setConflicts(r.data.conflicts || [])).catch(() => setConflicts([]));
    }, 500);
    return () => clearTimeout(t);
  }, [form.practitioner_id, form.client_id, startDate, startTime, endDate, endTime]);

  // Non-blocking budget warning — any of the client's agreements covering this appointment's
  // date, with a budget set, that's at/near its limit. Never prevents saving.
  useEffect(() => {
    if (!form.client_id || !startDate) { setBudgetWarnings([]); return; }
    api.get(`/agreements?client_id=${form.client_id}`).then(async r => {
      const covering = (r.data || []).filter(a =>
        a.budget_amount && a.start_date && startDate >= a.start_date && (!a.end_date || startDate <= a.end_date)
      );
      const spends = await Promise.all(covering.map(a => api.get(`/agreements/${a.id}/spend`).then(sr => ({ title: a.title, ...sr.data })).catch(() => null)));
      setBudgetWarnings(spends.filter(s => s && s.pct_used >= 80));
    }).catch(() => setBudgetWarnings([]));
  }, [form.client_id, startDate]);

  // Resolve which funding type is in play from the selected funder, then load only the
  // services priced under that scheme for the appointment's date — one fetch per
  // (funding type, date) change, no per-service round trips needed.
  const selectedFundingPeriod = fundingPeriods.find(fp => fp.id === Number(fundingPeriodId));
  const fundingTypeId = selectedFundingPeriod
    ? fundingTypes.find(ft => ft.name === selectedFundingPeriod.funding_type)?.id
    : null;

  useEffect(() => {
    if (!fundingTypeId) { setScopedServices([]); return; }
    const date = startDate || localToday();
    api.get(`/funding-types/${fundingTypeId}/service-rates`, { params: { date } }).then(r => setScopedServices(r.data)).catch(() => setScopedServices([]));
  }, [fundingTypeId, startDate]);

  const setItem = (idx, k, v) => {
    if (k === 'unit_rate') autoRateIdxRef.current.delete(idx);
    setForm(f => {
      const items = [...f.items];
      items[idx] = { ...items[idx], [k]: v };
      if (k === 'service_id' && v) {
        const svc = scopedServices.find(s => s.service_id === Number(v));
        if (svc) {
          items[idx].description = svc.service_name;
          items[idx].unit_rate = svc.rate;
          items[idx].quantity = sessionHours;
        }
        autoRateIdxRef.current.add(idx);
      }
      if (k === 'service_id' && !v) {
        items[idx].quantity = 1;
        items[idx].unit_rate = 0;
        autoRateIdxRef.current.delete(idx);
      }
      return { ...f, items };
    });
  };

  // When the scoped services list refreshes (funder or date changed), re-apply the current
  // rate for any item whose service was auto-selected this session — never touches manual
  // overrides or rates already frozen on a loaded (existing) appointment.
  useEffect(() => {
    setForm(f => {
      let changed = false;
      const items = f.items.map((item, idx) => {
        if (!item.service_id || !autoRateIdxRef.current.has(idx)) return item;
        const svc = scopedServices.find(s => s.service_id === Number(item.service_id));
        if (!svc || svc.rate === item.unit_rate) return item;
        changed = true;
        return { ...item, unit_rate: svc.rate };
      });
      return changed ? { ...f, items } : f;
    });
  }, [scopedServices]);

  const save = async () => {
    const errors = [];
    if (!form.practitioner_id) errors.push('Practitioner');
    if (!form.client_id) errors.push('Client');
    if (fundingPeriods.length > 0 && !fundingPeriodId) errors.push('Funder');
    if (!startDate || !startTime) errors.push('Start date/time');
    if (!endDate || !endTime) errors.push('End date/time');
    if (form.location_type === 'clinic' && !form.location_id) errors.push('Clinic location');
    if (form.location_type === 'other' && !form.location_other.trim()) errors.push('Location address');
    if (form.items.some(i => !i.service_id)) errors.push('Service (for every line item)');
    if (recurrence.enabled && recurrence.endType === 'on' && !recurrence.until) errors.push('Repeat end date');
    if (recurrence.enabled && recurrence.endType === 'after' && !recurrence.occurrences) errors.push('Number of occurrences');
    if (errors.length) {
      setError(`Please fill in required fields: ${errors.join(', ')}`);
      return;
    }
    setSaving(true); setError('');
    try {
      const payload = {
        ...form,
        start_time: joinDT(startDate, startTime),
        end_time:   joinDT(endDate,   endTime),
        practitioner_id: Number(form.practitioner_id),
        client_id:       Number(form.client_id),
        funding_period_id: fundingPeriodId ? Number(fundingPeriodId) : null,
        location_id: form.location_type === 'clinic' && form.location_id ? Number(form.location_id) : null,
        location_other: form.location_type === 'other' ? form.location_other : null,
        items: form.items.map(i => ({
          ...i,
          service_id:      i.service_id ? Number(i.service_id) : null,
          quantity:        Number(i.quantity),
          unit_rate:       Number(i.unit_rate),
          travel_time_to:  form.location_type !== 'clinic' && i.travel_time_to ? Number(i.travel_time_to) : null,
          travel_time_from: form.location_type !== 'clinic' && i.travel_time_from ? Number(i.travel_time_from) : null,
          travel_km:       form.location_type !== 'clinic' && i.travel_km ? Number(i.travel_km) : null,
          notes_min:       i.notes_min ? Number(i.notes_min) : null,
        })),
        recurrence: recurrence.enabled ? {
          freq: recurrence.freq,
          until: recurrence.endType === 'on' ? recurrence.until : undefined,
          occurrences: recurrence.endType === 'after' ? Number(recurrence.occurrences) : undefined,
        } : null,
      };
      if (editing && appointment.series_id) {
        setSeriesEditPrompt(payload);
        setSaving(false);
        return;
      } else if (editing) {
        await api.patch(`/appointments/${appointment.id}`, payload);
        onSaved();
      } else if (recurrence.enabled) {
        // Create via recurring series API
        await api.post('/recurring-series', payload);
        if (onRefresh) onRefresh();
        onSaved();
      } else {
        const res = await api.post('/appointments', payload);
        setSavedId(res.data.id);
        if (onRefresh) onRefresh();
      }
      // Note: email errors are logged server-side; resend manually if needed
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  };

  const [lastSeriesScope, setLastSeriesScope] = useState(null);
  const [cancelledConfirm, setCancelledConfirm] = useState(false);

  const del = async () => {
    if (appointment.series_id) {
      setSeriesEndPrompt({ step: 'choose', endDate: localToday() });
      return;
    }
    const { data } = await api.get(`/appointments/${appointment.id}/cancel-policy`);
    if (data.tier) {
      setLateCancelConfirm(data);
    } else {
      if (!confirm('Cancel this appointment?')) return;
      await api.patch(`/appointments/${appointment.id}/status`, { status: 'cancelled', late_cancel_pct: null, late_cancel_billable: 0 });
      setField('status', 'cancelled');
      setLastSeriesScope('this_only');
      setCancelledConfirm(true);
    }
  };

  const cancelSingleFromSeries = async () => {
    const { data } = await api.get(`/appointments/${appointment.id}/cancel-policy`);
    if (data.tier) {
      setSeriesEndPrompt(null);
      setLateCancelConfirm(data);
    } else {
      await api.patch(`/appointments/${appointment.id}/status`, { status: 'cancelled', late_cancel_pct: null, late_cancel_billable: 0 });
      setField('status', 'cancelled');
      setLastSeriesScope('this_only');
      setSeriesEndPrompt(null);
      setCancelledConfirm(true);
    }
  };

  const endSeriesFromDate = async (cancelFrom) => {
    // Set end date to day before cancel-from so the series ends before the cancellation date
    const endDateObj = new Date(cancelFrom);
    endDateObj.setDate(endDateObj.getDate() - 1);
    const endDate = endDateObj.toISOString().slice(0, 10);

    const res = await api.patch(`/recurring-series/${appointment.series_id}`, {
      end_type: 'date',
      end_date: endDate,
    });

    setLastSeriesScope('future');

    // Check if any cancelled appointments fall within late cancellation policy
    const { data: policyData } = await api.get(`/appointments/${appointment.id}/cancel-policy`);
    if (policyData.tier) {
      setSeriesEndPrompt(null);
      setSeriesLateCancelInfo({ cancelFrom, tier: policyData.tier });
    } else {
      setField('status', 'cancelled');
      setSeriesEndPrompt(null);
      setCancelledConfirm(true);
    }
  };

  const [seriesLateCancelInfo, setSeriesLateCancelInfo] = useState(null);

  const confirmCancel = async (applyPolicy) => {
    const pct = applyPolicy ? lateCancelConfirm.tier.percent : null;
    await api.patch(`/appointments/${appointment.id}/status`, {
      status: 'cancelled',
      late_cancel_pct: pct ? Number(pct) : null,
      late_cancel_billable: applyPolicy ? 1 : 0,
    });
    setField('status', 'cancelled');
    setLateCancelConfirm(null);
    setLastSeriesScope('this_only');
    setCancelledConfirm(true);
  };

  const saveSeriesThis = async () => {
    setSaving(true);
    try {
      await api.patch(`/appointments/${appointment.id}`, seriesEditPrompt);
      setSeriesEditPrompt(null);
      setLastSeriesScope('this_only');
      onSaved();
    } finally { setSaving(false); }
  };

  const saveSeriesFuture = async () => {
    setSaving(true);
    try {
      await api.patch(`/appointments/${appointment.id}`, seriesEditPrompt);
      await api.patch(`/recurring-series/${appointment.series_id}`, {
        ...seriesEditPrompt,
        apply_from: seriesEditPrompt.start_time?.slice(0, 10),
      });
      setSeriesEditPrompt(null);
      setLastSeriesScope('future');
      onSaved();
    } finally { setSaving(false); }
  };

  const convertToRecurring = async () => {
    setConvertingRecurring(true);
    try {
      await api.post('/recurring-series/from-appointment', {
        appointment_id: appointment.id,
        freq: makeRecurring.freq,
        endType: makeRecurring.endType,
        until: makeRecurring.endType === 'on' ? makeRecurring.until : undefined,
        occurrences: makeRecurring.endType === 'after' ? Number(makeRecurring.occurrences) : undefined,
      });
      if (onRefresh) onRefresh();
      onSaved();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to convert');
    } finally { setConvertingRecurring(false); }
  };

  const notify = async (target) => {
    const apptId = editing ? appointment.id : savedId;
    if (!apptId) return;
    setNotifyStatus(s => ({ ...s, [target]: 'sending' }));
    try {
      const eventType = form.status === 'cancelled' ? 'cancelled' : (editing ? 'updated' : 'created');
      await api.post(`/appointments/${apptId}/notify`, { eventType, target, scope: lastSeriesScope });
      setNotifyStatus(s => ({ ...s, [target]: 'sent' }));
    } catch (e) {
      const msg = e.response?.data?.errors?.[0] || e.response?.data?.error || 'Failed';
      setNotifyStatus(s => ({ ...s, [target]: { error: msg } }));
    }
    setTimeout(() => setNotifyStatus(s => { const n = { ...s }; delete n[target]; return n; }), 5000);
  };

  const calcItemTotal = (item) => {
    const base = Number(item.quantity || 0) * Number(item.unit_rate || 0);
    const svc = item.service_id ? scopedServices.find(s => s.service_id === Number(item.service_id)) : null;
    const travelTimeHrs = (Number(item.travel_time_to || 0) + Number(item.travel_time_from || 0)) / 60;
    const travelTimeCost = travelTimeHrs * Number(svc?.travel_rate_per_hour || item.unit_rate || 0);
    const kmCost = Number(item.travel_km || 0) * Number(svc?.km_rate || 0);
    const notesHrs = Number(item.notes_min || 0) / 60;
    const notesCost = notesHrs * Number(svc?.notes_rate || item.unit_rate || 0);
    return base + travelTimeCost + kmCost + notesCost;
  };

  const selectedPractitioner = practitioners.find(p => p.id === Number(form.practitioner_id));
  const filteredServices = selectedPractitioner?.discipline_id
    ? scopedServices.filter(s => !s.discipline_id || s.discipline_id === selectedPractitioner.discipline_id)
    : scopedServices;

  const isHome = form.location_type === 'home' || form.location_type === 'other';

  return (
    <Modal title={editing ? `Edit Appointment — APT-${String(appointment.id).padStart(5,'0')}` : 'New Appointment'} onClose={onClose} wide>
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">

        {/* Practitioner + Client */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Practitioner</label>
            <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={form.practitioner_id} onChange={e => setField('practitioner_id', e.target.value)}>
              <option value="">Select…</option>
              {practitioners.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Client</label>
            <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={form.client_id} onChange={e => setField('client_id', e.target.value)}>
              <option value="">Select…</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
            </select>
          </div>
        </div>

        {/* Funder */}
        {fundingPeriods.length > 0 && (
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Funder</label>
            <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={fundingPeriodId} onChange={e => setFundingPeriodId(e.target.value)}>
              <option value="">Select funder…</option>
              {fundingPeriods.map(fp => (
                <option key={fp.id} value={fp.id}>
                  {fp.funding_type}{fp.funds_manager_name ? ` — ${fp.funds_manager_name}` : ''} ({fp.start_date} to {fp.end_date})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Date / Time — split inputs */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Start</label>
            <div className="flex gap-2">
              <DatePicker className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                value={startDate} onChange={v => { setStartDate(v); onStartChange(v, startTime); }} />
              <TimePicker value={startTime} onChange={v => { setStartTime(v); onStartChange(startDate, v); }} />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">End</label>
            <div className="flex gap-2">
              <DatePicker className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                value={endDate} onChange={setEndDate} />
              <TimePicker value={endTime} onChange={setEndTime} />
            </div>
          </div>
        </div>

        {/* Conflict warnings */}
        {conflicts.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 space-y-1">
            {conflicts.map((c, i) => (
              <p key={i} className="text-sm text-amber-800 flex items-start gap-2">
                <span className="text-amber-500 mt-0.5 shrink-0">⚠</span> {c.message}
              </p>
            ))}
          </div>
        )}

        {/* Budget warnings — informational only, never blocks saving */}
        {budgetWarnings.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 space-y-1">
            {budgetWarnings.map((b, i) => (
              <p key={i} className="text-sm text-amber-800 flex items-start gap-2">
                <span className="text-amber-500 mt-0.5 shrink-0">⚠</span>
                "{b.title}" budget is at {Math.round(b.pct_used)}% (${b.total.toFixed(2)} of ${b.budget_amount.toFixed(2)}).
              </p>
            ))}
          </div>
        )}

        {/* Location + Status */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Location</label>
            <div className="flex gap-3 mt-1 flex-wrap">
              {[['home', 'Client Home'], ['clinic', 'Clinic'], ['other', 'Other']].map(([type, label]) => (
                <label key={type} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" name="location_type" value={type}
                    checked={form.location_type === type}
                    onChange={() => setField('location_type', type)}
                    className="accent-indigo-600" />
                  {label}
                </label>
              ))}
            </div>
            {form.location_type === 'clinic' && (
              <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm mt-1"
                value={form.location_id} onChange={e => setField('location_id', e.target.value)}>
                <option value="">Select clinic…</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            )}
            {form.location_type === 'other' && (
              <div className="mt-1">
                <AddressAutocomplete
                  value={form.location_other}
                  onChange={v => setField('location_other', v)}
                  placeholder="Enter address…"
                />
              </div>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Status</label>
            <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={form.status} onChange={e => setField('status', e.target.value)}>
              {['scheduled','confirmed','completed','cancelled','no_show'].map(s =>
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              )}
            </select>
          </div>
        </div>

        {/* Recurring (new appointments only) */}
        {!editing && (
          <div className="rounded-lg border border-gray-200 p-4 space-y-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <button type="button" onClick={() => setRecurrence(r => ({ ...r, enabled: !r.enabled }))}
                className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${recurrence.enabled ? 'bg-indigo-600' : 'bg-gray-200'}`}>
                <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform mt-0.5 ${recurrence.enabled ? 'translate-x-5.5 ml-[22px]' : 'translate-x-0.5 ml-[2px]'}`} />
              </button>
              <span className="text-sm font-medium text-gray-900">Repeat</span>
            </label>

            {recurrence.enabled && (
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <label className="text-sm text-gray-600 w-24 shrink-0">Repeat:</label>
                  <select className="flex-1 rounded-lg border-2 border-indigo-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                    value={recurrence.freq} onChange={e => setRecurrence(r => ({ ...r, freq: e.target.value }))}>
                    <option value="weekly">Weekly</option>
                    <option value="fortnightly">Fortnightly</option>
                  </select>
                </div>

                <div className="space-y-3">
                  <label className="text-sm text-gray-600">Ends:</label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="radio" name="endType" className="accent-indigo-600"
                      checked={recurrence.endType === 'never'}
                      onChange={() => setRecurrence(r => ({ ...r, endType: 'never' }))} />
                    <span className="text-sm text-gray-700">Never</span>
                    <span className="text-xs text-gray-400">(generates 2 months ahead automatically)</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="radio" name="endType" className="accent-indigo-600"
                      checked={recurrence.endType === 'after'}
                      onChange={() => setRecurrence(r => ({ ...r, endType: 'after' }))} />
                    <span className="text-sm text-gray-700 w-12">After</span>
                    <input type="number" min="1" placeholder="" className="w-20 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                      value={recurrence.occurrences} onChange={e => setRecurrence(r => ({ ...r, occurrences: e.target.value, endType: 'after' }))} />
                    <span className="text-sm text-gray-500">Occurrences</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="radio" name="endType" className="accent-indigo-600"
                      checked={recurrence.endType === 'on'}
                      onChange={() => setRecurrence(r => ({ ...r, endType: 'on' }))} />
                    <span className="text-sm text-gray-700 w-12">On</span>
                    <DatePicker className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                      value={recurrence.until} onChange={v => setRecurrence(r => ({ ...r, until: v, endType: 'on' }))} />
                  </label>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Line items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Services / Items</span>
            <Button variant="ghost" size="sm" onClick={() => setForm(f => ({ ...f, items: [...f.items, { ...EMPTY_ITEM }] }))}>
              <Plus className="h-3.5 w-3.5" /> Add item
            </Button>
          </div>
          <div className="space-y-3">
            {form.items.map((item, idx) => (
              <div key={idx} className="rounded-lg border border-gray-200 p-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs text-gray-500">Service</label>
                    <select className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-400"
                      value={item.service_id} onChange={e => setItem(idx, 'service_id', e.target.value)}
                      disabled={!fundingTypeId}>
                      <option value="">{fundingTypeId ? 'Manual…' : 'Select a funder first…'}</option>
                      {filteredServices.map(s => <option key={s.service_id} value={s.service_id}>{s.service_name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-500">Description</label>
                    <input className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                      value={item.description} onChange={e => setItem(idx, 'description', e.target.value)} />
                  </div>
                </div>
                {item.service_id ? (
                  <div className="flex items-center gap-4 text-sm text-gray-600">
                    <span>${Number(item.unit_rate).toFixed(2)}/hr</span>
                    <span>×</span>
                    <span>{sessionHours.toFixed(2)} hrs</span>
                    {isHome && (
                      <>
                        <div className="space-y-1">
                          <label className="text-xs text-gray-500">Travel to (min)</label>
                          <input type="number" className="w-20 rounded border border-gray-300 px-2 py-1.5 text-sm"
                            value={item.travel_time_to} onChange={e => setItem(idx, 'travel_time_to', e.target.value)} placeholder="—" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-gray-500">Travel from (min)</label>
                          <input type="number" className="w-20 rounded border border-gray-300 px-2 py-1.5 text-sm"
                            value={item.travel_time_from} onChange={e => setItem(idx, 'travel_time_from', e.target.value)} placeholder="—" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-gray-500">Travel (km)</label>
                          <input type="number" step="0.1" className="w-20 rounded border border-gray-300 px-2 py-1.5 text-sm"
                            value={item.travel_km} onChange={e => setItem(idx, 'travel_km', e.target.value)} placeholder="—" />
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className={`grid gap-2 ${isHome ? 'grid-cols-5' : 'grid-cols-2'}`}>
                    <div className="space-y-1">
                      <label className="text-xs text-gray-500">Qty</label>
                      <input type="number" step="0.25" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                        value={item.quantity} onChange={e => setItem(idx, 'quantity', e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-gray-500">Rate ($)</label>
                      <input type="number" step="0.01" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                        value={item.unit_rate} onChange={e => setItem(idx, 'unit_rate', e.target.value)} />
                    </div>
                    {isHome && (
                      <>
                        <div className="space-y-1">
                          <label className="text-xs text-gray-500">Travel to (min)</label>
                          <input type="number" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                            value={item.travel_time_to} onChange={e => setItem(idx, 'travel_time_to', e.target.value)} placeholder="—" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-gray-500">Travel from (min)</label>
                          <input type="number" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                            value={item.travel_time_from} onChange={e => setItem(idx, 'travel_time_from', e.target.value)} placeholder="—" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-gray-500">Travel (km)</label>
                          <input type="number" step="0.1" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                            value={item.travel_km} onChange={e => setItem(idx, 'travel_km', e.target.value)} placeholder="—" />
                        </div>
                      </>
                    )}
                  </div>
                )}
                <div className="flex items-end justify-between">
                  <div className="w-28 space-y-1">
                    <label className="text-xs text-gray-500">Notes (min)</label>
                    <input type="number" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                      value={item.notes_min} onChange={e => setItem(idx, 'notes_min', e.target.value)} placeholder="—" />
                  </div>
                  <span className="text-sm text-gray-500 pb-1">
                    ${calcItemTotal(item).toFixed(2)}
                  </span>
                  {form.items.length > 1 && (
                    <button onClick={() => setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))}
                      className="pb-1 text-red-400 hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end pt-2 border-t border-gray-100 mt-2">
            <span className="text-sm font-semibold text-gray-900">
              Session total: ${form.items.reduce((sum, i) => sum + calcItemTotal(i), 0).toFixed(2)}
            </span>
          </div>
        </div>

        {/* Appointment notes */}
        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700">Appointment Notes</label>
          <textarea rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none"
            value={form.notes} onChange={e => setField('notes', e.target.value)} />
        </div>

        {/* Late cancellation billing — shown when status is cancelled */}
        {form.status === 'cancelled' && editing && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
            <p className="text-sm font-medium text-amber-800">Late Cancellation Billing</p>
            <div className="flex items-center gap-4 flex-wrap">
              <label className="flex items-center gap-2 text-sm text-amber-900 cursor-pointer select-none">
                <input type="checkbox" className="accent-amber-600"
                  checked={!!form.late_cancel_billable}
                  onChange={e => setField('late_cancel_billable', e.target.checked)} />
                Bill this cancellation
              </label>
              {form.late_cancel_billable && (
                <div className="flex items-center gap-2">
                  <label className="text-sm text-amber-800">Charge rate:</label>
                  <input type="number" min="0" max="100" placeholder="%"
                    className="w-20 rounded border border-amber-300 bg-white px-2 py-1 text-sm"
                    value={form.late_cancel_pct}
                    onChange={e => setField('late_cancel_pct', e.target.value)} />
                  <span className="text-sm text-amber-800">%</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Make recurring — shown for standalone appointments */}
        {editing && !appointment.series_id && form.status !== 'cancelled' && (
          <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3 space-y-2">
            {!makeRecurring ? (
              <button onClick={() => setMakeRecurring({ freq: 'weekly', endType: 'never', until: '', occurrences: '' })}
                className="flex items-center gap-2 text-sm font-medium text-indigo-700 hover:text-indigo-800">
                <RefreshCw className="h-3.5 w-3.5" /> Make this a recurring appointment
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm font-medium text-indigo-800">Convert to recurring series</p>
                <div className="flex items-center gap-3">
                  <label className="text-xs text-gray-600">Frequency:</label>
                  <select className="rounded border border-indigo-200 px-2 py-1.5 text-sm bg-white"
                    value={makeRecurring.freq} onChange={e => setMakeRecurring(r => ({ ...r, freq: e.target.value }))}>
                    <option value="weekly">Weekly</option>
                    <option value="fortnightly">Fortnightly</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="radio" className="accent-indigo-600" checked={makeRecurring.endType === 'never'}
                      onChange={() => setMakeRecurring(r => ({ ...r, endType: 'never' }))} />
                    <span>Never ends</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="radio" className="accent-indigo-600" checked={makeRecurring.endType === 'on'}
                      onChange={() => setMakeRecurring(r => ({ ...r, endType: 'on' }))} />
                    <span>End on</span>
                    <input type="date" className="rounded border border-gray-300 px-2 py-1 text-xs"
                      value={makeRecurring.until} onChange={e => setMakeRecurring(r => ({ ...r, until: e.target.value, endType: 'on' }))} />
                  </label>
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="radio" className="accent-indigo-600" checked={makeRecurring.endType === 'after'}
                      onChange={() => setMakeRecurring(r => ({ ...r, endType: 'after' }))} />
                    <span>After</span>
                    <input type="number" min="1" className="w-14 rounded border border-gray-300 px-2 py-1 text-xs"
                      value={makeRecurring.occurrences} onChange={e => setMakeRecurring(r => ({ ...r, occurrences: e.target.value, endType: 'after' }))} />
                    <span>occurrences</span>
                  </label>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={convertToRecurring} disabled={convertingRecurring}>
                    {convertingRecurring ? 'Converting…' : 'Create series'}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setMakeRecurring(null)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Link to series if part of one */}
        {editing && appointment.series_id && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <a href={`/recurring-series/${appointment.series_id}`}
              className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800">
              <RefreshCw className="h-3.5 w-3.5" /> Part of a recurring series — view series
            </a>
          </div>
        )}

        {editing && (
          <div className="border-t border-gray-100 pt-4">
            <SessionNotesSection appointmentId={appointment.id} clientId={appointment.client_id} appointment={appointment} />
          </div>
        )}

        {editing && (
          <div className="border-t border-gray-100 pt-4">
            <AppointmentAuditLog appointmentId={appointment.id} />
          </div>
        )}

      </div>

      {/* Error popup — validation failures and save/API errors alike, always front-and-center
          rather than an easy-to-miss inline message at the bottom of a scrollable form. */}
      {error && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <div className="flex items-start gap-3">
              <TriangleAlert className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-gray-700">{error}</p>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setError('')}>OK</Button>
            </div>
          </div>
        </div>
      )}

      {/* Series edit prompt — this only or all future */}
      {seriesEditPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <h3 className="font-semibold text-gray-900">This is a recurring appointment</h3>
            <p className="text-sm text-gray-600">Do you want to update just this appointment, or apply changes to all future appointments in this series?</p>
            <div className="flex flex-col gap-2">
              <Button onClick={saveSeriesThis} disabled={saving} className="w-full justify-center">
                {saving ? 'Saving…' : 'Save this appointment only'}
              </Button>
              <Button variant="secondary" onClick={saveSeriesFuture} disabled={saving} className="w-full justify-center">
                {saving ? 'Saving…' : 'Save this and all future appointments'}
              </Button>
              <Button variant="ghost" onClick={() => setSeriesEditPrompt(null)} className="w-full justify-center text-gray-500">
                Go back
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Series cancel prompt */}
      {seriesEndPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            {seriesEndPrompt.step === 'choose' ? (
              <>
                <h3 className="font-semibold text-gray-900">This is a recurring appointment</h3>
                <div className="flex flex-col gap-2">
                  <Button onClick={cancelSingleFromSeries} className="w-full justify-center">
                    Cancel this appointment only
                  </Button>
                  <Button variant="secondary" onClick={() => setSeriesEndPrompt(s => ({ ...s, step: 'pickDate' }))} className="w-full justify-center">
                    End this series…
                  </Button>
                  <Button variant="ghost" onClick={() => setSeriesEndPrompt(null)} className="w-full justify-center text-gray-500">
                    Go back
                  </Button>
                </div>
              </>
            ) : (
              <>
                <h3 className="font-semibold text-gray-900">End recurring series</h3>
                <p className="text-sm text-gray-600">All scheduled appointments from this date onwards will be cancelled. The series will stop generating new ones.</p>
                <div className="space-y-1">
                  <label className="text-sm text-gray-700">Cancel from:</label>
                  <input type="date" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    value={seriesEndPrompt.endDate}
                    onChange={e => setSeriesEndPrompt(s => ({ ...s, endDate: e.target.value }))} />
                </div>
                <div className="flex flex-col gap-2">
                  <Button onClick={() => endSeriesFromDate(seriesEndPrompt.endDate)} className="w-full justify-center">
                    Cancel all from {seriesEndPrompt.endDate}
                  </Button>
                  <Button variant="ghost" onClick={() => setSeriesEndPrompt(s => ({ ...s, step: 'choose' }))} className="w-full justify-center text-gray-500">
                    Go back
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Series late cancellation policy — shown after ending a series */}
      {seriesLateCancelInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <div className="flex items-start gap-3">
              <TriangleAlert className="h-6 w-6 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-gray-900">Late Cancellation Policy</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Some cancelled appointments fall within your late cancellation policy
                  (<span className="font-medium text-amber-700">{seriesLateCancelInfo.tier.percent}%</span> within{' '}
                  <span className="font-medium">{seriesLateCancelInfo.tier.days} days</span>).
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Button onClick={async () => {
                // Apply late cancel fee to all cancelled appointments from that date within policy window
                const appts = await api.get(`/appointments?series_id=${appointment.series_id}&from=${seriesLateCancelInfo.cancelFrom}`);
                for (const a of (appts.data || [])) {
                  if (a.status === 'cancelled') {
                    await api.patch(`/appointments/${a.id}/status`, {
                      status: 'cancelled',
                      late_cancel_pct: Number(seriesLateCancelInfo.tier.percent),
                      late_cancel_billable: 1,
                    });
                  }
                }
                setField('status', 'cancelled');
                setSeriesLateCancelInfo(null);
                setCancelledConfirm(true);
              }} className="w-full justify-center">
                Apply {seriesLateCancelInfo.tier.percent}% fee to cancelled appointments
              </Button>
              <Button variant="secondary" onClick={() => { setField('status', 'cancelled'); setSeriesLateCancelInfo(null); setCancelledConfirm(true); }} className="w-full justify-center">
                Cancel without fee
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Post-cancellation notify prompt */}
      {cancelledConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <h3 className="font-semibold text-gray-900">Appointment cancelled</h3>
            <p className="text-sm text-gray-600">Send a notification about this cancellation?</p>
            <div className="flex items-center gap-2">
              <NotifyBtn label="Notify Practitioner" target="practitioner" status={notifyStatus.practitioner} onClick={() => notify('practitioner')} />
              <NotifyBtn label="Notify Client"       target="client"       status={notifyStatus.client}       onClick={() => notify('client')} />
            </div>
            <Button variant="secondary" onClick={onSaved} className="w-full justify-center">Done</Button>
          </div>
        </div>
      )}

      {/* Late cancellation policy confirmation */}
      {lateCancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <div className="flex items-start gap-3">
              <TriangleAlert className="h-6 w-6 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-gray-900">Late Cancellation</h3>
                <p className="text-sm text-gray-600 mt-1">
                  This appointment is <span className="font-medium">{lateCancelConfirm.daysUntil < 0 ? 'in the past' : `${lateCancelConfirm.daysUntil.toFixed(1)} days away`}</span>.
                  Your policy charges <span className="font-medium text-amber-700">{lateCancelConfirm.tier.percent}%</span> for cancellations within{' '}
                  <span className="font-medium">{lateCancelConfirm.tier.days} days</span>.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Button onClick={() => confirmCancel(true)} className="w-full justify-center">
                Apply {lateCancelConfirm.tier.percent}% late cancellation fee
              </Button>
              <Button variant="secondary" onClick={() => confirmCancel(false)} className="w-full justify-center">
                Cancel without fee (override)
              </Button>
              <Button variant="ghost" onClick={() => setLateCancelConfirm(null)} className="w-full justify-center text-gray-500">
                Go back
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 pt-4 border-t border-gray-100 mt-4 flex-wrap">
        {editing && form.status !== 'cancelled' && <Button variant="danger" size="sm" onClick={del}>Cancel appointment</Button>}

        {/* Email send buttons — shown when editing or after new appointment is saved */}
        {(editing || savedId) && (
          <>
            <NotifyBtn label="Notify Practitioner" target="practitioner" status={notifyStatus.practitioner} onClick={() => notify('practitioner')} />
            <NotifyBtn label="Notify Client"       target="client"       status={notifyStatus.client}       onClick={() => notify('client')} />
          </>
        )}

        <div className="ml-auto flex gap-2">
          {savedId && !editing
            ? <Button onClick={onSaved}>Done</Button>
            : <>
                <Button variant="secondary" onClick={onClose}>Close</Button>
                <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
              </>
          }
        </div>
      </div>
    </Modal>
  );
}
