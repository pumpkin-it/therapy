import { useState, useEffect } from 'react';
import {
  format, addDays, startOfDay, startOfWeek, endOfWeek,
  addWeeks, subWeeks, addMonths, subMonths, startOfMonth, endOfMonth,
} from 'date-fns';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import api from '../lib/api';
import { cn } from '../lib/utils';
import Button from '../components/ui/Button';
import AppointmentModal from '../components/AppointmentModal';
import { DayView, WeekView, MonthView } from '../components/CalendarViews';

export default function Calendar() {
  const [date, setDate] = useState(startOfDay(new Date()));
  const [view, setView] = useState('week');
  const [appointments, setAppointments] = useState([]);
  const [practitioners, setPractitioners] = useState([]);
  const [practitionerFilter, setPractitionerFilter] = useState('');
  const [showCancelled, setShowCancelled] = useState(false);
  const [modal, setModal] = useState(null);

  const dateStr = format(date, 'yyyy-MM-dd');

  const load = () => {
    let params;
    if (view === 'day') {
      params = `date=${dateStr}`;
    } else if (view === 'week') {
      const ws = format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd');
      const we = format(endOfWeek(date,   { weekStartsOn: 1 }), 'yyyy-MM-dd');
      params = `from=${ws}T00:00&to=${we}T23:59`;
    } else {
      const ms = format(startOfMonth(date), 'yyyy-MM-dd');
      const me = format(endOfMonth(date),   'yyyy-MM-dd');
      params = `from=${ms}T00:00&to=${me}T23:59`;
    }
    api.get(`/appointments?${params}`).then(r => setAppointments(r.data));
  };

  useEffect(() => { api.get('/practitioners?role=practitioner').then(r => setPractitioners(r.data)); }, []);
  useEffect(() => { load(); }, [dateStr, view]);

  const nav = delta => {
    if (view === 'day')   setDate(d => addDays(d, delta));
    if (view === 'week')  setDate(d => delta > 0 ? addWeeks(d, 1) : subWeeks(d, 1));
    if (view === 'month') setDate(d => delta > 0 ? addMonths(d, 1) : subMonths(d, 1));
  };

  const navLabel = () => {
    if (view === 'day')   return format(date, 'EEEE d MMMM yyyy');
    if (view === 'week') {
      const ws = startOfWeek(date, { weekStartsOn: 1 });
      const we = endOfWeek(date, { weekStartsOn: 1 });
      return `${format(ws, 'd MMM')} – ${format(we, 'd MMM yyyy')}`;
    }
    return format(date, 'MMMM yyyy');
  };

  const goToDay = day => { setDate(startOfDay(day)); setView('day'); };

  const visibleAppointments = showCancelled
    ? appointments
    : appointments.filter(a => a.status !== 'cancelled');

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="secondary" size="sm" onClick={() => nav(-1)}><ChevronLeft className="h-4 w-4" /></Button>
        <h1 className="text-base font-semibold w-56 text-center">{navLabel()}</h1>
        <Button variant="secondary" size="sm" onClick={() => nav(1)}><ChevronRight className="h-4 w-4" /></Button>
        <Button variant="ghost" size="sm" onClick={() => setDate(startOfDay(new Date()))}>Today</Button>

        <div className="flex rounded-lg border border-gray-200 overflow-hidden ml-2">
          {['day','week','month'].map(v => (
            <button key={v} onClick={() => setView(v)}
              className={cn('px-3 py-1.5 text-sm capitalize', view === v ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50')}>
              {v}
            </button>
          ))}
        </div>

        <select className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-700 ml-1"
          value={practitionerFilter} onChange={e => setPractitionerFilter(e.target.value)}>
          <option value="">All practitioners</option>
          {practitioners.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
        </select>

        <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
          <input type="checkbox" className="accent-indigo-600"
            checked={showCancelled} onChange={e => setShowCancelled(e.target.checked)} />
          Show cancelled
        </label>

        <div className="ml-auto">
          <Button onClick={() => setModal({ _new: true, date: dateStr })}><Plus className="h-4 w-4" /> New appointment</Button>
        </div>
      </div>

      {view === 'day' && (
        <DayView date={date} appointments={visibleAppointments} practitioners={practitioners}
          filteredPractitionerId={practitionerFilter} onClickAppt={setModal} dateStr={dateStr}
          onClickSlot={slot => setModal({ _new: true, ...slot })} />
      )}
      {view === 'week' && (
        <WeekView date={date} appointments={visibleAppointments} practitioners={practitioners}
          filteredPractitionerId={practitionerFilter} onClickAppt={setModal} onClickDay={goToDay}
          onClickSlot={slot => setModal({ _new: true, ...slot })} />
      )}
      {view === 'month' && (
        <MonthView date={date} appointments={visibleAppointments} practitioners={practitioners}
          filteredPractitionerId={practitionerFilter} onClickAppt={setModal} onClickDay={goToDay} />
      )}

      {modal !== null && (
        <AppointmentModal
          appointment={modal === 'new' || modal?._new ? null : modal}
          defaultDate={modal?._new ? modal.date : dateStr}
          defaultTime={modal?._new ? modal.time : null}
          defaultPractitioner={modal?._new ? modal.practitionerId : null}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
          onRefresh={() => load()}
        />
      )}
    </div>
  );
}
