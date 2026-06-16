import { useState, useEffect } from 'react';
import { format, addDays, subDays, startOfDay } from 'date-fns';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import api from '../lib/api';
import { fmtTime, cn } from '../lib/utils';
import Button from '../components/ui/Button';
import AppointmentModal from '../components/AppointmentModal';

const STATUS_CLASS = {
  scheduled:  'bg-blue-50 border-blue-300 text-blue-900',
  confirmed:  'bg-green-50 border-green-300 text-green-900',
  completed:  'bg-gray-100 border-gray-300 text-gray-600',
  cancelled:  'bg-red-50 border-red-200 text-red-700 opacity-60',
  no_show:    'bg-orange-50 border-orange-300 text-orange-900',
};

const HOURS = Array.from({ length: 13 }, (_, i) => i + 7); // 7am–7pm

export default function Calendar() {
  const [date, setDate] = useState(startOfDay(new Date()));
  const [appointments, setAppointments] = useState([]);
  const [practitioners, setPractitioners] = useState([]);
  const [modal, setModal] = useState(null); // null | 'new' | appointmentObj

  const dateStr = format(date, 'yyyy-MM-dd');

  const load = () => {
    api.get(`/appointments?date=${dateStr}`).then(r => setAppointments(r.data));
  };

  useEffect(() => {
    api.get('/practitioners').then(r => setPractitioners(r.data));
  }, []);

  useEffect(() => { load(); }, [dateStr]);

  const getStyle = appt => {
    const start = new Date(appt.start_time);
    const end   = new Date(appt.end_time);
    const top    = ((start.getHours() - 7 + start.getMinutes() / 60) / 13) * 100;
    const height = Math.max(((end - start) / 1000 / 3600 / 13) * 100, 1.5);
    return { top: `${top}%`, height: `${height}%` };
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="sm" onClick={() => setDate(d => subDays(d, 1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-lg font-semibold w-64 text-center">
          {format(date, 'EEEE d MMMM yyyy')}
        </h1>
        <Button variant="secondary" size="sm" onClick={() => setDate(d => addDays(d, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setDate(startOfDay(new Date()))}>Today</Button>
        <div className="ml-auto">
          <Button onClick={() => setModal('new')}>
            <Plus className="h-4 w-4" /> New appointment
          </Button>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <div
          className="grid min-w-max"
          style={{ gridTemplateColumns: `56px repeat(${Math.max(practitioners.length, 1)}, minmax(160px, 1fr))` }}
        >
          {/* Header */}
          <div className="sticky top-0 z-10 border-b border-gray-100 bg-gray-50 py-3" />
          {practitioners.map(p => (
            <div key={p.id} className="sticky top-0 z-10 border-b border-l border-gray-100 bg-gray-50 px-3 py-3">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: p.color }} />
                <span className="text-sm font-medium text-gray-700 truncate">
                  {p.first_name} {p.last_name}
                </span>
              </div>
            </div>
          ))}

          {/* Time column */}
          <div className="relative border-r border-gray-100" style={{ height: '780px' }}>
            {HOURS.map(h => (
              <div
                key={h}
                className="absolute right-2 text-xs text-gray-400"
                style={{ top: `${((h - 7) / 13) * 100}%` }}
              >
                {h % 12 || 12}{h < 12 ? 'am' : 'pm'}
              </div>
            ))}
            {HOURS.map(h => (
              <div key={`line-${h}`} className="absolute w-full border-t border-gray-100"
                style={{ top: `${((h - 7) / 13) * 100}%` }} />
            ))}
          </div>

          {/* Practitioner columns */}
          {practitioners.map(p => (
            <div key={p.id} className="relative border-l border-gray-100" style={{ height: '780px' }}>
              {HOURS.map(h => (
                <div key={h} className="absolute w-full border-t border-gray-100"
                  style={{ top: `${((h - 7) / 13) * 100}%` }} />
              ))}
              {appointments
                .filter(a => a.practitioner_id === p.id)
                .map(appt => (
                  <div
                    key={appt.id}
                    onClick={() => setModal(appt)}
                    className={cn(
                      'absolute inset-x-1 rounded border px-1.5 py-1 text-xs cursor-pointer overflow-hidden hover:shadow transition-shadow',
                      STATUS_CLASS[appt.status] || STATUS_CLASS.scheduled
                    )}
                    style={getStyle(appt)}
                  >
                    <div className="font-medium truncate">{appt.client_name}</div>
                    <div className="text-gray-500">{fmtTime(appt.start_time)}–{fmtTime(appt.end_time)}</div>
                    {appt.location && <div className="truncate opacity-70">{appt.location}</div>}
                  </div>
                ))}
            </div>
          ))}
        </div>
      </div>

      {modal && (
        <AppointmentModal
          appointment={modal === 'new' ? null : modal}
          defaultDate={dateStr}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}
