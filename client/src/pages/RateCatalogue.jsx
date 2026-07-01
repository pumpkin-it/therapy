import { useState, useEffect, useRef } from 'react';
import { Plus, Pencil, Trash2, Upload, Download } from 'lucide-react';
import api from '../lib/api';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import { currency } from '../lib/utils';

const CATEGORIES = ['session', 'travel', 'km', 'notes', 'cancellation', 'report', 'telehealth'];
const EMPTY = { funding_type_id: '', discipline_id: '', category: 'cancellation', code: '', name: '', unit: 'hour', rate: '' };

const TEMPLATE_HEADERS = ['funding_type_name', 'discipline_name', 'category', 'code', 'name', 'unit', 'rate'];
const TEMPLATE_EXAMPLE_ROWS = [
  ['NDIS', 'Occupational Therapy', 'session', '15_617_0128_1_3', 'Occupational Therapy - over 9 years and adult', 'hour', '193.99'],
  ['NDIS', 'Occupational Therapy', 'cancellation', '15_617_0128_1_9', 'Occupational Therapy Cancellation', 'item', '193.99'],
  ['NDIS', 'Speech Pathology', 'session', '15_622_0128_1_3', 'Speech Pathology - over 9 years and adult', 'hour', '193.99'],
  ['NDIS', '', 'travel', '04_799', 'Provider Travel', 'hour', '193.99'],
];

function downloadCsvTemplate() {
  const rows = [TEMPLATE_HEADERS, ...TEMPLATE_EXAMPLE_ROWS];
  const csv = rows.map(r => r.join(',')).join('\r\n') + '\r\n';
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'rate_catalogue_template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function RateItemModal({ item, fundingTypes, disciplines, onClose, onSaved }) {
  const [form, setForm] = useState(item || EMPTY);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      if (item) await api.patch(`/rate-items/${item.id}`, form);
      else       await api.post('/rate-items', form);
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <Modal title={item ? 'Edit Rate Item' : 'Add Rate Item'} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Funding scheme</label>
            <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              value={form.funding_type_id} onChange={e => set('funding_type_id', e.target.value)}>
              <option value="">— Any —</option>
              {fundingTypes.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Discipline</label>
            <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              value={form.discipline_id} onChange={e => set('discipline_id', e.target.value)}>
              <option value="">— All disciplines —</option>
              {disciplines.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Category</label>
            <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              value={form.category} onChange={e => set('category', e.target.value)}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <Input label="Code" value={form.code} onChange={e => set('code', e.target.value)} placeholder="e.g. 15_617_0128_1_3" />
        </div>
        <Input label="Name" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Cancellation Fee" />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Unit</label>
            <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={form.unit} onChange={e => set('unit', e.target.value)}>
              <option value="hour">Per hour</option>
              <option value="session">Per session</option>
              <option value="km">Per km</option>
              <option value="item">Per item</option>
            </select>
          </div>
          <Input label="Reference rate ($)" type="number" step="0.01" value={form.rate}
            onChange={e => set('rate', e.target.value)} placeholder="Price guide cap" />
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving || !form.code || !form.name}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </Modal>
  );
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  return lines.slice(1).map(line => {
    const cells = line.split(',').map(c => c.trim());
    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    return row;
  });
}

export default function RateCatalogue() {
  const [items, setItems] = useState([]);
  const [fundingTypes, setFundingTypes] = useState([]);
  const [disciplines, setDisciplines] = useState([]);
  const [modal, setModal] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const fileRef = useRef();

  const load = () => api.get('/rate-items').then(r => setItems(r.data));
  useEffect(() => {
    load();
    api.get('/funding-types').then(r => setFundingTypes(r.data));
    api.get('/disciplines').then(r => setDisciplines(r.data));
  }, []);

  const remove = async id => {
    if (!confirm('Remove this rate item?')) return;
    await api.delete(`/rate-items/${id}`);
    load();
  };

  const onImportFile = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      const { data } = await api.post('/rate-items/import', { rows });
      setImportResult(data);
      load();
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Rate Catalogue</h1>
          <p className="text-sm text-gray-500 mt-0.5">Reference codes and rates by funding scheme (NDIS, Medicare, etc.) — used by Services to link cancellation fees and other codes.</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={onImportFile} />
          <Button variant="secondary" onClick={downloadCsvTemplate}>
            <Download className="h-4 w-4" /> Download template
          </Button>
          <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={importing}>
            <Upload className="h-4 w-4" /> {importing ? 'Importing…' : 'Import CSV'}
          </Button>
          <Button onClick={() => setModal({})}><Plus className="h-4 w-4" /> Add rate item</Button>
        </div>
      </div>

      {importResult && (
        <div className={`rounded-lg border p-3 text-sm ${importResult.errors?.length ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-green-200 bg-green-50 text-green-800'}`}>
          <p>Imported {importResult.imported} row{importResult.imported === 1 ? '' : 's'}.</p>
          {importResult.errors?.length > 0 && (
            <ul className="mt-1 list-disc list-inside">
              {importResult.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}

      <p className="text-xs text-gray-400">
        CSV columns: <code className="bg-gray-100 px-1 rounded">funding_type_name, discipline_name, category, code, name, unit, rate</code> — funding scheme must already exist; disciplines are auto-created if missing.
      </p>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>
              {['Funding scheme','Discipline','Category','Code','Name','Rate','Unit',''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map(r => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm text-gray-700">{r.funding_type_name || <span className="text-gray-300">Any</span>}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{r.discipline_name || <span className="text-gray-300">All</span>}</td>
                <td className="px-4 py-3 text-sm text-gray-600 capitalize">{r.category}</td>
                <td className="px-4 py-3 text-sm font-mono text-gray-700">{r.code}</td>
                <td className="px-4 py-3 text-sm text-gray-900">{r.name}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{r.rate != null ? currency(r.rate) : '—'}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{r.unit}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex gap-1 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => setModal(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => remove(r.id)}><Trash2 className="h-3.5 w-3.5 text-red-400" /></Button>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No rate items yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modal !== null && (
        <RateItemModal
          item={modal.id ? modal : null}
          fundingTypes={fundingTypes}
          disciplines={disciplines}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}
