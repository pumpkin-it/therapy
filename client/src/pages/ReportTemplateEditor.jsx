import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { EditorContent } from '@tiptap/react';
import { ArrowLeft, Check, Loader2 } from 'lucide-react';
import api from '../lib/api';
import Button from '../components/ui/Button';
import Toolbar from '../components/reportEditor/Toolbar';
import PageGuides, { PAGE } from '../components/reportEditor/PageGuides';
import ScaledSheet from '../components/reportEditor/ScaledSheet';
import useDocEditor from '../components/reportEditor/useDocEditor';
import { useConfirm } from '../components/ui/ConfirmDialog';

// Editing a report template (owner/admin). Same editor and page layout as writing a report, but
// fields show their names (there's no client yet) and changes are saved with the Save button —
// templates are edited occasionally and deliberately, unlike a report being written for hours.

export default function ReportTemplateEditor() {
  const confirm = useConfirm();
  const { id } = useParams();
  const navigate = useNavigate();
  const [tpl, setTpl] = useState(null);
  const [name, setName] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pages, setPages] = useState(1);
  const sheetRef = useRef(null);
  const [scale, setScale] = useState(1);
  const fileInputRef = useRef();
  const loadedRef = useRef(false);
  const savedJsonRef = useRef(null);

  const onUpdate = useCallback(ed => {
    if (!loadedRef.current) return;
    setDirty(JSON.stringify(ed.getJSON()) !== savedJsonRef.current);
  }, []);

  const { editor, uploadImages } = useDocEditor({
    uploadUrl: `/report-doc-templates/${id}/images`,
    showLabels: true,
    onUpdate,
    onNotice: setNotice,
    placeholder: 'Lay out the template — use Insert field for details that fill in for each client…',
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    let cancelled = false;
    api.get(`/report-doc-templates/${id}`).then(({ data }) => {
      if (cancelled || editor.isDestroyed) return;
      editor.commands.setContent(data.content, { emitUpdate: false });
      savedJsonRef.current = JSON.stringify(editor.getJSON());
      loadedRef.current = true;
      editor.setEditable(data.can_edit);
      setTpl(data);
      setName(data.name);
    }).catch(e => { if (!cancelled) setError(e.response?.data?.error || 'Could not open this template.'); });
    return () => { cancelled = true; };
  }, [editor, id]);

  const nameDirty = tpl && name.trim() !== tpl.name;
  const unsaved = dirty || nameDirty;

  const save = useCallback(async () => {
    if (!editor || saving) return;
    if (!name.trim()) { setError('Enter a template name'); return; }
    setSaving(true); setError('');
    try {
      const content = editor.getJSON();
      await api.put(`/report-doc-templates/${id}`, { name: name.trim(), content });
      savedJsonRef.current = JSON.stringify(content);
      setTpl(t => ({ ...t, name: name.trim() }));
      setDirty(false);
      setSavedAt(new Date());
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to save the template');
    } finally { setSaving(false); }
  }, [editor, id, name, saving]);

  // Ctrl/Cmd+S saves, as in Word.
  useEffect(() => {
    const onKey = e => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  useEffect(() => {
    const beforeUnload = e => { if (unsaved) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [unsaved]);

  const leave = async () => {
    if (unsaved && !await confirm({ title: 'Unsaved changes', message: 'This template has unsaved changes. Leave without saving?', confirmLabel: 'Leave without saving', danger: true })) return;
    navigate('/templates', { state: { tab: 'reports' } });
  };

  if (error && !tpl) return <div className="p-8 text-sm text-red-600">{error}</div>;

  return (
    <div className="-m-6 min-h-screen bg-gray-100">
      <div className="sticky -top-6 z-20 shadow-sm">
        <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-2.5">
          <button onClick={leave} className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800" title="Back to templates"><ArrowLeft className="h-5 w-5" /></button>
          <div className="min-w-0 flex-1">
            <input value={name} onChange={e => setName(e.target.value)} disabled={!tpl?.can_edit}
              className="w-full max-w-md rounded border border-transparent px-1 py-0.5 font-semibold text-gray-900 hover:border-gray-200 focus:border-indigo-400 focus:outline-none" />
            <p className="px-1 text-xs text-gray-500">Report template{tpl && !tpl.can_edit ? ' · read-only' : ''}</p>
          </div>
          <span className="text-sm">
            {saving ? <span className="inline-flex items-center gap-1 text-gray-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</span>
              : unsaved ? <span className="text-amber-700">Unsaved changes</span>
              : savedAt ? <span className="inline-flex items-center gap-1 text-green-700"><Check className="h-3.5 w-3.5" /> Saved</span> : null}
          </span>
          {tpl?.can_edit && <Button size="sm" onClick={save} disabled={saving || !unsaved}>Save</Button>}
        </div>
        {editor && tpl?.can_edit && <Toolbar editor={editor} onPickImage={() => fileInputRef.current.click()} />}
      </div>
      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple className="hidden"
        onChange={e => { const files = [...e.target.files]; e.target.value = ''; uploadImages(files); }} />

      <div className="mx-auto space-y-2 px-4 pt-4" style={{ maxWidth: PAGE.width + 32 }}>
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">{error}</div>}
        {notice && (
          <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-900">
            <span className="flex-1">{notice}</span>
            <button className="text-blue-700 hover:text-blue-900" onClick={() => setNotice('')}>Dismiss</button>
          </div>
        )}
        <p className="text-xs text-gray-500">Green labels are fields — they fill in with each client’s details when a report is started from this template. Changes here don’t affect reports that were already started.</p>
      </div>

      <div className="px-4 py-6">
        <ScaledSheet sheetRef={sheetRef} onScale={setScale}>
          <PageGuides editor={editor} sheetRef={sheetRef} onPageCount={setPages} />
          <div className="relative"><EditorContent editor={editor} /></div>
        </ScaledSheet>
        <p className="mx-auto mt-3 text-right text-xs text-gray-500" style={{ maxWidth: PAGE.width }}>
          {pages} page{pages === 1 ? '' : 's'}{scale < 0.99 ? ` · shown at ${Math.round(scale * 100)}%` : ''}
        </p>
      </div>
    </div>
  );
}
