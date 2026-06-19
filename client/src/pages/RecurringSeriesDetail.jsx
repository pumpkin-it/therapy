import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Pause, Play, Clock, User, Calendar } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import api from '../lib/api';
import Button from '../components/ui/Button';

const FREQ_LABEL = { weekly: 'Weekly', fortnightly: 'Fortnightly', every3weeks: 'Every 3 weeks', monthly: 'Monthly' };
const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const STATUS_STYLE = {
  scheduled: 'bg-blue-50 text-blue-700',
  confirmed: 'bg-green-50 text-green-700',
  completed: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-50 text-red-500',
  no_show:   'bg-amber-50 text-amber-600',
};

export default function RecurringSeriesDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [series, setSeries] = useState(null);

  const load = () => api.get(`/recurring-series/${id}`).then(r => setSeries(r.data));
  useEffect(() => { load(); }, [id]);

  if (!series) return <div className="p-6 text-gray-400">Loading…</div>;

  const toggleActive = async () => {
    await api.patch(`/recurring-series/${id}/active`, { active: !series.active });
    load();
  };

  const past = series.appointments.filter(a => new Date(a.start_time) < new Date());
  const upcoming = series.appointments.filter(a => new Date(a.start_time) >= new Date());

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/recurring-series')} className="text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">{series.client_name}</h1>
          <p className="text-sm text-gray-500">{series.practitioner_name} · {FREQ_LABEL[series.freq]} on {DAY_NAMES[series.day_of_week]}s</p>
        </div>
        <Button variant={series.active ? 'secondary' : 'primary'} size="sm" onClick={toggleActive}>
          {series.active ? <><Pause className="h-3.5 w-3.5" /> Pause series</> : <><Play className="h-3.5 w-3.5" /> Resume series</>}
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1"><Clock className="h-4 w-4" /> Schedule</div>
          <p className="font-medium text-gray-900">{series.start_time?.slice(11,16)} – {series.end_time?.slice(11,16)}</p>
          <p className="text-xs text-gray-400 mt-1">{series.end_type === 'never' ? 'No end date' : series.end_type === 'date' ? `Until ${series.end_date}` : `${series.end_occurrences} occurrences`}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1"><Calendar className="h-4 w-4" /> Appointments</div>
          <p className="font-medium text-gray-900">{series.appointments.length} total</p>
          <p className="text-xs text-gray-400 mt-1">{upcoming.length} upcoming · {past.length} past</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1"><User className="h-4 w-4" /> Status</div>
          <p className="font-medium text-gray-900">{series.active ? 'Active' : 'Paused'}</p>
          <p className="text-xs text-gray-400 mt-1">Generated until {series.generated_until || '—'}</p>
        </div>
      </div>

      {/* Change log */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 text-sm">Change Log</h2>
        </div>
        <div className="divide-y divide-gray-50">
          {series.logs.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-400 text-center">No changes recorded</p>
          ) : series.logs.map(log => (
            <div key={log.id} className="px-4 py-3 flex items-start gap-3">
              <span className={`mt-0.5 shrink-0 text-xs font-medium rounded-full px-2 py-0.5 ${
                log.action === 'created' ? 'bg-green-50 text-green-700' :
                log.action === 'updated' ? 'bg-blue-50 text-blue-700' :
                log.action === 'deactivated' ? 'bg-red-50 text-red-600' :
                'bg-gray-50 text-gray-600'
              }`}>{log.action}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-700">{log.details}</p>
                <p className="text-xs text-gray-400 mt-0.5">{format(parseISO(log.created_at), 'd MMM yyyy h:mm a')}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Appointments timeline */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 text-sm">Appointments</h2>
        </div>
        <div className="divide-y divide-gray-50 max-h-[500px] overflow-y-auto">
          {series.appointments.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-400 text-center">No appointments generated yet</p>
          ) : series.appointments.map(a => {
            const isPast = new Date(a.start_time) < new Date();
            return (
              <div key={a.id} className={`px-4 py-2.5 flex items-center gap-3 ${isPast ? 'opacity-50' : ''}`}>
                <span className="h-2 w-2 rounded-full shrink-0" style={{ background: a.practitioner_color }} />
                <span className="text-sm text-gray-700 w-36 shrink-0">
                  {format(parseISO(a.start_time), 'EEE d MMM yyyy')}
                </span>
                <span className="text-sm text-gray-500 w-28 shrink-0">
                  {a.start_time.slice(11,16)} – {a.end_time.slice(11,16)}
                </span>
                <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${STATUS_STYLE[a.status] || 'bg-gray-100 text-gray-500'}`}>
                  {a.status}
                </span>
                <span className="text-xs text-gray-400 ml-auto">{a.practitioner_name}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
