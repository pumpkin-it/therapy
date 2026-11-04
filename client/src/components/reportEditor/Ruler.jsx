import { useRef } from 'react';
import { useEditorState } from '@tiptap/react';
import { paragraphFormat } from './wordFormat';

// Word's horizontal ruler over the page: the margins (grey), centimetres counted from the left
// margin, and the current paragraph's indents to drag —
//   ▽ first line (top left)   △ hanging: the other lines, first line stays put (bottom left)
//   ▭ left: moves both together (under the hanging marker)   △ right indent (bottom right)
// Dragging changes every selected paragraph (wordFormat.js setIndent), in steps of 0.25 cm.
const PX_PER_CM = 96 / 2.54;
const SNAP = 0.25;

export default function Ruler({ editor, geometry, scale }) {
  const ref = useRef(null);
  const ind = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const a = paragraphFormat(e.state);
      return { left: Number(a.indentLeft) || 0, right: Number(a.indentRight) || 0, first: Number(a.indentFirst) || 0, editable: e.isEditable };
    },
  });
  if (!ind?.editable) return null;
  const { width, left: ml, right: mr } = geometry;
  const contentCm = (width - ml - mr) / PX_PER_CM;
  const x = cm => (ml + cm * PX_PER_CM) * scale; // cm from the left margin → px on the ruler

  const drag = which => e => {
    e.preventDefault();
    const box = ref.current.getBoundingClientRect();
    const start = { ...ind };
    const toCm = clientX => Math.round((((clientX - box.left) / scale - ml) / PX_PER_CM) / SNAP) * SNAP;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const move = ev => {
      const at = toCm(ev.clientX);
      let attrs;
      if (which === 'first') attrs = { indentFirst: clamp(at, 0, contentCm - start.right - 1) - start.left };
      else if (which === 'hanging') {
        // The other lines move; the first line stays where it is.
        const l = clamp(at, 0, contentCm - start.right - 1);
        attrs = { indentLeft: l, indentFirst: start.left + start.first - l };
      } else if (which === 'left') attrs = { indentLeft: clamp(at, Math.max(0, -start.first), contentCm - start.right - 1) };
      else attrs = { indentRight: clamp(contentCm - at, 0, contentCm - start.left - 1) };
      const tidy = v => (v === undefined ? undefined : Math.round(v * 100) / 100 || null);
      editor.chain().setIndent(Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, tidy(v)]))).run();
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); editor.commands.focus(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const ticks = [];
  for (let cm = -Math.floor(ml / PX_PER_CM); cm <= Math.ceil(contentCm + mr / PX_PER_CM); cm += 0.5) {
    const whole = Number.isInteger(cm);
    ticks.push(
      <div key={cm} className="absolute bottom-0 flex flex-col items-center" style={{ left: x(cm), transform: 'translateX(-50%)' }}>
        {whole && cm !== 0 ? <span className="text-[9px] leading-none text-gray-500">{Math.abs(cm)}</span> : null}
        <span className={`w-px bg-gray-400 ${whole ? 'h-1.5' : 'h-1'}`} />
      </div>,
    );
  }
  const marker = 'absolute h-0 w-0 cursor-ew-resize border-x-[5px] border-x-transparent';
  return (
    <div ref={ref} className="relative mx-auto h-6 select-none border-b border-gray-200 bg-gray-100" style={{ width: width * scale }}
      title="Drag the markers to set the paragraph's indents">
      <div className="absolute inset-y-0 bg-white" style={{ left: ml * scale, right: mr * scale }} />
      {ticks}
      <div className={`${marker} top-0 border-t-[7px] border-t-gray-600`} style={{ left: x(ind.left + ind.first) - 5 }}
        title="First line indent" onPointerDown={drag('first')} />
      <div className={`${marker} bottom-[5px] border-b-[7px] border-b-gray-600`} style={{ left: x(ind.left) - 5 }}
        title="Hanging indent" onPointerDown={drag('hanging')} />
      <div className="absolute bottom-0 h-[5px] w-[10px] cursor-ew-resize bg-gray-600" style={{ left: x(ind.left) - 5 }}
        title="Left indent" onPointerDown={drag('left')} />
      <div className={`${marker} bottom-0 border-b-[7px] border-b-gray-600`} style={{ left: x(contentCm - ind.right) - 5 }}
        title="Right indent" onPointerDown={drag('right')} />
    </div>
  );
}
