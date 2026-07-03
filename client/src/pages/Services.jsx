import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import api from '../lib/api';
import Button from '../components/ui/Button';

export default function Services() {
  const [services, setServices] = useState([]);
  const [disciplines, setDisciplines] = useState([]);
  const navigate = useNavigate();

  const load = () => api.get('/services').then(r => setServices(r.data));
  useEffect(() => { load(); api.get('/disciplines').then(r => setDisciplines(r.data)); }, []);

  const discName = id => disciplines.find(d => d.id === id)?.name || '—';

  const remove = async (id, e) => {
    e.stopPropagation();
    if (!confirm('Remove this service?')) return;
    await api.delete(`/services/${id}`);
    load();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Services & Rates</h1>
        <Button onClick={() => navigate('/services/new')}><Plus className="h-4 w-4" /> Add service</Button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>
              {['Service','Discipline','Funding types','Unit','Duration',''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {services.map(s => (
              <tr key={s.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/services/${s.id}`)}>
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{s.name}</div>
                  {s.description && <div className="text-xs text-gray-400">{s.description}</div>}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{s.discipline_id ? discName(s.discipline_id) : <span className="text-gray-300">All</span>}</td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {s.funding_type_names
                    ? s.funding_type_names.split(',').map(name => (
                        <span key={name} className="inline-block mr-1 mb-1 px-2 py-0.5 rounded-full text-xs bg-indigo-50 text-indigo-700">{name}</span>
                      ))
                    : <span className="text-gray-300">Not priced yet</span>}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{s.unit}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{s.default_duration} min</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex gap-1 justify-end">
                    <Button variant="ghost" size="sm" onClick={e => remove(s.id, e)}><Trash2 className="h-3.5 w-3.5 text-red-400" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
