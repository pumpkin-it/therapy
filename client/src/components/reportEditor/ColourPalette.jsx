import { useEffect, useRef, useState } from 'react';

// Word-style colour picker: theme colours with lighter and darker shades, the standard colours,
// colours used recently (remembered in this browser), and "More colours…" for any colour at all.
//   onPick(hex)  — a colour was chosen
//   onClear      — the "no colour" choice (label: clearLabel)
const THEME = ['#ffffff', '#000000', '#e7e6e6', '#44546a', '#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47'];
const STANDARD = ['#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0'];
const RECENT_KEY = 'therapy-recent-colours';

const toRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const toHex = rgb => `#${rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const lighten = (hex, t) => toHex(toRgb(hex).map(v => v + (255 - v) * t));
const darken = (hex, t) => toHex(toRgb(hex).map(v => v * (1 - t)));
// Each theme colour's column, top to bottom (as in Word): the colour, three lighter, two darker.
// White and black get greys instead.
const shadesOf = hex => {
  if (hex === '#ffffff') return [hex, '#f2f2f2', '#d9d9d9', '#bfbfbf', '#a6a6a6', '#7f7f7f'];
  if (hex === '#000000') return [hex, '#7f7f7f', '#595959', '#404040', '#262626', '#0d0d0d'];
  return [hex, lighten(hex, 0.8), lighten(hex, 0.6), lighten(hex, 0.4), darken(hex, 0.25), darken(hex, 0.5)];
};

const readRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').slice(0, 10); } catch { return []; } };

export default function ColourPalette({ onPick, onClear, clearLabel = 'No colour', current = null }) {
  const [recent, setRecent] = useState(readRecent);
  const customRef = useRef(null);
  const pick = hex => {
    const next = [hex, ...recent.filter(c => c !== hex)].slice(0, 10);
    setRecent(next);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
    onPick(hex);
  };
  // The native picker's "change" fires once, when the person closes it (not on every drag).
  useEffect(() => {
    const el = customRef.current;
    if (!el) return undefined;
    const done = () => pick(el.value);
    el.addEventListener('change', done);
    return () => el.removeEventListener('change', done);
  });

  const swatch = (c, extra = '') => (
    <button key={c + extra} type="button" title={c} onClick={() => pick(c)}
      className={`h-5 w-5 border ${current?.toLowerCase() === c ? 'ring-2 ring-indigo-500 ring-offset-1' : ''} ${c === '#ffffff' ? 'border-gray-300' : 'border-black/10'} hover:scale-110`}
      style={{ background: c }} />
  );

  return (
    <div className="w-[236px] space-y-2 text-xs text-gray-600">
      <button type="button" onClick={onClear} className="flex w-full items-center gap-2 rounded px-1 py-1 hover:bg-gray-100">
        <span className="relative h-5 w-5 border border-gray-300 bg-white"><span className="absolute left-1/2 top-[-2px] h-6 w-px rotate-45 bg-red-500" /></span>
        {clearLabel}
      </button>
      <div>
        <p className="mb-1 font-medium">Theme colours</p>
        <div className="grid grid-cols-10 gap-[3px]">
          {[0, 1, 2, 3, 4, 5].flatMap(row => THEME.map(t => swatch(shadesOf(t)[row], `-${row}`)))}
        </div>
      </div>
      <div>
        <p className="mb-1 font-medium">Standard colours</p>
        <div className="grid grid-cols-10 gap-[3px]">{STANDARD.map(c => swatch(c, '-std'))}</div>
      </div>
      {recent.length > 0 && (
        <div>
          <p className="mb-1 font-medium">Recent</p>
          <div className="grid grid-cols-10 gap-[3px]">{recent.map(c => swatch(c, '-recent'))}</div>
        </div>
      )}
      <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-gray-100" onClick={e => e.stopPropagation()}>
        <input ref={customRef} type="color" defaultValue={current || '#4472c4'} className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0" />
        More colours…
      </label>
    </div>
  );
}
