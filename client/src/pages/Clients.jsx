import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, ChevronRight, Bell } from 'lucide-react';
import api from '../lib/api';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';

const FUNDING_COLOR = { NDIS: 'blue', Medicare: 'green', Private: 'purple', 'Aged Care': 'orange', Other: 'gray' };

// ─── Clients list ─────────────────────────────────────────────────────────────

export default function Clients() {
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('1');

  const load = (q = '', af = activeFilter) => {
    const params = new URLSearchParams();
    if (q) params.set('search', q);
    params.set('active', af);
    api.get(`/clients?${params}`).then(r => setClients(r.data));
  };
  useEffect(() => { load(search, activeFilter); }, [activeFilter]);
  useEffect(() => {
    const t = setTimeout(() => load(search, activeFilter), 300);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Clients</h1>
        <Button onClick={() => navigate('/clients/new')}><Plus className="h-4 w-4" /> Add client</Button>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input className="w-64 rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="Search name, email…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select value={activeFilter} onChange={e => setActiveFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700">
          <option value="1">Active</option>
          <option value="0">Inactive</option>
          <option value="all">All</option>
        </select>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>
              {['Name', 'Contact', 'Active Funding', 'Funder', ''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {clients.length === 0 && (
              <tr><td colSpan={5} className="py-12 text-center text-gray-400">No clients found</td></tr>
            )}
            {clients.map(c => {
              const fundingType = c.active_funding_type || c.funding_type;
              const fundsManager = c.active_funds_manager_name || c.funds_manager_name;
              return (
                <tr key={c.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/clients/${c.id}`)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`font-medium ${c.active ? 'text-gray-900' : 'text-gray-400'}`}><span className="font-mono text-xs text-indigo-400 mr-1.5">C{String(c.id).padStart(4,'0')}</span>{c.first_name} {c.last_name}</span>
                      {!c.active && <span className="text-xs text-gray-400 font-medium">(inactive)</span>}
                      {c.alert && <Bell className="h-3.5 w-3.5 text-amber-500 shrink-0" title={c.alert} />}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    <div>{c.email}</div>
                    <div className="text-gray-400">{c.phone}</div>
                  </td>
                  <td className="px-4 py-3">
                    {fundingType
                      ? <Badge color={FUNDING_COLOR[fundingType] || 'gray'}>{fundingType}</Badge>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {fundsManager || <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-indigo-500"><ChevronRight className="h-4 w-4" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

    </div>
  );
}
