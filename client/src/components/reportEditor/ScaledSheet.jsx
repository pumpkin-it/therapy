import { useLayoutEffect, useRef, useState } from 'react';
import { PAGE } from './PageGuides';

// The A4 page the document editors write on (reports, report templates, notes). The page is always
// laid out at its real size — so lines wrap exactly where they will in the PDF — and when the
// space is narrower than a page it's shown scaled down to fit rather than making the screen
// scroll sideways. PageGuides measures in the page's own, unscaled coordinates.
//   sheetRef — the page element (for PageGuides)
//   onScale  — told the current scale (1 = full size)
export default function ScaledSheet({ sheetRef, onScale, children }) {
  const areaRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(PAGE.height);
  const onScaleRef = useRef(onScale);
  onScaleRef.current = onScale;

  useLayoutEffect(() => {
    const area = areaRef.current, sheet = sheetRef.current;
    if (!area || !sheet) return;
    const measure = () => {
      const s = Math.min(1, area.clientWidth / PAGE.width);
      setScale(s);
      onScaleRef.current?.(s);
      setHeight(sheet.offsetHeight);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(area);
    ro.observe(sheet);
    measure();
    return () => ro.disconnect();
  }, [sheetRef]);

  return (
    <div ref={areaRef} className="w-full">
      <div className="mx-auto" style={{ width: PAGE.width * scale, height: height * scale }}>
        <div style={{ width: PAGE.width, transform: scale < 1 ? `scale(${scale})` : undefined, transformOrigin: 'top left' }}>
          <div ref={sheetRef} className="relative bg-white shadow-sm ring-1 ring-gray-200"
            style={{ width: PAGE.width, minHeight: PAGE.height, padding: PAGE.margin }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
