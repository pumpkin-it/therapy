import { useState, useEffect, useRef } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import api from '../lib/api';
import Button from '../components/ui/Button';
import { localToday } from '../lib/utils';

const EMPTY_ITEM = { service_id: '', description: '', code: '', quantity: 1, unit_rate: 0 };

export default function AgreementPricingTable({ agreement, onUpdate }) {
  const isDraft = agreement.status === 'draft';
  const [items, setItems] = useState(agreement.items?.length ? agreement.items.map(i => ({ ...i })) : [{ ...EMPTY_ITEM }]);
  const [scopedServices, setScopedServices] = useState([]);
  const [effectiveDate, setEffectiveDate] = useState(agreement.effective_date || localToday());
  const [saving, setSaving] = useState(false);
  // Item indices whose unit_rate was auto-filled via the service picker this session — only
  // these re-sync when the effective date changes, mirroring AppointmentModal's autoRateIdxRef.
  const autoRateIdxRef = useRef(new Set());

  useEffect(() => {
    if (!agreement.funding_type_id) { setScopedServices([]); return; }
    api.get(`/funding-types/${agreement.funding_type_id}/service-rates`, { params: { date: effectiveDate } })
      .then(r => setScopedServices(r.data)).catch(() => setScopedServices([]));
  }, [agreement.funding_type_id, effectiveDate]);

  // Re-sync auto-filled rates when the scoped rates list refreshes (date change)
  useEffect(() => {
    setItems(rows => rows.map((item, idx) => {
      if (!item.service_id || !autoRateIdxRef.current.has(idx)) return item;
      const svc = scopedServices.find(s => s.service_id === Number(item.service_id));
      if (!svc || svc.rate === item.unit_rate) return item;
      return { ...item, unit_rate: svc.rate };
    }));
  }, [scopedServices]);

  const setItem = (idx, k, v) => {
    if (k === 'unit_rate') autoRateIdxRef.current.delete(idx);
    setItems(rows => {
      const next = [...rows];
      next[idx] = { ...next[idx], [k]: v };
      if (k === 'service_id' && v) {
        const svc = scopedServices.find(s => s.service_id === Number(v));
        if (svc) { next[idx].description = svc.service_name; next[idx].code = svc.code; next[idx].unit_rate = svc.rate; }
        autoRateIdxRef.current.add(idx);
      }
      if (k === 'service_id' && !v) {
        next[idx].unit_rate = 0;
        autoRateIdxRef.current.delete(idx);
      }
      return next;
    });
  };

  const addRow = () => setItems(rows => [...rows, { ...EMPTY_ITEM }]);

  const removeRow = async idx => {
    const row = items[idx];
    if (row.id) await api.delete(`/agreements/${agreement.id}/items/${row.id}`);
    setItems(rows => rows.filter((_, i) => i !== idx));
    autoRateIdxRef.current.delete(idx);
  };

  const changeEffectiveDate = async date => {
    setEffectiveDate(date);
    await api.patch(`/agreements/${agreement.id}`, { effective_date: date });
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.put(`/agreements/${agreement.id}/items`, {
        items: items.map(i => ({ service_id: i.service_id || null, description: i.description, code: i.code, quantity: i.quantity, unit_rate: i.unit_rate })),
      });
      setItems(res.data.items.map(i => ({ ...i })));
      onUpdate?.(res.data);
    } finally { setSaving(false); }
  };

  const grandTotal = items.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unit_rate || 0), 0);

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 space-y-3">
      {isDraft && (
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Effective date</label>
          <input type="date" className="rounded border border-gray-300 px-2 py-1 text-sm"
            value={effectiveDate} onChange={e => changeEffectiveDate(e.target.value)} />
        </div>
      )}
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-xs font-medium text-gray-500 uppercase">
            <th className="py-1 pr-2">Service</th>
            <th className="py-1 pr-2">Code</th>
            <th className="py-1 pr-2 text-right">Qty</th>
            <th className="py-1 pr-2 text-right">Rate ($)</th>
            <th className="py-1 pr-2 text-right">Total</th>
            {isDraft && <th></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((item, idx) => (
            <tr key={item.id || idx}>
              <td className="py-1.5 pr-2">
                {isDraft ? (
                  <select className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    value={item.service_id || ''} onChange={e => setItem(idx, 'service_id', e.target.value)}>
                    <option value="">Select service…</option>
                    {scopedServices.map(s => <option key={s.service_id} value={s.service_id}>{s.service_name}</option>)}
                  </select>
                ) : item.description}
              </td>
              <td className="py-1.5 pr-2 text-gray-600">{item.code}</td>
              <td className="py-1.5 pr-2 text-right">
                {isDraft ? (
                  <input type="number" step="0.25" className="w-20 rounded border border-gray-300 px-2 py-1 text-sm text-right"
                    value={item.quantity} onChange={e => setItem(idx, 'quantity', parseFloat(e.target.value))} />
                ) : Number(item.quantity).toFixed(2)}
              </td>
              <td className="py-1.5 pr-2 text-right text-gray-600">${Number(item.unit_rate || 0).toFixed(2)}</td>
              <td className="py-1.5 pr-2 text-right font-medium text-gray-900">${(Number(item.quantity || 0) * Number(item.unit_rate || 0)).toFixed(2)}</td>
              {isDraft && (
                <td className="py-1.5 text-right">
                  <button onClick={() => removeRow(idx)} className="text-red-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex justify-between items-center pt-2 border-t border-gray-100">
        {isDraft ? (
          <Button variant="secondary" size="sm" onClick={addRow}><Plus className="h-3.5 w-3.5" /> Add service</Button>
        ) : <span />}
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-900">Grand Total: ${grandTotal.toFixed(2)}</span>
          {isDraft && <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Pricing'}</Button>}
        </div>
      </div>
    </div>
  );
}
