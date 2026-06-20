import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, MapPin } from 'lucide-react';
import api from '../lib/api';
import AddressAutocomplete from '../components/AddressAutocomplete';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';

const EMPTY = { name: '', address: '' };

function LocationModal({ location, onClose, onSaved }) {
  const [form, setForm] = useState(location || EMPTY);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      if (location) await api.patch(`/locations/${location.id}`, form);
      else          await api.post('/locations', form);
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <Modal title={location ? 'Edit Location' : 'Add Location'} onClose={onClose}>
      <div className="space-y-3">
        <Input label="Clinic name" value={form.name} onChange={e => set('name', e.target.value)} />
        <AddressAutocomplete label="Address" value={form.address} onChange={v => set('address', v)} />
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving || !form.name || !form.address}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Modal>
  );
}

export default function Locations() {
  const [locations, setLocations] = useState([]);
  const [modal, setModal] = useState(null);

  const load = () => api.get('/locations').then(r => setLocations(r.data));
  useEffect(() => { load(); }, []);

  const remove = async id => {
    if (!confirm('Remove this location?')) return;
    await api.delete(`/locations/${id}`);
    load();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Clinic Locations</h1>
        <Button onClick={() => setModal({})}><Plus className="h-4 w-4" /> Add location</Button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>
              {['Name', 'Address', ''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {locations.length === 0 && (
              <tr><td colSpan={3} className="py-12 text-center text-gray-400">No locations added yet</td></tr>
            )}
            {locations.map(loc => (
              <tr key={loc.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-indigo-400 shrink-0" />
                    {loc.name}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{loc.address}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex gap-1 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => setModal(loc)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => remove(loc.id)}><Trash2 className="h-3.5 w-3.5 text-red-400" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal !== null && (
        <LocationModal
          location={modal.id ? modal : null}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}
