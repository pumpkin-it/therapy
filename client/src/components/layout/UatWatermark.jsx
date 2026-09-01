import { isUAT } from '../../lib/env';

const TILE = `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'>
  <text x='120' y='130' font-size='34' font-family='sans-serif' font-weight='700'
    fill='%237c3aed' fill-opacity='0.35' text-anchor='middle'
    transform='rotate(-30 120 120)'>UAT</text>
</svg>`;

export default function UatWatermark() {
  if (!isUAT) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[9999]"
      style={{
        backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(TILE)}")`,
        backgroundRepeat: 'repeat',
      }}
    />
  );
}
