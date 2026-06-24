import { useState, useEffect } from 'react';
import {
  format, addDays, startOfDay, startOfWeek, endOfWeek,
  addWeeks, subWeeks, addMonths, subMonths, startOfMonth, endOfMonth,
  isSameDay, isSameMonth, parseISO, eachDayOfInterval,
} from 'date-fns';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import api from '../lib/api';
import { fmtTime, cn } from '../lib/utils';
import Button from './ui/Button';
import AppointmentModal from './AppointmentModal';

export const STATUS_CLASS = {
  scheduled: 'bg-blue-50 border-blue-300 text-blue-900',
  confirmed:  'bg-green-50 border-green-300 text-green-900',
  completed:  'bg-gray-100 border-gray-300 text-gray-600',
  cancelled:  'bg-red-50 border-red-200 text-red-700 opacity-60',
  no_show:    'bg-orange-50 border-orange-300 text-orange-900',
};

export const HOUR_START = 6;
export const HOUR_COUNT = 16; // 6am–9pm
export const HOURS = Array.from({ length: HOUR_COUNT }, (_, i) => i + HOUR_START);
const SLOT_COUNT = HOUR_COUNT * 4; // 15-min slots

function calcTimeFromClick(e, containerEl) {
  const rect = containerEl.getBoundingClientRect();
  const y = e.clientY - rect.top;
  const pct = y / rect.height;
  const totalMin = Math.max(0, Math.min(pct * HOUR_COUNT * 60, HOUR_COUNT * 60 - 15));
  const h = Math.floor(totalMin / 60) + HOUR_START;
  const m = Math.floor(totalMin % 60 / 15) * 15;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

export const apptRef = id => `APT-${String(id).padStart(5,'0')}`;

export function getStyle(startISO, endISO) {
  const start = new Date(startISO);
  const end   = new Date(endISO);
  const top    = ((start.getHours() - HOUR_START + start.getMinutes() / 60) / HOUR_COUNT) * 100;
  const height = Math.max(((end - start) / 1000 / 3600 / HOUR_COUNT) * 100, 1.5);
  return { top: `${top}%`, height: `${height}%` };
}

export function travelBlocks(appt) {
  const toMin = (appt.items || []).reduce((s, i) => s + (i.travel_time_to || 0), 0);
  const fromMin = (appt.items || []).reduce((s, i) => s + (i.travel_time_from || 0), 0);
  // Fallback to old travel_time_min split evenly
  if (!toMin && !fromMin) {
    const totalMin = (appt.items || []).reduce((s, i) => s + (i.travel_time_min || 0), 0);
    if (!totalMin) return [];
    const half = totalMin / 2;
    const start = new Date(appt.start_time);
    const end   = new Date(appt.end_time);
    return [
      { key: 'before', startISO: new Date(start.getTime() - half * 60000).toISOString(), endISO: appt.start_time },
      { key: 'after',  startISO: appt.end_time, endISO: new Date(end.getTime() + half * 60000).toISOString() },
    ];
  }
  const blocks = [];
  const start = new Date(appt.start_time);
  const end   = new Date(appt.end_time);
  if (toMin) blocks.push({ key: 'before', startISO: new Date(start.getTime() - toMin * 60000).toISOString(), endISO: appt.start_time });
  if (fromMin) blocks.push({ key: 'after', startISO: appt.end_time, endISO: new Date(end.getTime() + fromMin * 60000).toISOString() });
  return blocks;
}

// ─── Overlap layout ─────────────────────────────────────────────────────────
// Returns a map of appt.id → { left: '...%', width: '...%' }
export function overlapLayout(appts) {
  if (!appts.length) return {};
  const sorted = [...appts].sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  const columns = []; // each column is an array of appts
  const colMap = {};  // appt.id → column index

  for (const appt of sorted) {
    const s = new Date(appt.start_time).getTime();
    let placed = false;
    for (let c = 0; c < columns.length; c++) {
      const last = columns[c][columns[c].length - 1];
      if (new Date(last.end_time).getTime() <= s) {
        columns[c].push(appt);
        colMap[appt.id] = c;
        placed = true;
        break;
      }
    }
    if (!placed) {
      colMap[appt.id] = columns.length;
      columns.push([appt]);
    }
  }

  // For each appointment, count the max concurrent overlaps in its time range
  const result = {};
  for (const appt of sorted) {
    const s = new Date(appt.start_time).getTime();
    const e = new Date(appt.end_time).getTime();
    // Find all appointments overlapping with this one (including itself)
    const overlapping = sorted.filter(o => {
      const os = new Date(o.start_time).getTime();
      const oe = new Date(o.end_time).getTime();
      return os < e && oe > s;
    });
    const totalCols = overlapping.length;
    const col = colMap[appt.id];
    const w = 100 / totalCols;
    result[appt.id] = { left: `${col * w}%`, width: `${w * 0.80}%` };
  }
  return result;
}

// ─── Day View ────────────────────────────────────────────────────────────────

export function DayView({ date, appointments, practitioners, filteredPractitionerId, onClickAppt, onClickSlot, dateStr }) {
  const cols = filteredPractitionerId
    ? practitioners.filter(p => p.id === Number(filteredPractitionerId))
    : practitioners;

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

        <div className="relative border-r border-gray-100" style={{ height: `${SLOT_COUNT * 20}px` }}>
          {HOURS.map(h => (
            <div key={h} className="absolute right-2 text-xs text-gray-400" style={{ top: `${((h - HOUR_START) / HOUR_COUNT) * 100}%` }}>
              {h % 12 || 12}{h < 12 ? 'am' : 'pm'}
            </div>
          ))}
          {Array.from({ length: SLOT_COUNT }, (_, i) => {
            const isHour = i % 4 === 0;
            return <div key={i} className={`absolute w-full ${isHour ? 'border-t border-gray-200' : 'border-t border-gray-50'}`}
              style={{ top: `${(i / SLOT_COUNT) * 100}%` }} />;
          })}
        </div>

        {cols.map(p => (
          <div key={p.id} className="relative border-l border-gray-100 cursor-pointer" style={{ height: `${SLOT_COUNT * 20}px` }}
            onClick={e => { if (e.target.closest('[data-appt]')) return; const time = calcTimeFromClick(e, e.currentTarget); onClickSlot({ date: dateStr || format(date, 'yyyy-MM-dd'), time, practitionerId: p.id }); }}>
            {Array.from({ length: SLOT_COUNT }, (_, i) => {
              const isHour = i % 4 === 0;
              return <div key={i} className={`absolute w-full ${isHour ? 'border-t border-gray-200' : 'border-t border-gray-50'}`}
                style={{ top: `${(i / SLOT_COUNT) * 100}%`, height: `${100 / SLOT_COUNT}%` }} />;
            })}
            {(() => {
              const pAppts = appointments.filter(a => a.practitioner_id === p.id);
              const layout = overlapLayout(pAppts);
              return pAppts.map(appt => {
                const ol = layout[appt.id] || { left: '0%', width: '100%' };
                return (
                <div key={appt.id}>
                  {travelBlocks(appt).map(tb => (
                    <div key={`${appt.id}-${tb.key}`}
                      className="absolute rounded border px-1.5 py-0.5 text-xs overflow-hidden pointer-events-none"
                      style={{ ...getStyle(tb.startISO, tb.endISO), left: ol.left, width: ol.width, borderColor: p.color, background: p.color + '22' }}
                    >
                      <div className="truncate" style={{ color: p.color }}>Travel</div>
                    </div>
                  ))}
                  <div
                    onClick={e => { e.stopPropagation(); onClickAppt(appt); }}
                    data-appt title={apptRef(appt.id)}
                    className={cn('absolute rounded border px-1.5 py-1 text-xs cursor-pointer overflow-hidden hover:shadow transition-shadow', STATUS_CLASS[appt.status] || STATUS_CLASS.scheduled)}
                    style={{ ...getStyle(appt.start_time, appt.end_time), left: ol.left, width: ol.width }}
                  >
                    {appt.series_id && <span className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full bg-indigo-600 text-white text-[8px] font-bold flex items-center justify-center leading-none">R</span>}
                    <div className="font-medium truncate">{appt.client_name}</div>
                    <div className="text-gray-500">{fmtTime(appt.start_time)}–{fmtTime(appt.end_time)}</div>
                  </div>
                </div>
                );
              });
            })()}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Week View ────────────────────────────────────────────────────────────────

export function WeekView({ date, appointments, practitioners, filteredPractitionerId, onClickAppt, onClickDay, onClickSlot }) {
  const weekStart = startOfWeek(date, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = startOfDay(new Date());

  const filteredAppts = filteredPractitionerId
    ? appointments.filter(a => a.practitioner_id === Number(filteredPractitionerId))
    : appointments;

  const practitionerColor = id => practitioners.find(p => p.id === id)?.color || '#6366f1';

  return (
    <div className="flex-1 overflow-auto rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="grid min-w-max" style={{ gridTemplateColumns: '56px repeat(7, minmax(120px, 1fr))' }}>
        <div className="sticky top-0 z-10 border-b border-gray-100 bg-gray-50 py-3" />
        {days.map(day => (
          <div key={day.toISOString()} className="sticky top-0 z-10 border-b border-l border-gray-100 bg-gray-50 px-2 py-2 text-center cursor-pointer hover:bg-indigo-50"
            onClick={() => onClickDay(day)}>
            <div className="text-xs text-gray-500">{format(day, 'EEE')}</div>
            <div className={cn('text-sm font-semibold mt-0.5 rounded-full w-7 h-7 flex items-center justify-center mx-auto',
              isSameDay(day, today) ? 'bg-indigo-600 text-white' : 'text-gray-900')}>
              {format(day, 'd')}
            </div>
          </div>
        ))}

        <div className="relative border-r border-gray-100" style={{ height: `${SLOT_COUNT * 20}px` }}>
          {HOURS.map(h => (
            <div key={h} className="absolute right-2 text-xs text-gray-400" style={{ top: `${((h - HOUR_START) / HOUR_COUNT) * 100}%` }}>
              {h % 12 || 12}{h < 12 ? 'am' : 'pm'}
            </div>
          ))}
          {Array.from({ length: SLOT_COUNT }, (_, i) => {
            const isHour = i % 4 === 0;
            return <div key={i} className={`absolute w-full ${isHour ? 'border-t border-gray-200' : 'border-t border-gray-50'}`}
              style={{ top: `${(i / SLOT_COUNT) * 100}%` }} />;
          })}
        </div>

        {days.map(day => (
          <div key={day.toISOString()} className={cn('relative border-l border-gray-100 cursor-pointer', isSameDay(day, today) && 'bg-indigo-50/20')} style={{ height: `${SLOT_COUNT * 20}px` }}
            onClick={e => { if (onClickSlot && !e.target.closest('[data-appt]')) { const time = calcTimeFromClick(e, e.currentTarget); onClickSlot({ date: format(day, 'yyyy-MM-dd'), time }); } }}>
            {Array.from({ length: SLOT_COUNT }, (_, i) => {
              const isHour = i % 4 === 0;
              return <div key={i} className={`absolute w-full ${isHour ? 'border-t border-gray-200' : 'border-t border-gray-50'}`}
                style={{ top: `${(i / SLOT_COUNT) * 100}%`, height: `${100 / SLOT_COUNT}%` }} />;
            })}
            {(() => {
              const dayAppts = filteredAppts.filter(a => isSameDay(new Date(a.start_time), day));
              const layout = overlapLayout(dayAppts);
              return dayAppts.map(appt => {
                const ol = layout[appt.id] || { left: '0%', width: '100%' };
                return (
                <div key={appt.id}>
                  {travelBlocks(appt).map(tb => (
                    <div key={`${appt.id}-${tb.key}`}
                      className="absolute rounded border px-1 py-0.5 text-xs overflow-hidden pointer-events-none"
                      style={{ ...getStyle(tb.startISO, tb.endISO), left: ol.left, width: ol.width, borderColor: practitionerColor(appt.practitioner_id), background: practitionerColor(appt.practitioner_id) + '22' }}
                    >
                      <div className="truncate text-[10px]" style={{ color: practitionerColor(appt.practitioner_id) }}>Travel</div>
                    </div>
                  ))}
                  <div
                    onClick={() => onClickAppt(appt)}
                    data-appt title={apptRef(appt.id)}
                    className="absolute rounded border px-1.5 py-1 text-xs cursor-pointer overflow-hidden hover:shadow transition-shadow"
                    style={{ ...getStyle(appt.start_time, appt.end_time), left: ol.left, width: ol.width, borderColor: practitionerColor(appt.practitioner_id), background: practitionerColor(appt.practitioner_id) + '22', color: '#111' }}
                  >
                    {appt.series_id && <span className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full bg-indigo-600 text-white text-[8px] font-bold flex items-center justify-center leading-none">R</span>}
                    <div className="font-medium truncate">{appt.client_name}</div>
                    <div className="opacity-60">{fmtTime(appt.start_time)}</div>
                  </div>
                </div>
                );
              });
            })()}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Month View ───────────────────────────────────────────────────────────────

export function MonthView({ date, appointments, practitioners, filteredPractitionerId, onClickAppt, onClickDay }) {
  const monthStart = startOfMonth(date);
  const monthEnd   = endOfMonth(date);
  const gridStart  = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd    = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days       = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const today      = startOfDay(new Date());

  const filteredAppts = filteredPractitionerId
    ? appointments.filter(a => a.practitioner_id === Number(filteredPractitionerId))
    : appointments;

  const practitionerColor = id => practitioners.find(p => p.id === id)?.color || '#6366f1';
  const apptsForDay = day => filteredAppts.filter(a => isSameDay(new Date(a.start_time), day));

  return (
    <div className="flex-1 overflow-auto rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="grid grid-cols-7 border-b border-gray-100">
        {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
          <div key={d} className="px-3 py-2 text-xs font-medium text-gray-500 text-center">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 flex-1">
        {days.map(day => {
          const dayAppts = apptsForDay(day);
          return (
            <div key={day.toISOString()}
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
                  <div key={appt.id}
                    onClick={e => { e.stopPropagation(); onClickAppt(appt); }}
                    data-appt title={apptRef(appt.id)}
                    className="truncate rounded px-1 py-0.5 text-xs font-medium cursor-pointer hover:opacity-80"
                    style={{ background: practitionerColor(appt.practitioner_id) + '33', color: '#111', borderLeft: `3px solid ${practitionerColor(appt.practitioner_id)}` }}
                  >
                    {appt.series_id && <span className="inline-flex items-center justify-center h-3 w-3 rounded-full bg-indigo-600 text-white text-[7px] font-bold mr-0.5 leading-none">R</span>}{fmtTime(appt.start_time)} {appt.client_name}
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

// ─── Embedded Calendar (for client/practitioner profiles) ─────────────────────

export function EmbeddedCalendar({ clientId, practitionerId }) {
  const [date, setDate] = useState(startOfDay(new Date()));
  const [view, setView] = useState('week');
  const [appointments, setAppointments] = useState([]);
  const [practitioners, setPractitioners] = useState([]);
  const [modal, setModal] = useState(null);

  const dateStr = format(date, 'yyyy-MM-dd');

  const load = () => {
    let params;
    if (view === 'day') {
      params = `date=${dateStr}`;
    } else if (view === 'week') {
      const ws = format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd');
      const we = format(endOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd');
      params = `from=${ws}T00:00&to=${we}T23:59`;
    } else {
      const ms = format(startOfMonth(date), 'yyyy-MM-dd');
      const me = format(endOfMonth(date), 'yyyy-MM-dd');
      params = `from=${ms}T00:00&to=${me}T23:59`;
    }
    if (clientId) params += `&client_id=${clientId}`;
    if (practitionerId) params += `&practitioner_id=${practitionerId}`;
    api.get(`/appointments?${params}`).then(r => setAppointments(r.data.filter(a => a.status !== 'cancelled')));
  };

  useEffect(() => { api.get('/practitioners').then(r => setPractitioners(r.data)); }, []);
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
  const defaultDate = format(date, 'yyyy-MM-dd');

  return (
    <div className="flex flex-col space-y-3" style={{ height: '75vh' }}>
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="secondary" size="sm" onClick={() => nav(-1)}><ChevronLeft className="h-4 w-4" /></Button>
        <span className="text-sm font-semibold w-52 text-center">{navLabel()}</span>
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
        <div className="ml-auto">
          <Button size="sm" onClick={() => setModal({ _new: true, date: defaultDate })}><Plus className="h-4 w-4" /> New</Button>
        </div>
      </div>

      {view === 'day' && (
        <DayView date={date} appointments={appointments} practitioners={practitioners}
          filteredPractitionerId={practitionerId || ''} dateStr={defaultDate}
          onClickAppt={setModal} onClickSlot={slot => setModal({ _new: true, ...slot })} />
      )}
      {view === 'week' && (
        <WeekView date={date} appointments={appointments} practitioners={practitioners}
          filteredPractitionerId={practitionerId || ''}
          onClickAppt={setModal} onClickDay={goToDay}
          onClickSlot={slot => setModal({ _new: true, ...slot })} />
      )}
      {view === 'month' && (
        <MonthView date={date} appointments={appointments} practitioners={practitioners}
          filteredPractitionerId={practitionerId || ''}
          onClickAppt={setModal} onClickDay={goToDay} />
      )}

      {modal !== null && (
        <AppointmentModal
          appointment={modal === 'new' || modal?._new ? null : modal}
          defaultDate={modal?._new ? modal.date : defaultDate}
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
