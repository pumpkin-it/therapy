import { useState, useRef, useEffect } from 'react';
import { useEditorState } from '@tiptap/react';
import {
  Bold, Italic, Underline, Strikethrough, AlignLeft, AlignCenter, AlignRight, AlignJustify, List, ListOrdered,
  Undo2, Redo2, Table, Image, Link2, Unlink, Highlighter, Baseline, RemoveFormatting, SeparatorHorizontal,
  UserSquare, Indent, Outdent, ChevronDown, Trash2,
} from 'lucide-react';
import { FIELD_GROUPS, LOGO_SIZE_NAMES } from './extensions';
import { REPORT_FONTS } from './fonts';
import { useConfirm } from '../ui/ConfirmDialog';

// Only fonts with a metric-identical free version (see fonts.js), so the PDF matches the page.
const FONTS = REPORT_FONTS;
const SIZES = ['9pt', '10pt', '11pt', '12pt', '14pt', '16pt', '18pt', '20pt', '24pt'];
const TEXT_COLOURS = ['#000000', '#404040', '#7f7f7f', '#c00000', '#e36c09', '#00b050', '#0070c0', '#1f3864', '#7030a0'];
const HIGHLIGHTS = ['#ffff00', '#92d050', '#9bc2e6', '#f4b183', '#d9d2e9'];

function Btn({ onClick, active, disabled, title, children }) {
  return (
    <button type="button" title={title} disabled={disabled}
      onMouseDown={e => e.preventDefault()} // keep the editor's selection when clicking the toolbar
      onClick={onClick}
      className={`h-8 min-w-8 px-1.5 inline-flex items-center justify-center rounded text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent ${active ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-100' : ''}`}>
      {children}
    </button>
  );
}

const Sep = () => <span className="mx-1 h-6 w-px bg-gray-200" />;

// A small click-to-open panel under a toolbar button; closes on outside click.
function Popover({ button, children, title }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    if (!open) return;
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <span className="relative" ref={ref}>
      <Btn title={title} onClick={() => setOpen(o => !o)} active={open}>{button}<ChevronDown className="h-3 w-3 ml-0.5" /></Btn>
      {open && (
        // onMouseDown: keep the editor focused while picking — otherwise the click moves focus to
        // this panel, and after the pick the next keystrokes land back where the cursor was
        // before the insert (text typed after a field ended up in front of it).
        <div className="absolute left-0 top-9 z-30 rounded-lg border border-gray-200 bg-white p-2 shadow-lg"
          onMouseDown={e => e.preventDefault()} onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </span>
  );
}

export default function Toolbar({ editor, fields, onPickImage }) {
  const confirm = useConfirm();
  // Re-render the toolbar only when what it displays actually changes, not on every keystroke.
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'), italic: e.isActive('italic'), underline: e.isActive('underline'), strike: e.isActive('strike'),
      h1: e.isActive('heading', { level: 1 }), h2: e.isActive('heading', { level: 2 }), h3: e.isActive('heading', { level: 3 }),
      left: e.isActive({ textAlign: 'left' }), center: e.isActive({ textAlign: 'center' }), right: e.isActive({ textAlign: 'right' }), justify: e.isActive({ textAlign: 'justify' }),
      bullet: e.isActive('bulletList'), ordered: e.isActive('orderedList'), link: e.isActive('link'), table: e.isActive('table'),
      font: e.getAttributes('textStyle').fontFamily || '', size: e.getAttributes('textStyle').fontSize || '',
      canUndo: e.can().undo(), canRedo: e.can().redo(),
      canSink: e.can().sinkListItem('listItem'), canLift: e.can().liftListItem('listItem'),
      canMerge: e.can().mergeCells(), canSplit: e.can().splitCell(),
      logo: e.isActive('practiceLogo'), logoSize: e.getAttributes('practiceLogo').size || 'medium',
    }),
  });
  const chain = () => editor.chain().focus();
  const style = s.h1 ? 'h1' : s.h2 ? 'h2' : s.h3 ? 'h3' : 'p';
  const setStyle = v => (v === 'p' ? chain().setParagraph().run() : chain().setHeading({ level: Number(v[1]) }).run());
  const selectCls = 'h-8 rounded border border-gray-200 bg-white px-1.5 text-sm text-gray-700 focus:outline-none focus:border-indigo-400';

  const setLink = async () => {
    const prev = editor.getAttributes('link').href || '';
    const url = await confirm({ title: prev ? 'Edit link' : 'Add link', input: { label: 'Link address', defaultValue: prev || 'https://' }, confirmLabel: 'Apply' });
    if (url === null) return;
    if (!url.trim() || url.trim() === 'https://') return chain().extendMarkRange('link').unsetLink().run();
    chain().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };

  return (
    <div className="border-b border-gray-200 bg-white">
      <div className="flex flex-wrap items-center gap-0.5 px-3 py-1.5">
        <Btn title="Undo (Ctrl+Z)" onClick={() => chain().undo().run()} disabled={!s.canUndo}><Undo2 className="h-4 w-4" /></Btn>
        <Btn title="Redo (Ctrl+Y)" onClick={() => chain().redo().run()} disabled={!s.canRedo}><Redo2 className="h-4 w-4" /></Btn>
        <Sep />
        <select title="Style" className={`${selectCls} w-28`} value={style} onChange={e => setStyle(e.target.value)}>
          <option value="p">Normal</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option>
        </select>
        <select title="Font" className={`${selectCls} w-32 ml-1`} value={s.font} onChange={e => (e.target.value ? chain().setFontFamily(e.target.value).run() : chain().unsetFontFamily().run())}>
          <option value="">Default font</option>
          {FONTS.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
        </select>
        <select title="Font size" className={`${selectCls} w-20 ml-1`} value={s.size} onChange={e => (e.target.value ? chain().setFontSize(e.target.value).run() : chain().unsetFontSize().run())}>
          <option value="">Size</option>
          {SIZES.map(z => <option key={z} value={z}>{z.replace('pt', '')}</option>)}
        </select>
        <Sep />
        <Btn title="Bold (Ctrl+B)" active={s.bold} onClick={() => chain().toggleBold().run()}><Bold className="h-4 w-4" /></Btn>
        <Btn title="Italic (Ctrl+I)" active={s.italic} onClick={() => chain().toggleItalic().run()}><Italic className="h-4 w-4" /></Btn>
        <Btn title="Underline (Ctrl+U)" active={s.underline} onClick={() => chain().toggleUnderline().run()}><Underline className="h-4 w-4" /></Btn>
        <Btn title="Strikethrough" active={s.strike} onClick={() => chain().toggleStrike().run()}><Strikethrough className="h-4 w-4" /></Btn>
        <Popover title="Text colour" button={<Baseline className="h-4 w-4" />}>
          <div className="grid grid-cols-5 gap-1 w-36">
            {TEXT_COLOURS.map(c => <button key={c} title={c} className="h-6 w-6 rounded border border-gray-200" style={{ background: c }} onClick={() => chain().setColor(c).run()} />)}
            <button className="col-span-5 mt-1 text-xs text-gray-600 hover:text-gray-900" onClick={() => chain().unsetColor().run()}>Automatic</button>
          </div>
        </Popover>
        <Popover title="Highlight" button={<Highlighter className="h-4 w-4" />}>
          <div className="grid grid-cols-5 gap-1 w-36">
            {HIGHLIGHTS.map(c => <button key={c} title={c} className="h-6 w-6 rounded border border-gray-200" style={{ background: c }} onClick={() => chain().setHighlight({ color: c }).run()} />)}
            <button className="col-span-5 mt-1 text-xs text-gray-600 hover:text-gray-900" onClick={() => chain().unsetHighlight().run()}>No highlight</button>
          </div>
        </Popover>
        <Sep />
        <Btn title="Align left" active={s.left} onClick={() => chain().setTextAlign('left').run()}><AlignLeft className="h-4 w-4" /></Btn>
        <Btn title="Centre" active={s.center} onClick={() => chain().setTextAlign('center').run()}><AlignCenter className="h-4 w-4" /></Btn>
        <Btn title="Align right" active={s.right} onClick={() => chain().setTextAlign('right').run()}><AlignRight className="h-4 w-4" /></Btn>
        <Btn title="Justify" active={s.justify} onClick={() => chain().setTextAlign('justify').run()}><AlignJustify className="h-4 w-4" /></Btn>
        <Sep />
        <Btn title="Bulleted list" active={s.bullet} onClick={() => chain().toggleBulletList().run()}><List className="h-4 w-4" /></Btn>
        <Btn title="Numbered list" active={s.ordered} onClick={() => chain().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></Btn>
        <Btn title="Decrease indent (Shift+Tab)" disabled={!s.canLift} onClick={() => chain().liftListItem('listItem').run()}><Outdent className="h-4 w-4" /></Btn>
        <Btn title="Increase indent (Tab)" disabled={!s.canSink} onClick={() => chain().sinkListItem('listItem').run()}><Indent className="h-4 w-4" /></Btn>
        <Sep />
        <Btn title={s.link ? 'Edit link' : 'Insert link'} active={s.link} onClick={setLink}><Link2 className="h-4 w-4" /></Btn>
        {s.link && <Btn title="Remove link" onClick={() => chain().extendMarkRange('link').unsetLink().run()}><Unlink className="h-4 w-4" /></Btn>}
        <Btn title="Insert table (3 × 3)" onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table className="h-4 w-4" /></Btn>
        <Btn title="Insert picture" onClick={onPickImage}><Image className="h-4 w-4" /></Btn>
        <Btn title="Start a new page here (Ctrl+Enter)" onClick={() => chain().setPageBreak().run()}><SeparatorHorizontal className="h-4 w-4" /><span className="ml-1 text-sm">Page break</span></Btn>
        <Popover title="Insert a field that fills in automatically" button={<><UserSquare className="h-4 w-4" /><span className="ml-1 text-sm">Insert field</span></>}>
          <div className="w-72 max-h-96 overflow-y-auto">
            <button className="flex w-full rounded px-2 py-1.5 text-left text-sm hover:bg-gray-100" onClick={() => chain().insertPracticeLogo().run()}>
              Practice logo
            </button>
            {FIELD_GROUPS.map(g => (
              <div key={g.label}>
                <p className="px-2 pt-2 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{g.label}</p>
                {g.fields.map(f => (
                  <button key={f.key} className="flex w-full justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-gray-100"
                    onClick={() => chain().insertClientField(f.key).run()}>
                    <span className="shrink-0">{f.label}</span>
                    <span className="truncate text-xs text-gray-400">{fields?.[f.key]}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </Popover>
        <Sep />
        <Btn title="Clear formatting" onClick={() => chain().unsetAllMarks().clearNodes().run()}><RemoveFormatting className="h-4 w-4" /></Btn>
      </div>

      {s.logo && (
        <div className="flex items-center gap-1 border-t border-gray-100 bg-gray-50 px-3 py-1 text-xs">
          <span className="mr-1 font-medium text-gray-500">Logo size:</span>
          {LOGO_SIZE_NAMES.map(size => (
            <button key={size} onMouseDown={e => e.preventDefault()} onClick={() => chain().setPracticeLogoSize(size).run()}
              className={`rounded border px-2 py-0.5 capitalize ${s.logoSize === size ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-100'}`}>{size}</button>
          ))}
          <span className="ml-2 text-gray-400">Use the alignment buttons to move it left, centre or right.</span>
        </div>
      )}

      {s.table && (
        <div className="flex flex-wrap items-center gap-1 border-t border-gray-100 bg-gray-50 px-3 py-1 text-xs">
          <span className="mr-1 font-medium text-gray-500">Table:</span>
          {[
            ['Row above', () => chain().addRowBefore().run()],
            ['Row below', () => chain().addRowAfter().run()],
            ['Column left', () => chain().addColumnBefore().run()],
            ['Column right', () => chain().addColumnAfter().run()],
            ['Delete row', () => chain().deleteRow().run()],
            ['Delete column', () => chain().deleteColumn().run()],
            ['Merge cells', () => chain().mergeCells().run(), !s.canMerge],
            ['Split cell', () => chain().splitCell().run(), !s.canSplit],
            ['Header row', () => chain().toggleHeaderRow().run()],
          ].map(([label, fn, disabled]) => (
            <button key={label} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={fn}
              className="rounded border border-gray-200 bg-white px-2 py-0.5 text-gray-700 hover:bg-gray-100 disabled:opacity-40">{label}</button>
          ))}
          <button onMouseDown={e => e.preventDefault()} onClick={() => chain().deleteTable().run()}
            className="ml-auto inline-flex items-center gap-1 rounded px-2 py-0.5 text-red-600 hover:bg-red-50"><Trash2 className="h-3 w-3" /> Delete table</button>
        </div>
      )}
    </div>
  );
}
