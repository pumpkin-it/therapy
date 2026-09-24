import { useState, useEffect, useRef } from 'react';
import api from '../lib/api';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { Plus, Trash2 } from 'lucide-react';
import { roundQty, currency, localToday } from '../lib/utils';

// Mirrors AppointmentModal's own date-input pattern — a plain controlled <input type="date">
// breaks typing a year digit-by-digit in React, so the value is pushed in via a ref instead.
function DateField({ label, value, onChange, optional }) {
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
      <label className="block text-sm font-medium text-gray-700">{label} {optional && <span className="text-gray-400">(optional)</span>}</label>
      <input ref={ref} type="date" defaultValue={value || ''}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        onChange={e => { externalVal.current = e.target.value; onChange(e.target.value); }} />
    </div>
  );
}

const EMPTY_ITEM = { service_id: '', description: '', sessions: 1, unit_rate: 0, session_duration_min: 60, travel_time_to: '', travel_time_from: '', travel_km: '', notes_min: '' };

// Same session+travel+km+notes math as the server's computeBudgetItemLineTotal, kept in sync
// by hand (no shared module between client/server in this codebase) so the live total shown
// while editing matches exactly what gets saved. Split into two steps — perSessionCost (the
// whole cost of one occurrence: session + travel + km + notes combined) and itemLineTotal
// (that whole figure × sessions) — so the UI can show the calculation in the same order it
// actually happens, instead of a single opaque total.
function perSessionCost(item, scopedServices) {
  const svc = item.service_id ? scopedServices.find(s => s.service_id === Number(item.service_id)) : null;
  const travelRate = svc?.travel_rate_per_hour || item.unit_rate || 0;
  const kmRate = svc?.km_rate || 0;
  const notesRate = svc?.notes_rate || item.unit_rate || 0;
  const travelMin = (Number(item.travel_time_to) || 0) + (Number(item.travel_time_from) || 0);
  const durationHours = (Number(item.session_duration_min) || 60) / 60;
  return roundQty(durationHours) * Number(item.unit_rate || 0)
    + (travelMin ? roundQty(travelMin / 60) * travelRate : 0)
    + (item.travel_km && kmRate ? roundQty(item.travel_km) * kmRate : 0)
    + (item.notes_min ? roundQty(item.notes_min / 60) * notesRate : 0);
}
function itemLineTotal(item, scopedServices) {
  return perSessionCost(item, scopedServices) * (Number(item.sessions) || 1);
}

// `revising` is null for a fresh budget, or a full GET /budgets/:id payload (with items) when
// revising an existing one — items/dates are pre-filled as an editable starting point, and
// discipline is locked (a revision can't jump discipline; that's just a separate new budget).
export default function BudgetModal({ clientId, revising, onClose, onSaved }) {
  const isRevise = !!revising;
  const [disciplines, setDisciplines] = useState([]);
  const [disciplineId, setDisciplineId] = useState(revising?.discipline_id || '');
  const [startDate, setStartDate] = useState(revising?.start_date || localToday());
  const [endDate, setEndDate] = useState(revising?.end_date || '');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState(
    revising?.items?.length
      ? revising.items.map(it => ({
          service_id: it.service_id || '', description: it.description, sessions: it.sessions, unit_rate: it.unit_rate,
          session_duration_min: it.session_duration_min || 60,
          travel_time_to: it.travel_time_to || '', travel_time_from: it.travel_time_from || '', travel_km: it.travel_km || '', notes_min: it.notes_min || '',
        }))
      : [{ ...EMPTY_ITEM }]
  );
  const [scopedServices, setScopedServices] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/disciplines').then(r => setDisciplines(r.data));
  }, []);

  // No funder/funding-period involved at all — the service catalog is already funder-specific
  // by name (e.g. "NDIS - OT Session"), so every currently-priced service across every funding
  // type is shown together and the item's own selection is what carries which funder it's
  // under. This also means a budget can freely span a real funding change mid-period (NDIS
  // funding runs out, the client starts privately paying for the rest) without needing separate
  // handling — just add a line item using the other funder's service.
  const startD = startDate || localToday();
  useEffect(() => {
    api.get('/funding-types/service-rates', { params: { date: startD } })
      .then(r => {
        // A service priced under more than one funding type (rare — one exists in this
        // catalog) would otherwise produce two <option>s with the identical value and no way
        // to tell them apart; keep only the first (stable) row per service.
        const seen = new Set();
        setScopedServices(r.data.filter(row => (seen.has(row.service_id) ? false : (seen.add(row.service_id), true))));
      })
      .catch(() => setScopedServices([]));
  }, [startD]);

  const filteredServices = disciplineId
    ? scopedServices.filter(s => !s.discipline_id || s.discipline_id === Number(disciplineId))
    : scopedServices;

  const setItem = (idx, k, v) => setItems(arr => arr.map((it, i) => {
    if (i !== idx) return it;
    const next = { ...it, [k]: v };
    if (k === 'service_id' && v) {
      const svc = scopedServices.find(s => s.service_id === Number(v));
      if (svc) { next.description = svc.service_name; next.unit_rate = svc.rate; next.session_duration_min = svc.default_duration || 60; }
    }
    return next;
  }));
  const addItem = () => setItems(arr => [...arr, { ...EMPTY_ITEM }]);
  const removeItem = idx => setItems(arr => arr.filter((_, i) => i !== idx));

  const grandTotal = items.reduce((sum, it) => sum + itemLineTotal(it, scopedServices), 0);

  const save = async () => {
    setError('');
    if (!isRevise && !disciplineId) return setError('Discipline is required.');
    if (!startDate) return setError('Start date is required.');
    const realItems = items.filter(it => it.description);
    if (realItems.length === 0) return setError('Add at least one item.');

    setSaving(true);
    try {
      const payload = {
        client_id: clientId,
        discipline_id: disciplineId ? Number(disciplineId) : undefined,
        start_date: startDate,
        end_date: endDate || null,
        notes: notes || null,
        items: realItems.map(it => {
          const svc = it.service_id ? scopedServices.find(s => s.service_id === Number(it.service_id)) : null;
          return {
            service_id: it.service_id ? Number(it.service_id) : null,
            description: it.description,
            sessions: Number(it.sessions) || 1,
            unit_rate: Number(it.unit_rate) || 0,
            session_duration_min: Number(it.session_duration_min) || 60,
            travel_time_to: it.travel_time_to ? Number(it.travel_time_to) : null,
            travel_time_from: it.travel_time_from ? Number(it.travel_time_from) : null,
            travel_rate_per_hour: svc?.travel_rate_per_hour || null,
            travel_km: it.travel_km ? Number(it.travel_km) : null,
            km_rate: svc?.km_rate || null,
            notes_min: it.notes_min ? Number(it.notes_min) : null,
            notes_rate: svc?.notes_rate || null,
          };
        }),
      };
      const { data } = isRevise
        ? await api.post(`/budgets/${revising.id}/revise`, payload)
        : await api.post('/budgets', payload);
      onSaved(data);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to save budget.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={isRevise ? `Revise Budget — ${revising.discipline_name || 'Unassigned discipline'}` : 'New Budget'} onClose={onClose} size="xl">
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Discipline</label>
            <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400"
              value={disciplineId} onChange={e => setDisciplineId(e.target.value)} disabled={isRevise}>
              <option value="">Select…</option>
              {disciplines.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <DateField label="Start date" value={startDate} onChange={setStartDate} />
        </div>

        <DateField label="End date" value={endDate} onChange={setEndDate} optional />

        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700">Notes</label>
          <textarea className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" rows={2}
            value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. reason for this revision" />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Services / Items (per session)</span>
            <Button variant="ghost" size="sm" onClick={addItem}><Plus className="h-3.5 w-3.5" /> Add item</Button>
          </div>
          <div className="space-y-3">
            {items.map((item, idx) => {
              const perSession = perSessionCost(item, scopedServices);
              return (
              <div key={idx} className="rounded-lg border border-gray-200 p-3 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs text-gray-500">Service</label>
                    <select className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                      value={item.service_id} onChange={e => setItem(idx, 'service_id', e.target.value)}>
                      <option value="">Manual…</option>
                      {filteredServices.map(s => <option key={s.service_id} value={s.service_id}>{s.service_name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-500">Description</label>
                    <input className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                      value={item.description} onChange={e => setItem(idx, 'description', e.target.value)} />
                  </div>
                </div>

                {/* Step 1: the whole cost of ONE session — rate + travel + km + notes combined,
                    computed and shown together before any multiplication happens. */}
                <div className="rounded border border-gray-100 bg-gray-50/60 p-2 space-y-2">
                  <p className="text-xs font-medium text-gray-500">Per session</p>
                  <div className="grid grid-cols-6 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs text-gray-500">Rate ($)</label>
                      <input type="number" step="0.01" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                        value={item.unit_rate} onChange={e => setItem(idx, 'unit_rate', e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-gray-500">Duration (min)</label>
                      <input type="number" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                        value={item.session_duration_min} onChange={e => setItem(idx, 'session_duration_min', e.target.value)} />
                    </div>
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
                    <div className="space-y-1">
                      <label className="text-xs text-gray-500">Notes (min)</label>
                      <input type="number" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                        value={item.notes_min} onChange={e => setItem(idx, 'notes_min', e.target.value)} placeholder="—" />
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 text-right">= {currency(perSession)} per session</p>
                </div>

                {/* Step 2: multiply the whole per-session figure by how many sessions this line
                    represents over the budget period — a clearly separate step, not another
                    field mixed in among the per-session ones above. */}
                <div className="flex items-center justify-end gap-2 text-sm text-gray-600">
                  <span>{currency(perSession)}</span>
                  <span className="text-gray-400">×</span>
                  <input type="number" step="1" min="1" className="w-20 rounded border border-gray-300 px-2 py-1 text-sm text-center"
                    value={item.sessions} onChange={e => setItem(idx, 'sessions', e.target.value)} />
                  <span className="text-gray-400">sessions =</span>
                  <span className="font-medium text-gray-900">{currency(itemLineTotal(item, scopedServices))}</span>
                </div>

                <button type="button" onClick={() => removeItem(idx)} className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1">
                  <Trash2 className="h-3 w-3" /> Remove
                </button>
              </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-indigo-100 bg-indigo-50/40 px-3 py-2">
          <span className="text-sm font-medium text-indigo-900">Grand Total</span>
          <span className="text-sm font-semibold text-indigo-900">{currency(grandTotal)}</span>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4 mt-2 border-t border-gray-100">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : isRevise ? 'Save revision' : 'Create budget'}</Button>
      </div>
    </Modal>
  );
}
