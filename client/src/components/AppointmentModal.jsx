import { useState, useEffect, useRef, useCallback } from 'react';
import { format, parseISO } from 'date-fns';
import api from '../lib/api';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { Trash2, Plus, FileText, Pencil, RefreshCw, Mail, AlertCircle, CheckCircle, TriangleAlert } from 'lucide-react';
import { localToday } from '../lib/utils';

const EMPTY_ITEM = { service_id: '', description: '', quantity: 1, unit_rate: 0, travel_time_min: '', travel_km: '', notes_min: '' };

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

function CaseNotesSection({ appointmentId, clientId, practitionerId }) {
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => { if (appointmentId) api.get(`/case-notes?appointment_id=${appointmentId}`).then(r => setNotes(r.data)); };
  useEffect(() => { load(); }, [appointmentId]);

  const addNote = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await api.post('/case-notes', { appointment_id: appointmentId, client_id: clientId, practitioner_id: practitionerId || null, note: draft.trim() });
      setDraft(''); load();
    } finally { setSaving(false); }
  };

  const saveEdit = async id => { await api.patch(`/case-notes/${id}`, { note: editText }); setEditingId(null); load(); };
  const remove   = async id => { if (!confirm('Delete this note?')) return; await api.delete(`/case-notes/${id}`); load(); };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
        <FileText className="h-4 w-4 text-indigo-400" /> Case Notes
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
                <p className="text-xs text-gray-400 mt-1">{n.practitioner_name && <span>{n.practitioner_name} · </span>}{format(parseISO(n.created_at), 'd MMM yyyy h:mm a')}</p>
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
        <textarea rows={3} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          placeholder="Add a case note…" value={draft} onChange={e => setDraft(e.target.value)} />
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

function NotifyBtn({ label, target, status, onClick }) {
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

export default function AppointmentModal({ appointment, defaultDate, onClose, onSaved, onRefresh }) {
  const editing = !!appointment;
  const [practitioners, setPractitioners] = useState([]);
  const [clients, setClients] = useState([]);
  const [services, setServices] = useState([]);
  const [locations, setLocations] = useState([]);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState(editing ? appointment.id : null);
  const [error, setError] = useState('');
  const [notifyStatus, setNotifyStatus] = useState({}); // keyed by target: 'practitioner'|'client'

  const initSplit = iso => splitDT(iso || `${defaultDate}T09:00`);
  const [startDate, setStartDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState('09:00');
  const [endDate,   setEndDate]   = useState(defaultDate);
  const [endTime,   setEndTime]   = useState('10:00');

  const [form, setForm] = useState({
    practitioner_id: '',
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

  useEffect(() => {
    Promise.all([
      api.get('/practitioners?role=practitioner').then(r => r.data),
      api.get('/clients').then(r => r.data),
      api.get('/services').then(r => r.data),
      api.get('/locations').then(r => r.data),
    ]).then(([p, c, s, l]) => { setPractitioners(p); setClients(c); setServices(s); setLocations(l); });

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
          travel_time_min: i.travel_time_min || '',
          travel_km:      i.travel_km || '',
          notes_min:      i.notes_min || '',
        })) : [{ ...EMPTY_ITEM }],
      });
    }
  }, []);

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

  const setItem = (idx, k, v) => setForm(f => {
    const items = [...f.items];
    items[idx] = { ...items[idx], [k]: v };
    if (k === 'service_id' && v) {
      const svc = services.find(s => s.id === Number(v));
      if (svc) {
        items[idx].description = svc.name;
        items[idx].unit_rate = svc.default_rate;
        items[idx].quantity = sessionHours;
      }
    }
    if (k === 'service_id' && !v) {
      items[idx].quantity = 1;
      items[idx].unit_rate = 0;
    }
    return { ...f, items };
  });

  const save = async () => {
    const errors = [];
    if (!form.practitioner_id) errors.push('Practitioner');
    if (!form.client_id) errors.push('Client');
    if (!startDate || !startTime) errors.push('Start date/time');
    if (!endDate || !endTime) errors.push('End date/time');
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
        location_id: form.location_type === 'clinic' && form.location_id ? Number(form.location_id) : null,
        location_other: form.location_type === 'other' ? form.location_other : null,
        items: form.items.map(i => ({
          ...i,
          service_id:      i.service_id ? Number(i.service_id) : null,
          quantity:        Number(i.quantity),
          unit_rate:       Number(i.unit_rate),
          travel_time_min: form.location_type === 'home' && i.travel_time_min ? Number(i.travel_time_min) : null,
          travel_km:       form.location_type === 'home' && i.travel_km ? Number(i.travel_km) : null,
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
      onSaved();
    }
  };

  const cancelSingleFromSeries = async () => {
    const { data } = await api.get(`/appointments/${appointment.id}/cancel-policy`);
    if (data.tier) {
      setSeriesEndPrompt(null);
      setLateCancelConfirm(data);
    } else {
      await api.patch(`/appointments/${appointment.id}/status`, { status: 'cancelled', late_cancel_pct: null, late_cancel_billable: 0 });
      onSaved();
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

    // Check if any cancelled appointments fall within late cancellation policy
    const { data: policyData } = await api.get(`/appointments/${appointment.id}/cancel-policy`);
    if (policyData.tier) {
      setSeriesEndPrompt(null);
      setSeriesLateCancelInfo({ cancelFrom, tier: policyData.tier });
    } else {
      setSeriesEndPrompt(null);
      onSaved();
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
    setLateCancelConfirm(null);
    onSaved();
  };

  const saveSeriesThis = async () => {
    setSaving(true);
    try {
      await api.patch(`/appointments/${appointment.id}`, seriesEditPrompt);
      setSeriesEditPrompt(null);
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
      await api.post(`/appointments/${apptId}/notify`, { eventType: editing ? 'updated' : 'created', target });
      setNotifyStatus(s => ({ ...s, [target]: 'sent' }));
    } catch (e) {
      const msg = e.response?.data?.errors?.[0] || e.response?.data?.error || 'Failed';
      setNotifyStatus(s => ({ ...s, [target]: { error: msg } }));
    }
    setTimeout(() => setNotifyStatus(s => { const n = { ...s }; delete n[target]; return n; }), 5000);
  };

  const calcItemTotal = (item) => {
    const base = Number(item.quantity || 0) * Number(item.unit_rate || 0);
    const svc = item.service_id ? services.find(s => s.id === Number(item.service_id)) : null;
    const travelTimeHrs = Number(item.travel_time_min || 0) / 60;
    const travelTimeCost = travelTimeHrs * Number(svc?.travel_rate_per_hour || item.unit_rate || 0);
    const kmCost = Number(item.travel_km || 0) * Number(svc?.km_rate || 0);
    const notesHrs = Number(item.notes_min || 0) / 60;
    const notesCost = notesHrs * Number(svc?.notes_rate || item.unit_rate || 0);
    return base + travelTimeCost + kmCost + notesCost;
  };

  const selectedPractitioner = practitioners.find(p => p.id === Number(form.practitioner_id));
  const filteredServices = selectedPractitioner?.discipline_id
    ? services.filter(s => !s.discipline_id || s.discipline_id === selectedPractitioner.discipline_id)
    : services;

  const isHome = form.location_type === 'home';

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
              {clients.map(c => <option key={c.id} value={c.id}>{c.last_name}, {c.first_name}</option>)}
            </select>
          </div>
        </div>

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
              <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm mt-1"
                placeholder="Enter address…"
                value={form.location_other} onChange={e => setField('location_other', e.target.value)} />
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
                    <option value="every3weeks">Every 3 weeks</option>
                    <option value="monthly">Monthly</option>
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
                    <select className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                      value={item.service_id} onChange={e => setItem(idx, 'service_id', e.target.value)}>
                      <option value="">Manual…</option>
                      {filteredServices.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
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
                          <label className="text-xs text-gray-500">Travel (min)</label>
                          <input type="number" className="w-20 rounded border border-gray-300 px-2 py-1.5 text-sm"
                            value={item.travel_time_min} onChange={e => setItem(idx, 'travel_time_min', e.target.value)} placeholder="—" />
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
                  <div className={`grid gap-2 ${isHome ? 'grid-cols-4' : 'grid-cols-2'}`}>
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
                          <label className="text-xs text-gray-500">Travel (min)</label>
                          <input type="number" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                            value={item.travel_time_min} onChange={e => setItem(idx, 'travel_time_min', e.target.value)} placeholder="—" />
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
                    <option value="every3weeks">Every 3 weeks</option>
                    <option value="monthly">Monthly</option>
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
            <CaseNotesSection appointmentId={appointment.id} clientId={appointment.client_id} practitionerId={form.practitioner_id} />
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

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
                setSeriesLateCancelInfo(null);
                onSaved();
              }} className="w-full justify-center">
                Apply {seriesLateCancelInfo.tier.percent}% fee to cancelled appointments
              </Button>
              <Button variant="secondary" onClick={() => { setSeriesLateCancelInfo(null); onSaved(); }} className="w-full justify-center">
                Cancel without fee
              </Button>
            </div>
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
