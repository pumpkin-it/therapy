import { localToday } from '../lib/utils';

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const daysInMonth = (year, month) => new Date(year, month, 0).getDate(); // month is 1-12

function StepperCell({ value, onInc, onDec, width = 'w-10' }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <button type="button" onClick={onInc} tabIndex={-1}
        className="h-4 w-4 flex items-center justify-center rounded-full bg-indigo-100 text-indigo-600 hover:bg-indigo-200 text-[9px] leading-none">▲</button>
      <div className={`${width} text-center text-sm font-medium border border-gray-300 rounded py-1 bg-white`}>{value}</div>
      <button type="button" onClick={onDec} tabIndex={-1}
        className="h-4 w-4 flex items-center justify-center rounded-full bg-indigo-100 text-indigo-600 hover:bg-indigo-200 text-[9px] leading-none">▼</button>
    </div>
  );
}

// Replaces a plain date input + hour/minute/AM-PM selects with six +/- stepper cells
// (day/month/year/hour/minute/AM-PM) that auto-carry into the next field when they tick over —
// day 31 rolls into next month, December rolls into next year, hour 12 flips AM/PM.
// Shared by AppointmentModal and BlockTimeModal so both pick a time the same way.
export default function DateTimeStepper({ date, time, onChange }) {
  const [year, month, day] = (date || localToday()).split('-').map(Number);
  const parseTime = v => {
    if (!v) return { h: 9, m: 0, ampm: 'AM' };
    const [hh, mm] = v.split(':').map(Number);
    return { h: hh === 0 ? 12 : hh > 12 ? hh - 12 : hh, m: mm, ampm: hh < 12 ? 'AM' : 'PM' };
  };
  const { h, m, ampm } = parseTime(time);

  const emitDate = (y, mo, d) => onChange(`${String(y).padStart(4,'0')}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`, time);
  const emitTime = (newH, newM, newAmpm) => {
    const h24 = newH % 12 + (newAmpm === 'PM' ? 12 : 0);
    onChange(date, `${String(h24).padStart(2,'0')}:${String(newM).padStart(2,'0')}`);
  };

  const stepDay = delta => {
    const d = new Date(year, month - 1, day + delta);
    emitDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
  };
  const stepMonth = delta => {
    let mo = month - 1 + delta; // 0-based
    const y = year + Math.floor(mo / 12);
    mo = ((mo % 12) + 12) % 12;
    emitDate(y, mo + 1, Math.min(day, daysInMonth(y, mo + 1)));
  };
  const stepYear = delta => {
    const y = year + delta;
    emitDate(y, month, Math.min(day, daysInMonth(y, month)));
  };
  const flipAmpm = a => a === 'AM' ? 'PM' : 'AM';
  // 12-hour clock stepping: the AM/PM flip happens crossing 11→12 (up) or 12→11 (down), not
  // when the hour numerically exceeds 12 — 12 is a valid hour (noon or midnight), so a plain
  // "> 12" / "< 1" check misses the flip exactly at that boundary (11am+1 must become 12pm,
  // not wrap silently to 12am).
  const nextHourUp = fromH => fromH === 11 ? { h: 12, flip: true } : fromH === 12 ? { h: 1, flip: false } : { h: fromH + 1, flip: false };
  const nextHourDown = fromH => fromH === 12 ? { h: 11, flip: true } : fromH === 1 ? { h: 12, flip: false } : { h: fromH - 1, flip: false };

  const stepHour = delta => {
    const { h: newH, flip } = delta > 0 ? nextHourUp(h) : nextHourDown(h);
    emitTime(newH, m, flip ? flipAmpm(ampm) : ampm);
  };
  const stepMinute = delta => {
    let newM = m + delta, newH = h, newAmpm = ampm;
    if (newM >= 60) { newM -= 60; const r = nextHourUp(h);   newH = r.h; if (r.flip) newAmpm = flipAmpm(ampm); }
    if (newM < 0)   { newM += 60; const r = nextHourDown(h); newH = r.h; if (r.flip) newAmpm = flipAmpm(ampm); }
    emitTime(newH, newM, newAmpm);
  };

  return (
    <div className="flex items-end gap-1.5">
      <StepperCell value={String(day).padStart(2,'0')} onInc={() => stepDay(1)} onDec={() => stepDay(-1)} width="w-9" />
      <StepperCell value={MONTH_NAMES[month-1]} onInc={() => stepMonth(1)} onDec={() => stepMonth(-1)} width="w-10" />
      <StepperCell value={year} onInc={() => stepYear(1)} onDec={() => stepYear(-1)} width="w-14" />
      <StepperCell value={h} onInc={() => stepHour(1)} onDec={() => stepHour(-1)} width="w-8" />
      <StepperCell value={String(m).padStart(2,'0')} onInc={() => stepMinute(15)} onDec={() => stepMinute(-15)} width="w-9" />
      <StepperCell value={ampm} onInc={() => emitTime(h, m, flipAmpm(ampm))} onDec={() => emitTime(h, m, flipAmpm(ampm))} width="w-10" />
    </div>
  );
}
