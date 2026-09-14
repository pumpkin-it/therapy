import { useState, useEffect } from 'react';
import {
  format, addDays, startOfDay, startOfWeek, endOfWeek,
  addWeeks, subWeeks, addMonths, subMonths, startOfMonth, endOfMonth,
} from 'date-fns';
import { ChevronLeft, ChevronRight, Plus, CalendarOff } from 'lucide-react';
import api from '../lib/api';
import { cn } from '../lib/utils';
import Button from '../components/ui/Button';
import AppointmentModal from '../components/AppointmentModal';
import BlockTimeModal from '../components/BlockTimeModal';
import CancelledAppointmentsModal from '../components/CancelledAppointmentsModal';
import { DayView, WeekView, MonthView } from '../components/CalendarViews';
import { useAuth } from '../context/AuthContext';

export default function Calendar() {
  const { user } = useAuth();
  const [date, setDate] = useState(startOfDay(new Date()));
  const [view, setView] = useState('week');
  const [appointments, setAppointments] = useState([]);
  const [timeBlocks, setTimeBlocks] = useState([]);
  const [practitioners, setPractitioners] = useState([]);
  const [practitionerFilter, setPractitionerFilter] = useState('');
  const [showCancelled, setShowCancelled] = useState(false);
  const [showCancelledList, setShowCancelledList] = useState(false);
  const [modal, setModal] = useState(null);
  const [blockModal, setBlockModal] = useState(null);

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
    api.get(`/time-blocks?${params}`).then(r => setTimeBlocks(r.data));
  };

  useEffect(() => { api.get('/practitioners?role=practitioner').then(r => setPractitioners(r.data)); }, []);
  useEffect(() => { load(); }, [dateStr, view]);

  // Fetch fresh rather than reusing the clicked list object directly — that object is a
  // snapshot from the last load() call, which is async and can still be in flight right after
  // a save (close modal -> load() kicked off -> reopen same appt before it resolves shows the
  // pre-save data). A per-open fetch matches the pattern already used in Invoices.jsx.
  const openAppt = async appt => {
    const { data } = await api.get(`/appointments/${appt.id}`);
    setModal(data);
  };

  // Practitioners default to seeing only their own appointments — the dropdown still lets
  // them switch to "All" or another practitioner. Owners/admins default to "All" as before.
  useEffect(() => {
    if (user?.role === 'practitioner') setPractitionerFilter(String(user.id));
  }, [user]);

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

  // A billable late cancellation still represents real, billable time — it stays visible in
  // the normal view (marked LC) alongside active appointments, not just in the cancelled-only
  // toggle, since finance/practitioners need to see it in their everyday calendar.
  const visibleAppointments = showCancelled
    ? appointments.filter(a => a.status === 'cancelled')
    : appointments.filter(a => a.status !== 'cancelled' || a.late_cancel_billable);

  // Time blocks are shaped to look like a (non-billable) appointment so they can flow through
  // the exact same overlap-layout/rendering code Day/Week/Month views already use for real
  // appointments — CalendarViews.jsx branches on `_isBlock` wherever the two need to look or
  // behave differently (styling, click target). Hidden entirely by the cancelled-only toggle,
  // since a block was never cancelled in the first place.
  const visibleBlocks = showCancelled ? [] : timeBlocks.map(b => ({
    id: `block-${b.id}`, _isBlock: true, raw: b,
    practitioner_id: b.practitioner_id, start_time: b.start_time, end_time: b.end_time,
    status: 'blocked', client_name: b.reason || 'Blocked time',
  }));
  const calendarItems = [...visibleAppointments, ...visibleBlocks];

  const onClickCalendarItem = item => item._isBlock ? setBlockModal(item.raw) : openAppt(item);

  // Clicking a calendar slot defaults straight into AppointmentModal — that's the common case
  // (a real appointment) the vast majority of the time. AppointmentModal itself carries a
  // small "Block time instead" link (shown only for a new, unsaved entry) that swaps over to
  // BlockTimeModal with whatever date/time/practitioner was already selected, so blocking time
  // is still one click away without making every appointment booking pay an extra step upfront.
  const switchToBlock = slot => { setModal(null); setBlockModal({ _new: true, ...slot }); };

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
          Show cancelled only
        </label>

        <Button variant="ghost" size="sm" onClick={() => setShowCancelledList(true)}>Cancelled appointments</Button>

        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => setBlockModal({ _new: true, date: dateStr })}>
            <CalendarOff className="h-4 w-4" /> Block time
          </Button>
          <Button onClick={() => setModal({ _new: true, date: dateStr })}><Plus className="h-4 w-4" /> New appointment</Button>
        </div>
      </div>

      {view === 'day' && (
        <DayView date={date} appointments={calendarItems} practitioners={practitioners}
          filteredPractitionerId={practitionerFilter} onClickAppt={onClickCalendarItem} dateStr={dateStr}
          onClickSlot={slot => setModal({ _new: true, ...slot })} />
      )}
      {view === 'week' && (
        <WeekView date={date} appointments={calendarItems} practitioners={practitioners}
          filteredPractitionerId={practitionerFilter} onClickAppt={onClickCalendarItem} onClickDay={goToDay}
          onClickSlot={slot => setModal({ _new: true, ...slot })} />
      )}
      {view === 'month' && (
        <MonthView date={date} appointments={calendarItems} practitioners={practitioners}
          filteredPractitionerId={practitionerFilter} onClickAppt={onClickCalendarItem} onClickDay={goToDay} />
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
          onSwitchToBlock={modal?._new ? switchToBlock : undefined}
        />
      )}

      {blockModal !== null && (
        <BlockTimeModal
          block={blockModal._new ? null : blockModal}
          defaultDate={blockModal._new ? blockModal.date : dateStr}
          defaultTime={blockModal._new ? blockModal.time : null}
          defaultPractitioner={blockModal._new ? blockModal.practitionerId : null}
          practitioners={practitioners}
          onClose={() => setBlockModal(null)}
          onSaved={() => { setBlockModal(null); load(); }}
        />
      )}

      {showCancelledList && (
        <CancelledAppointmentsModal onClose={() => setShowCancelledList(false)} />
      )}
    </div>
  );
}
