import { useState, useRef, useEffect } from 'react';
import { useEditorState } from '@tiptap/react';
import {
  Bold, Italic, Underline, Strikethrough, AlignLeft, AlignCenter, AlignRight, AlignJustify, List, ListOrdered,
  Undo2, Redo2, Table, Image, Link2, Unlink, Highlighter, Baseline, RemoveFormatting, SeparatorHorizontal,
  UserSquare, Indent, Outdent, ChevronDown, Trash2, PaintBucket, Superscript, Subscript, CaseSensitive, Paintbrush,
  AArrowUp, AArrowDown, UnfoldVertical, Check, LayoutTemplate,
} from 'lucide-react';
import ColourPalette from './ColourPalette';
import { shadeCells, setRowHeight, setColumnWidth, evenColumns, tableInfo, wantsCellColour, cmToPx, pxToCm, setCellVAlign, setBorders, toggleRepeatHeader } from './tables';
import { pageGeometry, MARGIN_PRESETS } from './pageSetup';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { FIELD_GROUPS, LOGO_SIZE_NAMES, humaniseVar } from './extensions';
import { REPORT_FONTS } from './fonts';
import { selectedPicture, setPictureInline } from './images';
import { useConfirm } from '../ui/ConfirmDialog';
import { LINE_SPACINGS, SPACINGS_PT, paragraphFormat, changeCase, stepFont, copyFormat, pasteFormat } from './wordFormat';

// Only fonts with a metric-identical free version (see fonts.js), so the PDF matches the page.
const FONTS = REPORT_FONTS;
const SIZES = ['9pt', '10pt', '11pt', '12pt', '14pt', '16pt', '18pt', '20pt', '24pt'];

// A size in cm for the table bar (row height / column width). Empty = automatic. Applied on Enter
// or when leaving the box.
function CmInput({ label, valuePx, onApply, placeholder = 'Auto' }) {
  const [text, setText] = useState(valuePx ? String(pxToCm(valuePx)) : '');
  useEffect(() => { setText(valuePx ? String(pxToCm(valuePx)) : ''); }, [valuePx]);
  const apply = () => {
    const v = text.trim().replace(',', '.');
    if (!v) { if (valuePx) onApply(null); return; }
    const cm = Number(v);
    if (Number.isFinite(cm) && cm > 0 && cm !== pxToCm(valuePx || 0)) onApply(cmToPx(cm));
  };
  return (
    <label className="inline-flex items-center gap-1 text-gray-500">
      {label}
      <input value={text} onChange={e => setText(e.target.value)} onBlur={apply} placeholder={placeholder} inputMode="decimal"
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } }}
        className="w-14 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-right text-gray-700 focus:border-indigo-400 focus:outline-none" />
      <span>cm</span>
    </label>
  );
}

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

const ChoiceBtn = ({ on, onClick, children }) => (
  <button onMouseDown={e => e.preventDefault()} onClick={onClick}
    className={`rounded border px-2 py-0.5 ${on ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-100'}`}>{children}</button>
);

const Sep = () => <span className="mx-1 h-6 w-px bg-gray-200" />;

// A row in a toolbar drop-down list (ticked when it's the current choice).
const MenuItem = ({ on, onClick, children }) => (
  <button className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-gray-100" onClick={onClick}>
    <Check className={`h-3.5 w-3.5 ${on ? 'text-indigo-600' : 'invisible'}`} />{children}
  </button>
);

// Common symbols (Word: Insert › Symbol).
const SYMBOLS = '©®™°±×÷•–—…‘’“”€£$¢¥§¶µ½¼¾²³¹≤≥≠≈∞√←→↑↓↔✓✗☐☑★αβγδΔπΣΩ';

// Word's Insert › Table grid: point to choose rows × columns.
function TableGrid({ onPick }) {
  const [at, setAt] = useState([0, 0]);
  return (
    <div className="w-[196px]" onMouseLeave={() => setAt([0, 0])}>
      <p className="px-1 pb-1 text-xs text-gray-500 whitespace-nowrap">{at[0] ? `${at[1]} × ${at[0]} table` : 'Insert table'}</p>
      <div className="grid grid-cols-10 gap-0.5">
        {Array.from({ length: 80 }, (_, i) => {
          const r = Math.floor(i / 10) + 1, c = (i % 10) + 1;
          return <button key={i} onMouseEnter={() => setAt([r, c])} onClick={() => onPick(r, c)}
            className={`h-4 w-4 rounded-sm border ${r <= at[0] && c <= at[1] ? 'border-indigo-400 bg-indigo-100' : 'border-gray-300 bg-white'}`} />;
        })}
      </div>
    </div>
  );
}

const BORDER_CHOICES = [['all', 'All borders'], ['outside', 'Outside borders'], ['inside', 'Inside borders'], ['none', 'No border'],
  ['top', 'Top border'], ['bottom', 'Bottom border'], ['left', 'Left border'], ['right', 'Right border']];
const VALIGNS = [[null, 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']];

// The right-click menu in a table (Word's table shortcut menu).
function TableMenu({ editor, at, onClose }) {
  const ref = useRef();
  useEffect(() => {
    const close = e => { if (!ref.current?.contains(e.target)) onClose(); };
    const key = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', onClose, true);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key); window.removeEventListener('scroll', onClose, true); };
  }, [onClose]);
  const chain = () => editor.chain().focus();
  const info = tableInfo(editor.state) || {};
  const item = (label, fn, disabled) => (
    <button key={label} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => { fn(); onClose(); }}
      className="flex w-full rounded px-2 py-1 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent">{label}</button>
  );
  const head = t => <p className="px-2 pt-1.5 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{t}</p>;
  // Kept inside the window.
  const style = { left: Math.min(at.x, window.innerWidth - 230), top: Math.min(at.y, window.innerHeight - 520) };
  return (
    <div ref={ref} style={style} className="fixed z-50 max-h-[520px] w-56 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
      {head('Insert')}
      {item('Row above', () => chain().addRowBefore().run())}
      {item('Row below', () => chain().addRowAfter().run())}
      {item('Column left', () => chain().addColumnBefore().run())}
      {item('Column right', () => chain().addColumnAfter().run())}
      {head('Delete')}
      {item('Delete row', () => chain().deleteRow().run())}
      {item('Delete column', () => chain().deleteColumn().run())}
      {item('Delete table', () => chain().deleteTable().run())}
      {head('Cells')}
      {item('Merge cells', () => chain().mergeCells().run(), !editor.can().mergeCells())}
      {item('Split cell', () => chain().splitCell().run(), !editor.can().splitCell())}
      <div className="flex gap-1 px-2 py-1">
        {VALIGNS.map(([v, label]) => <ChoiceBtn key={label} on={(info.valign || null) === v} onClick={() => { setCellVAlign(editor, v); onClose(); }}>{label}</ChoiceBtn>)}
      </div>
      {head('Borders')}
      {BORDER_CHOICES.slice(0, 4).map(([m, label]) => item(label, () => setBorders(editor, m)))}
      <div className="mt-1 border-t border-gray-100 pt-1">
        {item(info.repeatHeader ? '✓ Repeat header row on each page' : 'Repeat header row on each page', () => toggleRepeatHeader(editor))}
      </div>
    </div>
  );
}

// The word around a position (Word's format painter, clicked without dragging, paints that word).
function wordAt(state, pos) {
  const $p = state.doc.resolve(pos);
  const text = $p.parent.textBetween(0, $p.parent.content.size, '\uFFFC', '\uFFFC');
  const at = $p.parentOffset;
  let a = at, b = at;
  while (a > 0 && /[\p{L}\p{N}'’-]/u.test(text[a - 1])) a--;
  while (b < text.length && /[\p{L}\p{N}'’-]/u.test(text[b])) b++;
  return b > a ? { from: $p.start() + a, to: $p.start() + b } : null;
}

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

// fields: report field values (the report Insert field menu). vars: template variable keys instead
// (email/note/agreement templates). noFields: no Insert field menu (session notes).
// onPickImage / pageBreaks: leave out to hide the picture / page break buttons (email templates).
// pageSetup: the Layout menu — margins, orientation, header and footer (reports and report templates).
export default function Toolbar({ editor, fields, vars, noFields = false, onPickImage, pageBreaks = true, pageSetup = false }) {
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
      colour: e.getAttributes('textStyle').color || null, highlight: e.getAttributes('highlight').color || null,
      tbl: e.isActive('table') ? tableInfo(e.state) : null,
      pic: (n => n && { inline: n.type.name === 'inlineImage', align: n.attrs.align || 'left', valign: n.attrs.valign || 'line' })(selectedPicture(e)),
      cellColour: e.isActive('table') && wantsCellColour(e.state),
      sup: e.isActive('superscript'), sub: e.isActive('subscript'),
      para: (({ lineSpacing, spaceBefore, spaceAfter }) => ({ lineSpacing, spaceBefore, spaceAfter }))(paragraphFormat(e.state)),
      page: e.state.doc.attrs.page || null,
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
    const href = url.trim();
    if (!href || href === 'https://') return chain().extendMarkRange('link').unsetLink().run();
    // Nothing selected and not in a link: the address itself goes in as the link's text (Word).
    if (editor.state.selection.empty && !prev) return chain().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run();
    chain().extendMarkRange('link').setLink({ href }).run();
  };
  // Ctrl+K (wordFormat.js) opens the link box.
  const setLinkRef = useRef(setLink);
  setLinkRef.current = setLink;
  useEffect(() => {
    const open = () => setLinkRef.current();
    editor.on('openLink', open);
    return () => editor.off('openLink', open);
  }, [editor]);

  // Format painter: one click paints the next selection; a double-click keeps it on until clicked
  // again or Esc (Word).
  const [painter, setPainter] = useState(null);
  useEffect(() => {
    if (!painter) return undefined;
    const dom = editor.view.dom;
    dom.classList.add('format-painting');
    const onUp = () => setTimeout(() => {
      if (editor.isDestroyed) return;
      let { from, to, empty } = editor.state.selection;
      if (empty) { const w = wordAt(editor.state, from); if (!w) return; ({ from, to } = w); editor.commands.setTextSelection({ from, to }); }
      pasteFormat(editor, painter.fmt);
      if (!painter.sticky) setPainter(null);
    }, 0);
    const onKey = e => { if (e.key === 'Escape') setPainter(null); };
    dom.addEventListener('mouseup', onUp);
    document.addEventListener('keydown', onKey);
    return () => { dom.classList.remove('format-painting'); dom.removeEventListener('mouseup', onUp); document.removeEventListener('keydown', onKey); };
  }, [painter, editor]);
  const clickTimer = useRef(null);
  const onPainter = () => {
    if (painter) { setPainter(null); return; }
    // Wait a moment to tell a double-click (keep painting) from a single one.
    clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => setPainter({ fmt: copyFormat(editor), sticky: false }), 220);
  };
  const onPainterDouble = () => { clearTimeout(clickTimer.current); setPainter({ fmt: copyFormat(editor), sticky: true }); };

  // Right-click in a table: the table menu (anywhere else the browser's own menu, with spelling).
  const [tableMenu, setTableMenu] = useState(null);
  const [marginsOpen, setMarginsOpen] = useState(false);
  useEffect(() => {
    const dom = editor.view.dom;
    // Right-clicking inside cells dragged across keeps them selected (to merge them, say): the
    // browser would otherwise move the cursor on the press and lose the cell selection.
    let kept = null;
    const onDown = e => {
      kept = null;
      if (e.button !== 2 && !(e.button === 0 && e.ctrlKey)) return;
      if (!editor.isEditable || !e.target.closest?.('td, th')?.classList.contains('selectedCell')) return;
      kept = editor.state.selection;
      e.preventDefault();
      e.stopPropagation();
    };
    const onMenu = e => {
      if (!editor.isEditable || !e.target.closest?.('td, th')) return;
      e.preventDefault();
      if (kept) {
        if (!editor.state.selection.eq(kept)) editor.view.dispatch(editor.state.tr.setSelection(kept));
      } else {
        // Put the cursor in the clicked cell unless it's already in the selected cells.
        const inSel = e.target.closest('td, th')?.classList.contains('selectedCell');
        const at = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
        if (!inSel && at) editor.commands.setTextSelection(at.pos);
      }
      kept = null;
      setTableMenu({ x: e.clientX, y: e.clientY });
    };
    dom.addEventListener('mousedown', onDown, true);
    dom.addEventListener('contextmenu', onMenu);
    return () => { dom.removeEventListener('mousedown', onDown, true); dom.removeEventListener('contextmenu', onMenu); };
  }, [editor]);

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
        <Btn title="Subscript (Ctrl+=)" active={s.sub} onClick={() => chain().toggleSubscript().run()}><Subscript className="h-4 w-4" /></Btn>
        <Btn title="Superscript (Ctrl+Shift+=)" active={s.sup} onClick={() => chain().toggleSuperscript().run()}><Superscript className="h-4 w-4" /></Btn>
        <Btn title="Grow font (Ctrl+Shift+>)" onClick={() => stepFont(editor, 1)}><AArrowUp className="h-4 w-4" /></Btn>
        <Btn title="Shrink font (Ctrl+Shift+<)" onClick={() => stepFont(editor, -1)}><AArrowDown className="h-4 w-4" /></Btn>
        <Popover title="Change case (Shift+F3)" button={<CaseSensitive className="h-4 w-4" />}>
          <div className="w-48">
            {[['sentence', 'Sentence case.'], ['lower', 'lowercase'], ['upper', 'UPPERCASE'], ['title', 'Capitalise Each Word'], ['toggle', 'tOGGLE cASE']].map(([m, label]) => (
              <MenuItem key={m} onClick={() => changeCase(editor, m)}>{label}</MenuItem>
            ))}
          </div>
        </Popover>
        <Popover title="Text colour" button={<span className="flex flex-col items-center"><Baseline className="h-4 w-4" /><span className="-mt-0.5 h-1 w-4 rounded-sm" style={{ background: s.colour || '#000000' }} /></span>}>
          <ColourPalette current={s.colour} clearLabel="Automatic" onPick={c => chain().setColor(c).run()} onClear={() => chain().unsetColor().run()} />
        </Popover>
        <Popover title={s.cellColour ? 'Cell colour — fills the whole cell (select words first to highlight just them)' : 'Highlight'} button={<span className="flex flex-col items-center"><Highlighter className="h-4 w-4" /><span className="-mt-0.5 h-1 w-4 rounded-sm" style={{ background: s.highlight || '#ffff00' }} /></span>}>
          {/* In a table with no words selected (or cells dragged across), it colours the whole cell. */}
          <ColourPalette current={s.cellColour ? s.tbl?.background : s.highlight} clearLabel={s.cellColour ? 'No cell colour' : 'No highlight'}
            onPick={c => (s.cellColour ? shadeCells(editor, c) : chain().setHighlight({ color: c }).run())}
            onClear={() => (s.cellColour ? shadeCells(editor, null) : chain().unsetHighlight().run())} />
        </Popover>
        <Sep />
        <Btn title="Align left" active={s.left} onClick={() => chain().setTextAlign('left').run()}><AlignLeft className="h-4 w-4" /></Btn>
        <Btn title="Centre" active={s.center} onClick={() => chain().setTextAlign('center').run()}><AlignCenter className="h-4 w-4" /></Btn>
        <Btn title="Align right" active={s.right} onClick={() => chain().setTextAlign('right').run()}><AlignRight className="h-4 w-4" /></Btn>
        <Btn title="Justify" active={s.justify} onClick={() => chain().setTextAlign('justify').run()}><AlignJustify className="h-4 w-4" /></Btn>
        <Popover title="Line and paragraph spacing" button={<UnfoldVertical className="h-4 w-4" />}>
          <div className="w-56">
            <p className="px-2 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Line spacing</p>
            <MenuItem on={!s.para.lineSpacing} onClick={() => chain().setLineSpacing(null).run()}>Normal</MenuItem>
            {LINE_SPACINGS.map(v => <MenuItem key={v} on={s.para.lineSpacing === v} onClick={() => chain().setLineSpacing(v).run()}>{v}</MenuItem>)}
            {[['spaceBefore', 'Space before'], ['spaceAfter', 'Space after']].map(([key, label]) => (
              <div key={key} className="mt-1 border-t border-gray-100 pt-1">
                <p className="px-2 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
                <div className="flex flex-wrap gap-1 px-2 pb-1">
                  <ChoiceBtn on={s.para[key] == null} onClick={() => chain().setParagraphSpacing({ [key]: null }).run()}>Auto</ChoiceBtn>
                  {SPACINGS_PT.map(pt => <ChoiceBtn key={pt} on={s.para[key] === pt} onClick={() => chain().setParagraphSpacing({ [key]: pt }).run()}>{pt} pt</ChoiceBtn>)}
                </div>
              </div>
            ))}
          </div>
        </Popover>
        <Sep />
        <Btn title="Bulleted list" active={s.bullet} onClick={() => chain().toggleBulletList().run()}><List className="h-4 w-4" /></Btn>
        <Btn title="Numbered list" active={s.ordered} onClick={() => chain().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></Btn>
        {/* In a list: the list level (Tab / Shift+Tab); elsewhere the paragraph's left indent (Ctrl+M). */}
        <Btn title="Decrease indent" disabled={(s.bullet || s.ordered) && !s.canLift} onClick={() => (s.bullet || s.ordered ? chain().liftListItem('listItem').run() : chain().shiftIndent(-1).run())}><Outdent className="h-4 w-4" /></Btn>
        <Btn title="Increase indent" disabled={(s.bullet || s.ordered) && !s.canSink} onClick={() => (s.bullet || s.ordered ? chain().sinkListItem('listItem').run() : chain().shiftIndent(1).run())}><Indent className="h-4 w-4" /></Btn>
        <Sep />
        <Btn title={s.link ? 'Edit link' : 'Insert link'} active={s.link} onClick={setLink}><Link2 className="h-4 w-4" /></Btn>
        {s.link && <Btn title="Remove link" onClick={() => chain().extendMarkRange('link').unsetLink().run()}><Unlink className="h-4 w-4" /></Btn>}
        <Popover title="Insert a symbol" button={<span className="text-[15px] leading-none">Ω</span>}>
          <div className="grid w-72 grid-cols-10 gap-0.5">
            {[...SYMBOLS].map(c => (
              <button key={c} className="h-7 rounded text-base hover:bg-indigo-50" onClick={() => chain().insertContent(c).run()}>{c}</button>
            ))}
          </div>
        </Popover>
        <Popover title="Insert table" button={<Table className="h-4 w-4" />}>
          <TableGrid onPick={(rows, cols) => chain().insertTable({ rows, cols, withHeaderRow: false }).run()} />
        </Popover>
        {onPickImage && <Btn title="Insert picture" onClick={onPickImage}><Image className="h-4 w-4" /></Btn>}
        {pageBreaks && <Btn title="Start a new page here (Ctrl+Enter)" onClick={() => chain().setPageBreak().run()}><SeparatorHorizontal className="h-4 w-4" /><span className="ml-1 text-sm">Page break</span></Btn>}
        {pageSetup && (
          <Popover title="Layout: margins, orientation, header and footer" button={<><LayoutTemplate className="h-4 w-4" /><span className="ml-1 text-sm">Layout</span></>}>
            <div className="w-64">
              <p className="px-2 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Orientation</p>
              <MenuItem on={s.page?.orientation !== 'landscape'} onClick={() => chain().setPageSetup({ orientation: 'portrait' }).run()}>Portrait</MenuItem>
              <MenuItem on={s.page?.orientation === 'landscape'} onClick={() => chain().setPageSetup({ orientation: 'landscape' }).run()}>Landscape</MenuItem>
              <p className="mt-1 border-t border-gray-100 px-2 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Margins</p>
              {MARGIN_PRESETS.map(p => (
                <MenuItem key={p.key} on={marginPreset(s.page) === p.key} onClick={() => chain().setPageSetup(p.m).run()}>
                  <span>{p.label}<span className="block text-xs text-gray-500">{p.hint}</span></span>
                </MenuItem>
              ))}
              <MenuItem on={marginPreset(s.page) === 'custom'} onClick={() => setMarginsOpen(true)}>Custom margins…</MenuItem>
              <div className="mt-1 border-t border-gray-100 pt-1">
                <MenuItem onClick={() => editor.emit('openHeaderFooter', 'header')}>Header &amp; footer…</MenuItem>
              </div>
            </div>
          </Popover>
        )}
        {vars?.length > 0 && (
          <Popover title="Insert a field that fills in automatically" button={<><UserSquare className="h-4 w-4" /><span className="ml-1 text-sm">Insert field</span></>}>
            <div className="w-64 max-h-80 overflow-y-auto">
              {vars.map(v => (
                <button key={v} className="flex w-full rounded px-2 py-1.5 text-left text-sm hover:bg-gray-100" onClick={() => chain().insertTemplateVar(v).run()}>
                  {humaniseVar(v)}
                </button>
              ))}
            </div>
          </Popover>
        )}
        {!vars && !noFields && <Popover title="Insert a field that fills in automatically" button={<><UserSquare className="h-4 w-4" /><span className="ml-1 text-sm">Insert field</span></>}>
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
        </Popover>}
        <Sep />
        <span onDoubleClick={onPainterDouble}>
          <Btn title="Format painter — click, then select the text to paint; double-click to paint several places (Esc to stop)" active={!!painter} onClick={onPainter}><Paintbrush className="h-4 w-4" /></Btn>
        </span>
        <Btn title="Clear formatting (Ctrl+Space)" onClick={() => chain().unsetAllMarks().clearNodes().setLineSpacing(null).setParagraphSpacing({ spaceBefore: null, spaceAfter: null }).run()}><RemoveFormatting className="h-4 w-4" /></Btn>
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

      {s.pic && (
        <div className="flex flex-wrap items-center gap-1 border-t border-gray-100 bg-gray-50 px-3 py-1 text-xs">
          <span className="mr-1 font-medium text-gray-500">Picture:</span>
          {[[false, 'On its own line'], [true, 'In line with text']].map(([inline, label]) => (
            <ChoiceBtn key={label} on={s.pic.inline === inline} onClick={() => setPictureInline(editor, inline)}>{label}</ChoiceBtn>
          ))}
          <span className="mx-1 h-4 w-px bg-gray-200" />
          {s.pic.inline ? <>
            {[[null, 'line', 'On the line'], ['middle', 'middle', 'Centred on the text']].map(([v, key, label]) => (
              <ChoiceBtn key={key} on={s.pic.valign === key} onClick={() => chain().updateAttributes('inlineImage', { valign: v }).run()}>{label}</ChoiceBtn>
            ))}
            <span className="ml-2 text-gray-400">Type before or after it like a word, or drag it next to a word. The alignment buttons move the whole line.</span>
          </> : <>
            {[['left', 'Left'], ['center', 'Centre'], ['right', 'Right']].map(([v, label]) => (
              <ChoiceBtn key={v} on={s.pic.align === v} onClick={() => chain().updateAttributes('image', { align: v === 'left' ? null : v }).run()}>{label}</ChoiceBtn>
            ))}
            <span className="ml-2 text-gray-400">Drag a picture to move it.</span>
          </>}
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
          <span className="mx-1 h-4 w-px bg-gray-200" />
          <Popover title="Cell shading — colours the selected cells (drag across cells to select several)" button={<span className="flex flex-col items-center"><PaintBucket className="h-3.5 w-3.5" /><span className="-mt-0.5 h-1 w-4 rounded-sm border border-gray-300" style={{ background: s.tbl?.background || 'transparent' }} /></span>}>
            <ColourPalette current={s.tbl?.background} clearLabel="No shading" onPick={c => shadeCells(editor, c)} onClear={() => shadeCells(editor, null)} />
          </Popover>
          <span className="text-gray-500">Align:</span>
          {VALIGNS.map(([v, label]) => <ChoiceBtn key={label} on={(s.tbl?.valign || null) === v} onClick={() => setCellVAlign(editor, v)}>{label}</ChoiceBtn>)}
          <Popover title="Borders" button={<span className="text-xs">Borders</span>}>
            <div className="w-44">
              {BORDER_CHOICES.map(([m, label]) => <MenuItem key={m} onClick={() => setBorders(editor, m)}>{label}</MenuItem>)}
            </div>
          </Popover>
          <ChoiceBtn on={!!s.tbl?.repeatHeader} onClick={() => toggleRepeatHeader(editor)}>Repeat header row</ChoiceBtn>
          <CmInput label="Row height" valuePx={s.tbl?.rowHeight} onApply={px => setRowHeight(editor, px)} />
          <CmInput label="Column width" valuePx={s.tbl?.colWidth} onApply={px => px && setColumnWidth(editor, px)} />
          <button onMouseDown={e => e.preventDefault()} onClick={() => { const g = pageGeometry(s.page); evenColumns(editor, g.width - g.left - g.right); }} title="Make all columns the same width, across the page"
            className="rounded border border-gray-200 bg-white px-2 py-0.5 text-gray-700 hover:bg-gray-100">Even columns</button>
          <button onMouseDown={e => e.preventDefault()} onClick={() => chain().deleteTable().run()}
            className="ml-auto inline-flex items-center gap-1 rounded px-2 py-0.5 text-red-600 hover:bg-red-50"><Trash2 className="h-3 w-3" /> Delete table</button>
        </div>
      )}
      {tableMenu && <TableMenu editor={editor} at={tableMenu} onClose={() => setTableMenu(null)} />}
      {marginsOpen && <MarginsDialog editor={editor} page={s.page} onClose={() => setMarginsOpen(false)} />}
    </div>
  );
}

// Which margin preset the page uses ('custom' when none of them).
function marginPreset(page) {
  if (!page) return 'standard';
  const p = MARGIN_PRESETS.find(x => ['top', 'bottom', 'left', 'right'].every(k => Math.abs(Number(page[k]) - x.m[k]) < 0.005));
  return p ? p.key : 'custom';
}

// Layout › Margins › Custom margins (Word's Page Setup), in centimetres.
function MarginsDialog({ editor, page, onClose }) {
  const cur = page || { ...MARGIN_PRESETS[0].m };
  const [m, setM] = useState(Object.fromEntries(['top', 'bottom', 'left', 'right'].map(k => [k, String(cur[k])])));
  const g = pageGeometry({ orientation: page?.orientation, top: 1, bottom: 1, left: 1, right: 1 });
  const nums = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Number(String(v).replace(',', '.'))]));
  const bad = Object.values(nums).some(v => !Number.isFinite(v) || v < 0.5 || v > 8)
    || (nums.left + nums.right) * (96 / 2.54) > g.width - 150 || (nums.top + nums.bottom) * (96 / 2.54) > g.height - 150;
  const save = () => { editor.chain().focus().setPageSetup(Object.fromEntries(Object.entries(nums).map(([k, v]) => [k, Math.round(v * 100) / 100]))).run(); onClose(); };
  return (
    <Modal title="Custom margins" onClose={onClose} size="sm">
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-3">
          {[['top', 'Top'], ['bottom', 'Bottom'], ['left', 'Left'], ['right', 'Right']].map(([k, label]) => (
            <label key={k} className="space-y-1">
              <span className="block text-xs font-medium text-gray-600">{label} (cm)</span>
              <input type="number" step="0.1" min="0.5" max="8" value={m[k]} onChange={e => setM(v => ({ ...v, [k]: e.target.value }))}
                className="block w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
          ))}
        </div>
        <p className={`text-xs ${bad ? 'text-red-600' : 'text-gray-500'}`}>Each margin between 0.5 and 8 cm, leaving room for the text. The PDF uses the same margins.</p>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={bad}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}
