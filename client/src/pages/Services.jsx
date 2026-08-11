import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Plus, Trash2, Pencil, DollarSign } from 'lucide-react';
import api from '../lib/api';
import Button from '../components/ui/Button';

const FT_COLOR_CLASSES = {
  blue: 'bg-blue-100 text-blue-700', green: 'bg-green-100 text-green-700', purple: 'bg-purple-100 text-purple-700',
  orange: 'bg-orange-100 text-orange-700', red: 'bg-red-100 text-red-700', amber: 'bg-amber-100 text-amber-700',
  gray: 'bg-gray-100 text-gray-700', indigo: 'bg-indigo-100 text-indigo-700', pink: 'bg-pink-100 text-pink-700',
  teal: 'bg-teal-100 text-teal-700',
};

function ServicesTab() {
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
      <div className="flex items-center justify-end">
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

function FundingTypesTab() {
  const navigate = useNavigate();
  const [fundingTypes, setFundingTypes] = useState([]);
  const [ftEdit, setFtEdit] = useState(null); // null | { id?, name, color, has_ndis_management, identifier_label, show_period_dates }

  const loadFT = () => api.get('/funding-types').then(r => setFundingTypes(r.data));
  useEffect(() => { loadFT(); }, []);

  const saveFT = async () => {
    if (!ftEdit?.name) return;
    if (ftEdit.id) await api.patch(`/funding-types/${ftEdit.id}`, ftEdit);
    else await api.post('/funding-types', ftEdit);
    setFtEdit(null); loadFT();
  };
  const deleteFT = async id => { await api.delete(`/funding-types/${id}`); loadFT(); };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900">Funding Types</h2>
          <p className="text-xs text-gray-400 mt-1">Manage the funding types used for client funding periods and rate setup.</p>
        </div>
        <div className="space-y-2">
          {fundingTypes.map(ft => (
            <div key={ft.id} className="flex items-center gap-3 text-sm">
              <span className="font-mono text-xs text-gray-400 w-16">F{String(ft.id).padStart(4, '0')}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${FT_COLOR_CLASSES[ft.color] || 'bg-gray-100 text-gray-700'}`}>{ft.name}</span>
              {ft.has_ndis_management ? <span className="text-xs text-indigo-500">NDIS management</span> : null}
              <span className="text-xs text-gray-400">"{ft.identifier_label || 'Client ID'}"{ft.show_period_dates ? '' : ' · no dates'}</span>
              <div className="ml-auto flex gap-1">
                <button onClick={() => navigate(`/funding-types/${ft.id}/rates`)} className="text-gray-400 hover:text-gray-600" title="Manage rates"><DollarSign className="h-3.5 w-3.5" /></button>
                <button onClick={() => setFtEdit({ id: ft.id, name: ft.name, color: ft.color, has_ndis_management: ft.has_ndis_management, identifier_label: ft.identifier_label || '', show_period_dates: ft.show_period_dates !== 0 })} className="text-gray-400 hover:text-gray-600"><Pencil className="h-3.5 w-3.5" /></button>
                <button onClick={() => deleteFT(ft.id)} className="text-red-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
        {ftEdit ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <input className="rounded border border-gray-300 px-2 py-1.5 text-sm" placeholder="Name"
                value={ftEdit.name} onChange={e => setFtEdit(f => ({ ...f, name: e.target.value }))} />
              <select className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                value={ftEdit.color} onChange={e => setFtEdit(f => ({ ...f, color: e.target.value }))}>
                {Object.keys(FT_COLOR_CLASSES).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" className="accent-indigo-600" checked={!!ftEdit.has_ndis_management}
                  onChange={e => setFtEdit(f => ({ ...f, has_ndis_management: e.target.checked }))} />
                NDIS management options
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2 items-center">
              <input className="rounded border border-gray-300 px-2 py-1.5 text-sm" placeholder="Client ID label (e.g. Medicare number)"
                value={ftEdit.identifier_label} onChange={e => setFtEdit(f => ({ ...f, identifier_label: e.target.value }))} />
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" className="accent-indigo-600" checked={ftEdit.show_period_dates}
                  onChange={e => setFtEdit(f => ({ ...f, show_period_dates: e.target.checked }))} />
                Show period start/end dates
              </label>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={saveFT}>{ftEdit.id ? 'Save' : 'Add'}</Button>
              <Button size="sm" variant="secondary" onClick={() => setFtEdit(null)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setFtEdit({ name: '', color: 'gray', has_ndis_management: false, identifier_label: '', show_period_dates: true })}>
            <Plus className="h-3.5 w-3.5" /> Add funding type
          </Button>
        )}
      </div>
    </div>
  );
}

export default function Services() {
  const location = useLocation();
  const [tab, setTab] = useState(location.state?.tab || 'services');

  const TABS = [['services', 'Services'], ['funding-types', 'Funding Types']];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Services & Rates</h1>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'services' ? <ServicesTab /> : <FundingTypesTab />}
    </div>
  );
}
