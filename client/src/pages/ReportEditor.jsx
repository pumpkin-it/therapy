import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { EditorContent } from '@tiptap/react';
import { ArrowLeft, History, AlertTriangle, Check, CloudOff, Loader2, Lock, Unlock, FileCheck2, Download, GitCompare } from 'lucide-react';
import api from '../lib/api';
import { downloadFile } from '../lib/utils';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import Toolbar from '../components/reportEditor/Toolbar';
import PageGuides, { PAGE } from '../components/reportEditor/PageGuides';
import ScaledSheet from '../components/reportEditor/ScaledSheet';
import useDocEditor from '../components/reportEditor/useDocEditor';
import CompareView from '../components/reportEditor/CompareView';
import { useConfirm } from '../components/ui/ConfirmDialog';

// Writing a report in the system (prototype). The whole document autosaves to the server a few
// seconds after typing stops (and at least every 30s while typing), with a copy kept in this
// browser too — so a crash, closed tab or dropped connection loses nothing. Each save names the
// revision it started from; the server refuses a save if the report was changed elsewhere since.

const IDLE_SAVE_MS = 3000;
const MAX_UNSAVED_MS = 30000;
const RETRY_MS = 10000;
// Each window keeps its own browser copy (keyed by a per-tab id that survives reloads), so a save
// in one window can never delete text stranded in another. On load, every copy for the report is
// considered and the newest one that differs from the server is offered back.
const tabId = (() => {
  try {
    let t = sessionStorage.getItem('report-editor-tab');
    if (!t) { t = Math.random().toString(36).slice(2, 10); sessionStorage.setItem('report-editor-tab', t); }
    return t;
  } catch { return 'tab'; }
})();
const keyPrefix = id => `report-draft-backup-${id}-`;
const localKey = id => keyPrefix(id) + tabId;
const fmtTime = iso => new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
const fmtDateTime = iso => new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

function readAllLocal(id) {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(keyPrefix(id))) { try { out.push({ key: k, ...JSON.parse(localStorage.getItem(k)) }); } catch {} }
    }
  } catch {}
  return out;
}
function writeLocal(id, v) { try { localStorage.setItem(localKey(id), JSON.stringify(v)); } catch {} }
function removeKey(k) { try { localStorage.removeItem(k); } catch {} }
function clearLocal(id) { removeKey(localKey(id)); }
// An empty document (no text, tables, images or fields) — nothing worth offering back.
const isEmptyDoc = doc => !doc || !JSON.stringify(doc.content || []).match(/"type":"(text|image|table|clientField)"/);

export default function ReportEditor() {
  const confirm = useConfirm();
  const { id: clientId, reportId } = useParams();
  const navigate = useNavigate();
  const [meta, setMeta] = useState(null); // report info, fields, can_edit
  const [loadError, setLoadError] = useState('');
  const [status, setStatus] = useState({ kind: 'idle' }); // idle | dirty | saving | saved | error | conflict
  const [recovery, setRecovery] = useState(null); // an unsaved browser copy newer than the server's
  const [notice, setNotice] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [words, setWords] = useState(0);
  const [pages, setPages] = useState(1);
  const [loadKey, setLoadKey] = useState(0); // bumped to reload after unlocking
  const [commitOpen, setCommitOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const sheetRef = useRef(null);
  const [scale, setScale] = useState(1);

  const revisionRef = useRef(0);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const blockedRef = useRef(false); // conflict or read-only — stop autosaving
  const lastChangeRef = useRef(0);
  const lastSavedRef = useRef(Date.now());
  const changeCounterRef = useRef(0);
  const loadedRef = useRef(false); // ignore the editor's own start-up/normalising transactions
  const lastSavedJsonRef = useRef(null);
  const fieldsRef = useRef({});
  const recoveryPendingRef = useRef(false);
  const retryAtRef = useRef(0); // after a failed save, wait before trying again // an offered browser copy must not be overwritten
  const backupTimerRef = useRef(null);
  const fileInputRef = useRef();

  const onUpdate = useCallback(ed => {
    if (!loadedRef.current || !ed.isEditable) return;
    dirtyRef.current = true;
    changeCounterRef.current++;
    lastChangeRef.current = Date.now();
    setWords(ed.storage.characterCount.words());
    // Checked shortly after typing pauses rather than on every keystroke: the editor also makes
    // small automatic adjustments (e.g. just after loading) that don't change the document —
    // those mustn't show "unsaved changes" or overwrite the browser copy.
    clearTimeout(backupTimerRef.current);
    backupTimerRef.current = setTimeout(() => {
      const json = ed.getJSON();
      if (JSON.stringify(json) === lastSavedJsonRef.current) {
        dirtyRef.current = false;
        return;
      }
      setStatus(st => (st.kind === 'conflict' || st.kind === 'saving' ? st : { kind: 'dirty' }));
      if (!recoveryPendingRef.current) writeLocal(reportId, { content: json, base_revision: revisionRef.current, at: new Date().toISOString() });
    }, 500);
  }, [reportId]);

  const { editor, uploadImages } = useDocEditor({
    uploadUrl: `/billable-reports/${reportId}/images`,
    getFields: () => fieldsRef.current,
    onUpdate,
    onNotice: setNotice,
  });
  const editorRef = useRef(null);
  editorRef.current = editor;

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    let cancelled = false;
    api.get(`/billable-reports/${reportId}/draft`).then(({ data }) => {
      if (cancelled || editor.isDestroyed) return;
      fieldsRef.current = data.fields;
      revisionRef.current = data.revision;
      editor.commands.setContent(data.content || '', { emitUpdate: false });
      lastSavedJsonRef.current = JSON.stringify(editor.getJSON());
      loadedRef.current = true;
      editor.setEditable(data.can_edit);
      blockedRef.current = !data.can_edit;
      setWords(editor.storage.characterCount.words());
      setMeta(data);
      setStatus(data.updated_at ? { kind: 'saved', at: data.updated_at } : { kind: 'idle' });
      // Copies in this browser that never reached the server (crash, closed tab, lost connection,
      // or a window that stopped saving because another one saved first). Offer the newest one
      // that differs from the server; tidy away any that match it or are empty.
      if (data.can_edit) {
        const serverStr = JSON.stringify(data.content);
        const candidates = [];
        for (const c of readAllLocal(reportId)) {
          if (isEmptyDoc(c.content) || JSON.stringify(c.content) === serverStr) removeKey(c.key);
          else candidates.push(c);
        }
        candidates.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
        if (candidates[0]) { recoveryPendingRef.current = true; setRecovery(candidates[0]); }
      }
      if (data.can_edit) editor.commands.focus('start');
    }).catch(e => { if (!cancelled) setLoadError(e.response?.data?.error || 'Could not open this report.'); });
    return () => { cancelled = true; };
  }, [editor, reportId, loadKey]);

  // ── Save ──────────────────────────────────────────────────────────────────
  const save = useCallback(async ({ force = false, forceSnapshot = false } = {}) => {
    const ed = editorRef.current;
    if (!ed || savingRef.current || blockedRef.current) return false;
    if (!dirtyRef.current && !force) return true;
    const json = ed.getJSON();
    const jsonStr = JSON.stringify(json);
    // Nothing actually different from the last save (e.g. undo back to it) — no request needed.
    if (jsonStr === lastSavedJsonRef.current && !forceSnapshot) {
      dirtyRef.current = false;
      if (!recoveryPendingRef.current) clearLocal(reportId);
      setStatus(st => (st.kind === 'dirty' ? { kind: 'saved', at: st.at || new Date().toISOString() } : st));
      return true;
    }
    savingRef.current = true;
    const counterAtSend = changeCounterRef.current;
    setStatus({ kind: 'saving' });
    try {
      const { data } = await api.put(`/billable-reports/${reportId}/draft`, {
        content: json, base_revision: revisionRef.current,
        word_count: ed.storage.characterCount.words(), force_snapshot: forceSnapshot,
      });
      revisionRef.current = data.revision;
      lastSavedRef.current = Date.now();
      retryAtRef.current = 0;
      lastSavedJsonRef.current = jsonStr;
      if (changeCounterRef.current === counterAtSend) {
        dirtyRef.current = false;
        if (!recoveryPendingRef.current) clearLocal(reportId);
        setStatus({ kind: 'saved', at: data.updated_at });
      } else {
        // Typing continued while this save was in flight — keep the browser copy current.
        if (!recoveryPendingRef.current) writeLocal(reportId, { content: ed.getJSON(), base_revision: data.revision, at: new Date().toISOString() });
        setStatus({ kind: 'dirty' });
      }
      return true;
    } catch (e) {
      if (e.response?.status === 409) {
        blockedRef.current = true;
        setStatus({ kind: 'conflict', ...e.response.data });
      } else {
        retryAtRef.current = Date.now() + RETRY_MS;
        setStatus({ kind: 'error', message: e.response?.data?.error || (navigator.onLine ? 'Couldn’t reach the server' : 'You’re offline') });
      }
      return false;
    } finally {
      savingRef.current = false;
    }
  }, [reportId]);

  // Save a few seconds after typing stops, and at least every 30s during continuous typing.
  // Failed saves are simply retried on the next tick; the browser copy covers the gap.
  useEffect(() => {
    const t = setInterval(() => {
      if (!dirtyRef.current || savingRef.current || blockedRef.current) return;
      const now = Date.now();
      if (now < retryAtRef.current) return;
      if (now - lastChangeRef.current >= IDLE_SAVE_MS || now - lastSavedRef.current >= MAX_UNSAVED_MS) save();
    }, 1000);
    return () => clearInterval(t);
  }, [save]);

  // Leaving the page: warn if something hasn't reached the server yet, and try one last save.
  useEffect(() => {
    const beforeUnload = e => { if (dirtyRef.current && !blockedRef.current) { e.preventDefault(); e.returnValue = ''; } };
    const hidden = () => { if (document.visibilityState === 'hidden') save(); };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('visibilitychange', hidden); };
  }, [save]);

  const leave = async () => {
    if (dirtyRef.current && !blockedRef.current) {
      const okSaved = await save();
      if (!okSaved && !await confirm({ title: 'Changes not saved yet', message: 'Your latest changes haven’t reached the server yet. They’re kept in this browser and will be offered back next time you open the report. Leave anyway?', confirmLabel: 'Leave anyway', danger: true })) return;
    }
    navigate(`/clients/${clientId}?tab=reports`);
  };

  // Commit: save whatever's on screen, then ask the server to freeze exactly that revision.
  const commit = async visiblePages => {
    const saved = await save({ force: true });
    if (!saved || status.kind === 'conflict') throw new Error('The latest changes haven’t been saved, so nothing was committed. Check the message at the top of the page.');
    const { data } = await api.post(`/billable-reports/${reportId}/commit`, { base_revision: revisionRef.current, visible_pages: visiblePages });
    for (const c of readAllLocal(reportId)) removeKey(c.key);
    dirtyRef.current = false;
    // Straight to the report card with the draft email open — the client's link (the same one for
    // every version) now shows this version.
    navigate(`/clients/${clientId}?tab=reports&notify=${reportId}&committed=${data.version}`);
  };

  const unlock = async reason => {
    await api.post(`/billable-reports/${reportId}/unlock`, { reason });
    setUnlockOpen(false);
    setNotice('Unlocked. Your changes will be saved as you type; commit again when you’re done to make the new version.');
    setLoadKey(k => k + 1);
  };

  const restoreLocal = () => {
    recoveryPendingRef.current = false;
    removeKey(recovery.key);
    editor.commands.setContent(recovery.content, { emitUpdate: true });
    setRecovery(null);
    setNotice('Restored the unsaved copy from this browser — it’s being saved now.');
  };
  const discardLocal = () => { recoveryPendingRef.current = false; removeKey(recovery.key); setRecovery(null); };

  if (loadError) return <div className="p-8 text-sm text-red-600">{loadError}</div>;

  const statusEl = {
    idle: <span className="text-gray-400">Not saved yet</span>,
    dirty: <span className="text-gray-500">Unsaved changes…</span>,
    saving: <span className="inline-flex items-center gap-1 text-gray-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</span>,
    saved: <span className="inline-flex items-center gap-1 text-green-700"><Check className="h-3.5 w-3.5" /> Saved {status.at && fmtTime(status.at)}</span>,
    error: <span className="inline-flex items-center gap-1 text-amber-700" title="Your text is kept in this browser and will be saved when the connection is back."><CloudOff className="h-3.5 w-3.5" /> Not saved — {status.message}. Retrying…</span>,
    conflict: <span className="inline-flex items-center gap-1 text-red-600"><AlertTriangle className="h-3.5 w-3.5" /> Stopped saving</span>,
  }[status.kind];

  return (
    <div className="-m-6 min-h-screen bg-gray-100">
      {/* Header + toolbar, pinned so the save status is always in view */}
      <div className="sticky -top-6 z-20 shadow-sm">{/* -top-6 cancels the layout's p-6, which sticky positioning otherwise leaves as a gap */}
      <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-2.5">
        <button onClick={leave} className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800" title="Back to the client"><ArrowLeft className="h-5 w-5" /></button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-gray-900">{meta?.report.title || 'Report'}</p>
          <p className="truncate text-xs text-gray-500">{meta?.report.client_name}{meta && !meta.can_edit && ' · read-only'}</p>
        </div>
        <div className="text-sm">{meta?.locked ? <span className="inline-flex items-center gap-1 text-gray-600"><Lock className="h-3.5 w-3.5" /> Locked</span> : statusEl}</div>
        <Button size="sm" variant="secondary" onClick={() => setHistoryOpen(true)} disabled={!meta}><History className="h-3.5 w-3.5" /> History</Button>
        {meta?.can_commit && (
          <Button size="sm" onClick={() => setCommitOpen(true)} disabled={status.kind === 'conflict' || status.kind === 'saving'}>
            <FileCheck2 className="h-3.5 w-3.5" /> Commit
          </Button>
        )}
      </div>

      {editor && meta?.can_edit && <Toolbar editor={editor} fields={meta.fields} onPickImage={() => fileInputRef.current.click()} />}
      </div>
      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple className="hidden"
        onChange={e => { const files = [...e.target.files]; e.target.value = ''; uploadImages(files); }} />

      {/* Banners */}
      <div className="mx-auto max-w-[850px] space-y-2 px-4 pt-4">
        {meta?.locked && meta.versions?.[0] && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
            <Lock className="h-4 w-4 shrink-0" />
            <span className="flex-1">
              Version {meta.versions[0].version} was committed {fmtDateTime(meta.versions[0].committed_at)}{meta.versions[0].committed_by_name ? ` by ${meta.versions[0].committed_by_name}` : ''} and is locked.
              Its PDF ({meta.versions[0].page_count} page{meta.versions[0].page_count === 1 ? '' : 's'}) is in the client’s Files.
            </span>
            {meta.can_unlock && <Button size="sm" variant="secondary" onClick={() => setUnlockOpen(true)}><Unlock className="h-3.5 w-3.5" /> Unlock to revise</Button>}
          </div>
        )}
        {status.kind === 'conflict' && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            This report was saved from another window or device{status.updated_by_name ? ` by ${status.updated_by_name}` : ''}{status.updated_at ? ` at ${fmtTime(status.updated_at)}` : ''}, so saving has stopped here to avoid overwriting it.
            Your text from this window is kept in this browser. <button className="font-medium underline" onClick={() => window.location.reload()}>Reload</button> to open the latest version — you’ll be offered this window’s text back.
          </div>
        )}
        {recovery && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <span className="flex-1">This browser has changes from {fmtDateTime(recovery.at)} that never reached the server (for example the window closed or the connection dropped).</span>
            <Button size="sm" onClick={restoreLocal}>Restore them</Button>
            <Button size="sm" variant="ghost" onClick={discardLocal}>Discard</Button>
          </div>
        )}
        {notice && (
          <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-900">
            <span className="flex-1">{notice}</span>
            <button className="text-blue-700 hover:text-blue-900" onClick={() => setNotice('')}>Dismiss</button>
          </div>
        )}
      </div>

      {/* The page */}
      <div className="px-4 py-6">
        {/* Laid out with the PDF's page size and margins so the page guides match the PDF; shown
            scaled down when the window is narrower than a page. */}
        <ScaledSheet sheetRef={sheetRef} onScale={setScale}>
          <PageGuides editor={editor} sheetRef={sheetRef} onPageCount={setPages} />
          <div className="relative">
            <EditorContent editor={editor} />
          </div>
        </ScaledSheet>
        <p className="mx-auto mt-3 text-right text-xs text-gray-500" style={{ maxWidth: PAGE.width }}>
          {words.toLocaleString()} words · {pages} page{pages === 1 ? '' : 's'}{scale < 0.99 ? ` · shown at ${Math.round(scale * 100)}%` : ''}
        </p>
      </div>

      {commitOpen && (
        <CommitModal nextVersion={(meta?.versions?.[0]?.version || 0) + 1} pages={pages} revising={!!meta?.versions?.length} defaultShown={meta?.visible_pages ?? 1}
          onClose={() => setCommitOpen(false)} onCommit={commit} />
      )}
      {unlockOpen && <UnlockModal version={meta?.versions?.[0]?.version} onClose={() => setUnlockOpen(false)} onUnlock={unlock} />}
      {historyOpen && (
        <HistoryModal reportId={reportId} versions={meta?.versions || []}
          draft={meta && !meta.locked && meta.versions?.length ? () => ({ content: editor.getJSON(), fields: fieldsRef.current }) : null}
          canRestore={!!meta?.can_edit && status.kind !== 'conflict'} onClose={() => setHistoryOpen(false)}
          onRestore={async snap => {
            // Keep what's on screen now in the history first, so the restore itself can be undone.
            await save({ force: true, forceSnapshot: true });
            editor.commands.setContent(snap.content, { emitUpdate: true });
            setHistoryOpen(false);
            setNotice(`Restored the version from ${fmtDateTime(snap.saved_at)}. The text it replaced is in History if you need it back.`);
          }} />
      )}
    </div>
  );
}

function CommitModal({ nextVersion, pages, revising, defaultShown, onClose, onCommit }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Same rule as sharing any report: at most half the pages (rounded down), never more than 10.
  // `pages` is the editor's estimate; the server re-checks against the real PDF.
  const maxShown = Math.min(10, Math.floor(pages / 2));
  const [shown, setShown] = useState(Math.min(defaultShown, maxShown));
  const go = async () => {
    setBusy(true); setError('');
    try { await onCommit(shown); } catch (e) { setError(e.response?.data?.error || e.message || 'Commit failed'); setBusy(false); }
  };
  return (
    <Modal title={`Commit version ${nextVersion}`} onClose={() => !busy && onClose()}>
      <div className="space-y-3 text-sm text-gray-700">
        <p>Committing will:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>make the PDF (about {pages} page{pages === 1 ? '' : 's'}) with a footer of client name, report title and page numbers;</li>
          <li>freeze the client details shown in the report as they are now;</li>
          <li>{revising ? 'show this version at the client’s existing link, as a blurred draft — links already sent keep working, and it releases again once all invoices for the report are paid;' : 'share it with the client as a blurred draft — it’s released once all invoices for the report are paid;'}</li>
          <li>lock the report. You or an admin can unlock it later to make changes (with a reason).</li>
        </ul>
        <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
          <label className="text-gray-700">Pages the client sees in full in the draft</label>
          <input type="number" min={0} max={maxShown} value={shown}
            onChange={e => setShown(Math.max(0, Math.min(maxShown, parseInt(e.target.value, 10) || 0)))}
            className="w-16 rounded border border-gray-300 px-2 py-1" />
          <span className="text-xs text-gray-500">of about {pages} — up to {maxShown} (half)</span>
        </div>
        <p>{revising ? 'Next you can let the client know there’s a revised version (optional — their link already shows it).' : 'Next you’ll be asked to email the draft link to the client.'}</p>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={go} disabled={busy}>{busy ? 'Making the PDF…' : `Commit version ${nextVersion}`}</Button>
        </div>
      </div>
    </Modal>
  );
}

function UnlockModal({ version, onClose, onUnlock }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    if (!reason.trim()) { setError('Enter why the report is being unlocked'); return; }
    setBusy(true); setError('');
    try { await onUnlock(reason.trim()); } catch (e) { setError(e.response?.data?.error || 'Unlock failed'); setBusy(false); }
  };
  return (
    <Modal title={`Unlock version ${version} to revise`} onClose={() => !busy && onClose()}>
      <div className="space-y-3 text-sm">
        <p className="text-gray-600">Version {version} and its PDF are kept as they are. Your changes become version {(version || 0) + 1} when you commit again.</p>
        <label className="block font-medium text-gray-700">Reason for the revision</label>
        <textarea rows={3} autoFocus value={reason} onChange={e => { setReason(e.target.value); setError(''); }}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:outline-none" placeholder="Correct the date of birth on page 1" />
        {error && <p className="text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={go} disabled={busy}>{busy ? 'Unlocking…' : 'Unlock'}</Button>
        </div>
      </div>
    </Modal>
  );
}

function HistoryModal({ reportId, versions, draft, canRestore, onClose, onRestore }) {
  const confirm = useConfirm();
  const [snaps, setSnaps] = useState(null);
  const [compare, setCompare] = useState(null); // { from, to, draft? }
  const [from, setFrom] = useState(versions[1]?.version ?? versions[0]?.version);
  const [to, setTo] = useState(draft ? 'draft' : versions[0]?.version);
  const canCompare = versions.length > 1 || (versions.length === 1 && draft);
  const openCompare = (f, t) => setCompare({ from: f, to: t, draft: t === 'draft' ? draft() : null });
  const [busy, setBusy] = useState(null);
  useEffect(() => { api.get(`/billable-reports/${reportId}/draft/snapshots`).then(r => setSnaps(r.data)).catch(() => setSnaps([])); }, [reportId]);
  const restore = async s => {
    if (!await confirm({ title: 'Restore earlier version', message: `Replace the report with the version from ${fmtDateTime(s.saved_at)}?`, confirmLabel: 'Restore' })) return;
    setBusy(s.id);
    const { data } = await api.get(`/billable-reports/${reportId}/draft/snapshots/${s.id}`);
    await onRestore(data);
  };
  return (
    <Modal title="History" onClose={onClose}>
      {versions.length > 0 && (
        <div className="mb-5">
          <p className="mb-1 text-sm font-medium text-gray-700">Committed versions</p>
          <ul className="divide-y divide-gray-100 text-sm">
            {versions.map(v => (
              <li key={v.id} className="flex items-start gap-3 py-2">
                <div className="flex-1">
                  <p className="text-gray-800">Version {v.version} · {fmtDateTime(v.committed_at)}</p>
                  <p className="text-xs text-gray-500">{v.committed_by_name} · {v.page_count} page{v.page_count === 1 ? '' : 's'} · {(v.word_count || 0).toLocaleString()} words</p>
                  {v.unlock_reason && <p className="text-xs text-gray-500">Unlocked {fmtDateTime(v.unlocked_at)} by {v.unlocked_by_name}: “{v.unlock_reason}”</p>}
                </div>
                {v.version > 1 && (
                  <Button size="sm" variant="ghost" title={`What changed from version ${v.version - 1}`} onClick={() => openCompare(v.version - 1, v.version)}>
                    <GitCompare className="h-3.5 w-3.5" /> Changes
                  </Button>
                )}
                {v.client_file_id && (
                  <Button size="sm" variant="secondary" onClick={() => downloadFile(api, `/client-files/${v.client_file_id}/download`, `Report v${v.version}.pdf`)}>
                    <Download className="h-3.5 w-3.5" /> PDF
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {canCompare && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
              <span className="text-gray-600">Compare</span>
              <select className="rounded border border-gray-300 px-2 py-1" value={from} onChange={e => setFrom(Number(e.target.value))}>
                {versions.map(v => <option key={v.id} value={v.version}>version {v.version}</option>)}
              </select>
              <span className="text-gray-600">with</span>
              <select className="rounded border border-gray-300 px-2 py-1" value={to} onChange={e => setTo(e.target.value === 'draft' ? 'draft' : Number(e.target.value))}>
                {draft && <option value="draft">my current changes</option>}
                {versions.map(v => <option key={v.id} value={v.version}>version {v.version}</option>)}
              </select>
              <Button size="sm" variant="secondary" disabled={from === to} onClick={() => openCompare(from, to)}><GitCompare className="h-3.5 w-3.5" /> Compare</Button>
            </div>
          )}
        </div>
      )}
      {compare && <CompareView reportId={reportId} fromVersion={compare.from} toVersion={compare.to} draft={compare.draft} onClose={() => setCompare(null)} />}
      <p className="mb-1 text-sm font-medium text-gray-700">Saved while writing</p>
      <p className="mb-3 text-sm text-gray-500">A copy is kept at most every 10 minutes while you write (the last 30). Restore one to get back text that was deleted by mistake.</p>
      {snaps === null ? <p className="py-6 text-center text-sm text-gray-400">Loading…</p>
        : !snaps.length ? <p className="py-6 text-center text-sm text-gray-400">Nothing saved yet.</p>
        : (
          <ul className="divide-y divide-gray-100 text-sm">
            {snaps.map(s => (
              <li key={s.id} className="flex items-center gap-3 py-2">
                <div className="flex-1">
                  <p className="text-gray-800">{fmtDateTime(s.saved_at)}</p>
                  <p className="text-xs text-gray-500">{s.saved_by_name} · {(s.word_count || 0).toLocaleString()} words</p>
                </div>
                {canRestore && <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => restore(s)}>{busy === s.id ? 'Restoring…' : 'Restore'}</Button>}
              </li>
            ))}
          </ul>
        )}
    </Modal>
  );
}
