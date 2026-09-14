import { useState, useEffect } from 'react';
import api from '../lib/api';
import Modal from './ui/Modal';
import Button from './ui/Button';
import DateTimeStepper from './DateTimeStepper';

// Deliberately not built as a mode inside AppointmentModal (a ~2000-line component with a lot
// of billing/series logic already in it) — a block has no client, no funder, no billing items,
// so it gets its own small form instead of risking a regression in that component for an
// unrelated feature. See server/database.js's practitioner_time_blocks table comment for why
// blocks live outside appointments entirely. Date/time picking still uses the shared
// DateTimeStepper (extracted out of AppointmentModal) so both forms feel the same to use.
export default function BlockTimeModal({ block, defaultDate, defaultTime, defaultPractitioner, practitioners, onClose, onSaved }) {
  const isEdit = !!block;
  const [practitionerId, setPractitionerId] = useState(block?.practitioner_id || defaultPractitioner || (practitioners[0]?.id ?? ''));
  const [startDate, setStartDate] = useState(block ? block.start_time.slice(0, 10) : defaultDate);
  const [startTime, setStartTime] = useState(block ? block.start_time.slice(11, 16) : (defaultTime || '09:00'));
  const [endDate, setEndDate] = useState(block ? block.end_time.slice(0, 10) : defaultDate);
  const [endTime, setEndTime] = useState(block ? block.end_time.slice(11, 16) : addHour(defaultTime || '09:00'));
  const [reason, setReason] = useState(block?.reason || '');
  const [conflicts, setConflicts] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function addHour(t) {
    const [h, m] = t.split(':').map(Number);
    return `${String((h + 1) % 24).padStart(2, '0')}:${m ? String(m).padStart(2, '0') : '00'}`;
  }

  // Matches AppointmentModal's onStartChange — moving the start always resets the end to
  // start+1hr, rather than trying to preserve whatever duration was previously set.
  const onStartChange = (date, time) => {
    const newStart = new Date(`${date}T${time}`);
    if (Number.isNaN(newStart.getTime())) return;
    const end = new Date(newStart.getTime() + 60 * 60 * 1000);
    const pad = n => String(n).padStart(2, '0');
    setEndDate(`${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`);
    setEndTime(`${pad(end.getHours())}:${pad(end.getMinutes())}`);
  };

  const startISO = `${startDate}T${startTime}`;
  const endISO = `${endDate}T${endTime}`;

  useEffect(() => {
    if (!practitionerId || !startISO || !endISO || endISO <= startISO) { setConflicts([]); return; }
    const params = new URLSearchParams({ practitioner_id: practitionerId, start_time: startISO, end_time: endISO });
    if (isEdit) params.set('exclude_block_id', block.id);
    api.get(`/appointments/check-conflicts?${params}`).then(r => setConflicts(r.data.conflicts || [])).catch(() => setConflicts([]));
  }, [practitionerId, startISO, endISO]);

  const save = async () => {
    setError('');
    if (endISO <= startISO) { setError('End time must be after start time.'); return; }
    setSaving(true);
    try {
      const payload = { practitioner_id: practitionerId, start_time: startISO, end_time: endISO, reason: reason.trim() };
      if (isEdit) await api.patch(`/time-blocks/${block.id}`, payload);
      else await api.post('/time-blocks', payload);
      onSaved();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to save blocked time');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm('Remove this blocked time?')) return;
    setSaving(true);
    try {
      await api.delete(`/time-blocks/${block.id}`);
      onSaved();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to remove blocked time');
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? 'Edit blocked time' : 'Block time'} onClose={onClose}>
      <div className="space-y-3">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        {conflicts.map((c, i) => (
          <div key={i} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{c.message}</div>
        ))}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Practitioner</label>
          <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            value={practitionerId} onChange={e => setPractitionerId(Number(e.target.value))}>
            {practitioners.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Start</label>
          <DateTimeStepper date={startDate} time={startTime} onChange={(d, t) => { setStartDate(d); setStartTime(t); onStartChange(d, t); }} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">End</label>
          <DateTimeStepper date={endDate} time={endTime} onChange={(d, t) => { setEndDate(d); setEndTime(t); }} />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Reason <span className="font-normal text-gray-400">(optional)</span></label>
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Training, annual leave"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
          <p className="text-xs text-gray-400 mt-1">Not linked to a client — never appears on an invoice or export.</p>
        </div>

        <div className="flex justify-between pt-2">
          {isEdit ? <Button variant="ghost" onClick={remove} disabled={saving} className="text-red-500">Remove</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
