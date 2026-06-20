import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Pause, Play, RefreshCw } from 'lucide-react';
import api from '../lib/api';
import Button from '../components/ui/Button';

const FREQ_LABEL = { weekly: 'Weekly', fortnightly: 'Fortnightly', every3weeks: 'Every 3 weeks', monthly: 'Monthly' };
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

export default function RecurringSeries() {
  const navigate = useNavigate();
  const [series, setSeries] = useState([]);
  const [filter, setFilter] = useState('1');
  const [generating, setGenerating] = useState(false);

  const load = () => api.get(`/recurring-series?active=${filter}`).then(r => setSeries(r.data));
  useEffect(() => { load(); }, [filter]);

  const generate = async () => {
    setGenerating(true);
    try { await api.post('/recurring-series/generate'); load(); }
    finally { setGenerating(false); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Recurring Series</h1>
        <div className="flex items-center gap-2">
          <select value={filter} onChange={e => setFilter(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700">
            <option value="1">Active</option>
            <option value="0">Inactive</option>
            <option value="all">All</option>
          </select>
          <Button variant="secondary" size="sm" onClick={generate} disabled={generating}>
            <RefreshCw className={`h-3.5 w-3.5 ${generating ? 'animate-spin' : ''}`} />
            {generating ? 'Generating…' : 'Generate now'}
          </Button>
        </div>
      </div>

      {series.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center text-gray-400">
          No recurring series. Create one by toggling "Repeat" when booking an appointment.
        </div>
      ) : (
        <div className="space-y-3">
          {series.map(s => (
            <div key={s.id}
              onClick={() => navigate(`/recurring-series/${s.id}`)}
              className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-indigo-200 cursor-pointer transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="h-3 w-3 rounded-full shrink-0" style={{ background: s.practitioner_color }} />
                  <div>
                    <p className="font-medium text-gray-900"><span className="font-mono text-xs text-indigo-500 mr-1.5">SER-{String(s.id).padStart(5,'0')}</span>{s.client_name}</p>
                    <p className="text-sm text-gray-500">{s.practitioner_name} · {FREQ_LABEL[s.freq] || s.freq} on {DAY_NAMES[s.day_of_week]}s starting {s.start_time?.slice(0,10)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-sm text-gray-600">{s.start_time?.slice(11,16)} – {s.end_time?.slice(11,16)}</p>
                    <p className="text-xs text-gray-400">{s.appointment_count} appointments · {s.end_type === 'never' ? 'Never ends' : s.end_type === 'date' ? `Until ${s.end_date}` : `${s.end_occurrences} occurrences`}</p>
                  </div>
                  {!s.active && <span className="text-xs bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">Paused</span>}
                  <ChevronRight className="h-4 w-4 text-gray-400" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
