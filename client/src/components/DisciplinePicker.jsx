import { useState, useEffect } from 'react';
import { PlusCircle, X, Settings2 } from 'lucide-react';
import api from '../lib/api';
import Modal from './ui/Modal';
import Button from './ui/Button';

export default function DisciplinePicker({ value, onChange, label = 'Discipline', noneLabel = '— None —' }) {
  const [disciplines, setDisciplines] = useState([]);
  const [newDiscipline, setNewDiscipline] = useState('');
  const [managing, setManaging] = useState(false);
  const [blocked, setBlocked] = useState(null); // { name, usage }
  const [deletingId, setDeletingId] = useState(null);

  const load = () => api.get('/disciplines').then(r => setDisciplines(r.data));
  useEffect(() => { load(); }, []);

  const addDiscipline = async () => {
    if (!newDiscipline.trim()) return;
    const res = await api.post('/disciplines', { name: newDiscipline.trim() });
    setDisciplines(d => [...d, res.data]);
    onChange(res.data.id);
    setNewDiscipline('');
  };

  const removeDiscipline = async d => {
    if (!confirm(`Remove discipline "${d.name}"?`)) return;
    setDeletingId(d.id);
    try {
      await api.delete(`/disciplines/${d.id}`);
      setDisciplines(ds => ds.filter(x => x.id !== d.id));
      if (String(value) === String(d.id)) onChange('');
    } catch (e) {
      if (e.response?.status === 409) {
        setBlocked({ name: d.name, usage: e.response.data.usage });
      }
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-700">{label}</label>
        <button type="button" onClick={() => setManaging(m => !m)}
          className="text-gray-400 hover:text-indigo-600" title="Manage disciplines">
          <Settings2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        value={value} onChange={e => onChange(e.target.value)}>
        <option value="">{noneLabel}</option>
        {disciplines.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>

      {!managing && (
        <div className="flex gap-1 mt-1">
          <input className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs" placeholder="Add new…"
            value={newDiscipline} onChange={e => setNewDiscipline(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addDiscipline()} />
          <button type="button" onClick={addDiscipline} className="text-indigo-500 hover:text-indigo-700"><PlusCircle className="h-4 w-4" /></button>
        </div>
      )}

      {managing && (
        <div className="mt-2 rounded-lg border border-gray-200 divide-y divide-gray-100 max-h-40 overflow-y-auto">
          {disciplines.length === 0 && (
            <p className="text-xs text-gray-400 px-2 py-2">No disciplines yet.</p>
          )}
          {disciplines.map(d => (
            <div key={d.id} className="flex items-center justify-between px-2 py-1.5 text-xs">
              <span className="text-gray-700">{d.name}</span>
              <button type="button" onClick={() => removeDiscipline(d)} disabled={deletingId === d.id}
                className="text-gray-400 hover:text-red-500 disabled:opacity-40">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {blocked && (
        <Modal title="Discipline in use" onClose={() => setBlocked(null)}>
          <p className="text-sm text-gray-700">
            <span className="font-medium">{blocked.name}</span> can't be removed because it's still used by:
          </p>
          <div className="mt-3 space-y-3">
            {blocked.usage.practitioners?.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Users</p>
                <ul className="mt-1 text-sm text-gray-700 list-disc list-inside">
                  {blocked.usage.practitioners.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            )}
            {blocked.usage.services?.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Services</p>
                <ul className="mt-1 text-sm text-gray-700 list-disc list-inside">
                  {blocked.usage.services.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-3">Reassign or remove those first, then try again.</p>
          <div className="flex justify-end mt-5">
            <Button onClick={() => setBlocked(null)}>Got it</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
