import { useState, useEffect } from 'react';
import {
  format, addDays, subDays, startOfDay, startOfWeek, endOfWeek,
  addWeeks, subWeeks, addMonths, subMonths, startOfMonth, endOfMonth,
  isSameDay, isSameMonth, parseISO, eachDayOfInterval,
} from 'date-fns';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import api from '../lib/api';
import { fmtTime, cn } from '../lib/utils';
import Button from '../components/ui/Button';
import AppointmentModal from '../components/AppointmentModal';

const STATUS_CLASS = {
  scheduled: 'bg-blue-50 border-blue-300 text-blue-900',
  confirmed:  'bg-green-50 border-green-300 text-green-900',
  completed:  'bg-gray-100 border-gray-300 text-gray-600',
  cancelled:  'bg-red-50 border-red-200 text-red-700 opacity-60',
  no_show:    'bg-orange-50 border-orange-300 text-orange-900',
};

const HOURS = Array.from({ length: 13 }, (_, i) => i + 7); // 7am–7pm

// ─── Day View ────────────────────────────────────────────────────────────────

function DayView({ date, appointments, practitioners, filteredPractitionerId, onClickAppt, onClickSlot }) {
  const cols = filteredPractitionerId
    ? practitioners.filter(p => p.id === Number(filteredPractitionerId))
    : practitioners;

  const getStyle = appt => {
    const start = new Date(appt.start_time);
    const end   = new Date(appt.end_time);
    const top    = ((start.getHours() - 7 + start.getMinutes() / 60) / 13) * 100;
    const height = Math.max(((end - start) / 1000 / 3600 / 13) * 100, 1.5);
    return { top: `${top}%`, height: `${height}%` };
  };

  return (
    <div className="flex-1 overflow-auto rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="grid min-w-max" style={{ gridTemplateColumns: `56px repeat(${Math.max(cols.length, 1)}, minmax(160px, 1fr))` }}>
        <div className="sticky top-0 z-10 border-b border-gray-100 bg-gray-50 py-3" />
        {cols.map(p => (
          <div key={p.id} className="sticky top-0 z-10 border-b border-l border-gray-100 bg-gray-50 px-3 py-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: p.color }} />
              <span className="text-sm font-medium text-gray-700 truncate">{p.first_name} {p.last_name}</span>
            </div>
          </div>
        ))}

        <div className="relative border-r border-gray-100" style={{ height: '780px' }}>
          {HOURS.map(h => (
            <div key={h} className="absolute right-2 text-xs text-gray-400" style={{ top: `${((h - 7) / 13) * 100}%` }}>
              {h % 12 || 12}{h < 12 ? 'am' : 'pm'}
            </div>
          ))}
          {HOURS.map(h => (
            <div key={`l${h}`} className="absolute w-full border-t border-gray-100" style={{ top: `${((h - 7) / 13) * 100}%` }} />
          ))}
        </div>

        {cols.map(p => (
          <div key={p.id} className="relative border-l border-gray-100 cursor-pointer" style={{ height: '780px' }}
            onClick={e => { if (e.target === e.currentTarget) onClickSlot(); }}>
            {HOURS.map(h => (
              <div key={h} className="absolute w-full border-t border-gray-100" style={{ top: `${((h - 7) / 13) * 100}%` }} />
            ))}
            {appointments
              .filter(a => a.practitioner_id === p.id)
              .map(appt => (
                <div
                  key={appt.id}
                  onClick={e => { e.stopPropagation(); onClickAppt(appt); }}
                  className={cn('absolute inset-x-1 rounded border px-1.5 py-1 text-xs cursor-pointer overflow-hidden hover:shadow transition-shadow', STATUS_CLASS[appt.status] || STATUS_CLASS.scheduled)}
                  style={getStyle(appt)}
                >
                  <div className="font-medium truncate">{appt.client_name}</div>
                  <div className="text-gray-500">{fmtTime(appt.start_time)}–{fmtTime(appt.end_time)}</div>
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Week View ────────────────────────────────────────────────────────────────

function WeekView({ date, appointments, practitioners, filteredPractitionerId, onClickAppt, onClickDay }) {
  const weekStart = startOfWeek(date, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = startOfDay(new Date());

  const filteredAppts = filteredPractitionerId
    ? appointments.filter(a => a.practitioner_id === Number(filteredPractitionerId))
    : appointments;

  const practitionerColor = id => practitioners.find(p => p.id === id)?.color || '#6366f1';

  const getStyle = appt => {
    const start = new Date(appt.start_time);
    const end   = new Date(appt.end_time);
    const top    = ((start.getHours() - 7 + start.getMinutes() / 60) / 13) * 100;
    const height = Math.max(((end - start) / 1000 / 3600 / 13) * 100, 1.5);
    return { top: `${top}%`, height: `${height}%` };
  };

  return (
    <div className="flex-1 overflow-auto rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="grid min-w-max" style={{ gridTemplateColumns: '56px repeat(7, minmax(120px, 1fr))' }}>
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-gray-100 bg-gray-50 py-3" />
        {days.map(day => (
          <div key={day} className="sticky top-0 z-10 border-b border-l border-gray-100 bg-gray-50 px-2 py-2 text-center cursor-pointer hover:bg-indigo-50"
            onClick={() => onClickDay(day)}>
            <div className="text-xs text-gray-500">{format(day, 'EEE')}</div>
            <div className={cn('text-sm font-semibold mt-0.5 rounded-full w-7 h-7 flex items-center justify-center mx-auto',
              isSameDay(day, today) ? 'bg-indigo-600 text-white' : 'text-gray-900')}>
              {format(day, 'd')}
            </div>
          </div>
        ))}

        {/* Time column */}
        <div className="relative border-r border-gray-100" style={{ height: '780px' }}>
          {HOURS.map(h => (
            <div key={h} className="absolute right-2 text-xs text-gray-400" style={{ top: `${((h - 7) / 13) * 100}%` }}>
              {h % 12 || 12}{h < 12 ? 'am' : 'pm'}
            </div>
          ))}
          {HOURS.map(h => (
            <div key={`l${h}`} className="absolute w-full border-t border-gray-100" style={{ top: `${((h - 7) / 13) * 100}%` }} />
          ))}
        </div>

        {/* Day columns */}
        {days.map(day => (
          <div key={day} className={cn('relative border-l border-gray-100', isSameDay(day, today) && 'bg-indigo-50/20')} style={{ height: '780px' }}>
            {HOURS.map(h => (
              <div key={h} className="absolute w-full border-t border-gray-100" style={{ top: `${((h - 7) / 13) * 100}%` }} />
            ))}
            {filteredAppts
              .filter(a => isSameDay(new Date(a.start_time), day))
              .map(appt => (
                <div
                  key={appt.id}
                  onClick={() => onClickAppt(appt)}
                  className="absolute inset-x-1 rounded border px-1.5 py-1 text-xs cursor-pointer overflow-hidden hover:shadow transition-shadow"
                  style={{ ...getStyle(appt), borderColor: practitionerColor(appt.practitioner_id), background: practitionerColor(appt.practitioner_id) + '22', color: '#111' }}
                >
                  <div className="font-medium truncate">{appt.client_name}</div>
                  <div className="opacity-60">{fmtTime(appt.start_time)}</div>
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Month View ───────────────────────────────────────────────────────────────

function MonthView({ date, appointments, practitioners, filteredPractitionerId, onClickAppt, onClickDay }) {
  const monthStart = startOfMonth(date);
  const monthEnd   = endOfMonth(date);
  const gridStart  = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd    = endOfWeek(monthEnd,   { weekStartsOn: 1 });
  const days       = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const today      = startOfDay(new Date());

  const filteredAppts = filteredPractitionerId
    ? appointments.filter(a => a.practitioner_id === Number(filteredPractitionerId))
    : appointments;

  const practitionerColor = id => practitioners.find(p => p.id === id)?.color || '#6366f1';

  const apptsForDay = day => filteredAppts.filter(a => isSameDay(new Date(a.start_time), day));

  return (
    <div className="flex-1 overflow-auto rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-gray-100">
        {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
          <div key={d} className="px-3 py-2 text-xs font-medium text-gray-500 text-center">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 flex-1">
        {days.map(day => {
          const dayAppts = apptsForDay(day);
          return (
            <div
              key={day}
              onClick={() => onClickDay(day)}
              className={cn(
                'min-h-24 p-1.5 border-b border-r border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors',
                !isSameMonth(day, date) && 'bg-gray-50/60',
                isSameDay(day, today) && 'bg-indigo-50/30',
              )}
            >
              <div className={cn(
                'text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full mb-1',
                isSameDay(day, today) ? 'bg-indigo-600 text-white' : isSameMonth(day, date) ? 'text-gray-900' : 'text-gray-400',
              )}>
                {format(day, 'd')}
              </div>
              <div className="space-y-0.5">
                {dayAppts.slice(0, 3).map(appt => (
                  <div
                    key={appt.id}
                    onClick={e => { e.stopPropagation(); onClickAppt(appt); }}
                    className="truncate rounded px-1 py-0.5 text-xs font-medium cursor-pointer hover:opacity-80"
                    style={{ background: practitionerColor(appt.practitioner_id) + '33', color: '#111', borderLeft: `3px solid ${practitionerColor(appt.practitioner_id)}` }}
                  >
                    {fmtTime(appt.start_time)} {appt.client_name}
                  </div>
                ))}
                {dayAppts.length > 3 && (
                  <div className="text-xs text-gray-400 px-1">+{dayAppts.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Calendar ────────────────────────────────────────────────────────────

export default function Calendar() {
  const [date, setDate] = useState(startOfDay(new Date()));
  const [view, setView] = useState('day'); // 'day' | 'week' | 'month'
  const [appointments, setAppointments] = useState([]);
  const [practitioners, setPractitioners] = useState([]);
  const [practitionerFilter, setPractitionerFilter] = useState('');
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

  useEffect(() => {
    api.get('/practitioners').then(r => setPractitioners(r.data));
  }, []);

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

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="secondary" size="sm" onClick={() => nav(-1)}><ChevronLeft className="h-4 w-4" /></Button>
        <h1 className="text-base font-semibold w-56 text-center">{navLabel()}</h1>
        <Button variant="secondary" size="sm" onClick={() => nav(1)}><ChevronRight className="h-4 w-4" /></Button>
        <Button variant="ghost" size="sm" onClick={() => setDate(startOfDay(new Date()))}>Today</Button>

        {/* View tabs */}
        <div className="flex rounded-lg border border-gray-200 overflow-hidden ml-2">
          {['day','week','month'].map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                'px-3 py-1.5 text-sm capitalize',
                view === v ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
              )}
            >
              {v}
            </button>
          ))}
        </div>

        {/* Practitioner filter */}
        <select
          className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-700 ml-1"
          value={practitionerFilter}
          onChange={e => setPractitionerFilter(e.target.value)}
        >
          <option value="">All practitioners</option>
          {practitioners.map(p => (
            <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>
          ))}
        </select>

        <div className="ml-auto">
          <Button onClick={() => setModal('new')}><Plus className="h-4 w-4" /> New appointment</Button>
        </div>
      </div>

      {/* Calendar body */}
      {view === 'day' && (
        <DayView
          date={date}
          appointments={appointments}
          practitioners={practitioners}
          filteredPractitionerId={practitionerFilter}
          onClickAppt={setModal}
          onClickSlot={() => setModal('new')}
        />
      )}
      {view === 'week' && (
        <WeekView
          date={date}
          appointments={appointments}
          practitioners={practitioners}
          filteredPractitionerId={practitionerFilter}
          onClickAppt={setModal}
          onClickDay={goToDay}
        />
      )}
      {view === 'month' && (
        <MonthView
          date={date}
          appointments={appointments}
          practitioners={practitioners}
          filteredPractitionerId={practitionerFilter}
          onClickAppt={setModal}
          onClickDay={goToDay}
        />
      )}

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
