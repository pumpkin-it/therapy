import { useEffect, useRef, useState } from 'react';
import { Paperclip, Upload, FolderOpen, X, Send, File as FileIcon } from 'lucide-react';
import api from '../../lib/api';
import { useConfirm } from '../ui/ConfirmDialog';
import Modal from '../ui/Modal';
import Button from '../ui/Button';

// Documents (quotes, doctors' reports…) sent with a report when it's released. Each one is a file
// in the client's Files tab — a new one is uploaded there first, into the folder you choose — and
// the report only points at it (server: billableReports.js /:id/attachments).

const fileName = f => f.label || f.original_name;
const where = f => `Files › ${f.folder_name || 'Top level'}`;
const fmtSize = b => (b == null ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
const errorOf = (e, fallback) => e.response?.data?.error || (e.response?.status === 413 ? 'File is too large to upload.' : fallback);

// The button that shows how many are attached and opens the list: an icon in the report editor's
// header, or a labelled button (labelled) on the client's Reports tab.
export default function ReportAttachments({ reportId, clientId, labelled = false }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ attachments: [], can_change: false, released: false, notify_to: [], notify_cc: [] });
  const load = () => api.get(`/billable-reports/${reportId}/attachments`).then(r => setData(r.data)).catch(() => {});
  useEffect(() => { load(); }, [reportId]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = data.attachments.length;
  return (
    <>
      {labelled ? (
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}><Paperclip className="h-3.5 w-3.5" /> Attachments{n > 0 ? ` (${n})` : ''}</Button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} title="Attachments — documents sent with the report when it's released"
          className={`inline-flex items-center gap-1 rounded p-1.5 text-xs ${n ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500 hover:bg-gray-100'}`}>
          <Paperclip className="h-4 w-4" />{n > 0 && n}
        </button>
      )}
      {open && <AttachmentsModal reportId={reportId} clientId={clientId} data={data} setData={setData} onClose={() => setOpen(false)} />}
    </>
  );
}

function AttachmentsModal({ reportId, clientId, data, setData, onClose }) {
  const confirm = useConfirm();
  const [error, setError] = useState('');
  const [resent, setResent] = useState('');
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState(null); // files chosen to upload, waiting for a folder
  const [browsing, setBrowsing] = useState(false);
  const [saved, setSaved] = useState(null); // { names, where } after an upload
  const inputRef = useRef();

  const attach = async ids => {
    const { data: d } = await api.post(`/billable-reports/${reportId}/attachments`, { client_file_ids: ids });
    setData(d);
  };
  const remove = async f => {
    setError('');
    try { setData((await api.delete(`/billable-reports/${reportId}/attachments/${f.id}`)).data); }
    catch (e) { setError(errorOf(e, 'Could not remove it.')); }
  };

  const upload = async (files, folder) => {
    setBusy(true); setError('');
    const ids = [], names = [], failed = [];
    for (const file of files) {
      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('client_id', clientId);
        if (folder.id) fd.append('folder_id', folder.id);
        fd.append('label', file.name.replace(/\.[^.]+$/, ''));
        ids.push((await api.post('/client-files', fd, { headers: { 'Content-Type': 'multipart/form-data' } })).data.id);
        names.push(file.name);
      } catch (e) { failed.push(`${file.name}: ${errorOf(e, 'failed to upload')}`); }
    }
    try {
      if (ids.length) await attach(ids);
      setPicked(null);
      if (ids.length) setSaved({ names, where: `Files › ${folder.name}` });
      if (failed.length) setError(`Some files didn't upload — ${failed.join('; ')}`);
    } catch (e) { setError(errorOf(e, 'Uploaded to Files, but could not attach to the report.')); }
    finally { setBusy(false); }
  };

  // A released report: send the release email again so documents added since go out too.
  const resend = async () => {
    const who = [...data.notify_to, ...data.notify_cc].join(', ');
    if (!await confirm({ title: 'Send the release email again?', message: `The release email, with the ${data.attachments.length} attached document${data.attachments.length === 1 ? '' : 's'}, goes to ${who} again.`, confirmLabel: 'Send' })) return;
    setBusy(true); setError(''); setResent('');
    try {
      const { data: r } = await api.post(`/billable-reports/${reportId}/resend-release`);
      setResent(`Sent to ${who}${r.linked?.length ? ` — too large to attach (on the report page): ${r.linked.join(', ')}` : ''}.`);
    } catch (e) { setError(errorOf(e, 'Could not send the email.')); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Attachments" onClose={() => !busy && onClose()} wide>
      <div className="space-y-3 text-sm">
        <p className="text-gray-600">Documents such as quotes or doctors’ reports. They’re emailed to the report’s contacts together with the report when it’s released (very large ones are put on the report’s download page instead). Each one is kept in the client’s Files tab.</p>
        {data.released && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">This report has already been released. Documents you add now aren’t sent until you send the release email again (below).</p>
        )}
        {resent && <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-green-800">{resent}</div>}
        {saved && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-green-800">
            Saved in <strong>{saved.where}</strong> and attached: {saved.names.join(', ')}
          </div>
        )}
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800">{error}</div>}

        {data.attachments.length ? (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {data.attachments.map(f => (
              <li key={f.id} className="flex items-center gap-2 px-3 py-2">
                <FileIcon className="h-4 w-4 shrink-0 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-gray-900">{fileName(f)}</p>
                  <p className="text-xs text-gray-500">{where(f)}{f.size ? ` · ${fmtSize(f.size)}` : ''}</p>
                </div>
                {data.can_change && (
                  <button type="button" onClick={() => remove(f)} title="Remove from the report (stays in Files)"
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600"><X className="h-4 w-4" /></button>
                )}
              </li>
            ))}
          </ul>
        ) : <p className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-gray-500">Nothing attached yet.</p>}

        {data.can_change ? (
          <div className="flex flex-wrap items-center gap-2">
            <input ref={inputRef} type="file" multiple className="hidden"
              onChange={e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) { setSaved(null); setPicked(fs); } }} />
            <Button size="sm" onClick={() => inputRef.current.click()} disabled={busy}><Upload className="h-3.5 w-3.5" /> {busy ? 'Uploading…' : 'Upload new'}</Button>
            <Button size="sm" variant="secondary" onClick={() => { setSaved(null); setBrowsing(true); }} disabled={busy}><FolderOpen className="h-3.5 w-3.5" /> Add from Files</Button>
            {data.released && (data.notify_to.length
              ? <Button size="sm" variant="secondary" onClick={resend} disabled={busy}><Send className="h-3.5 w-3.5" /> Send release email again</Button>
              : <span className="text-xs text-gray-500">No email contacts on this report — use Notify on it in the Files tab.</span>)}
          </div>
        ) : <p className="text-xs text-gray-500">Only the report’s practitioner or an admin can change its attachments.</p>}
        <div className="flex justify-end border-t border-gray-100 pt-3">
          <Button size="sm" onClick={onClose} disabled={busy}>Done</Button>
        </div>
      </div>

      {picked && <FolderPicker clientId={clientId} files={picked} busy={busy} onCancel={() => setPicked(null)} onPick={folder => upload(picked, folder)} />}
      {browsing && (
        <FilesPicker clientId={clientId} exclude={data.attachments.map(f => f.id)} onCancel={() => setBrowsing(false)}
          onPick={async ids => {
            try { await attach(ids); setBrowsing(false); } catch (e) { setError(errorOf(e, 'Could not attach.')); setBrowsing(false); }
          }} />
      )}
    </Modal>
  );
}

// Always asks which folder of the Files tab a new attachment goes in (no default), and shows the
// place it will be saved before uploading.
function FolderPicker({ clientId, files, busy, onCancel, onPick }) {
  const [folders, setFolders] = useState(null);
  const [choice, setChoice] = useState('');
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { api.get(`/client-file-folders?client_id=${clientId}`).then(r => setFolders(r.data)).catch(() => setFolders([])); }, [clientId]);

  const target = choice === 'root' ? { id: null, name: 'Top level' }
    : choice === 'new' ? (newName.trim() ? { id: 'new', name: newName.trim() } : null)
    : folders?.find(f => String(f.id) === choice) || null;

  const go = async () => {
    if (!target) return;
    setError('');
    if (target.id !== 'new') return onPick(target);
    try {
      const { data } = await api.post('/client-file-folders', { client_id: clientId, name: target.name });
      onPick({ id: data.id, name: data.name });
    } catch (e) { setError(errorOf(e, 'Could not create the folder.')); }
  };

  return (
    <Modal title="Save to the client’s Files" onClose={() => !busy && onCancel()} z="z-[60]">
      <div className="space-y-3 text-sm">
        <p className="text-gray-600">{files.length === 1 ? `“${files[0].name}”` : `${files.length} files`} will be saved in the client’s Files tab and attached to this report. Which folder?</p>
        {!folders ? <p className="text-gray-400">Loading folders…</p> : (
          <div className="space-y-1.5">
            {[{ key: 'root', label: 'Top level (not in a folder)' }, ...folders.map(f => ({ key: String(f.id), label: f.name })), { key: 'new', label: 'New folder…' }].map(o => (
              <label key={o.key} className="flex items-center gap-2">
                <input type="radio" name="folder" className="accent-indigo-600" checked={choice === o.key} onChange={() => setChoice(o.key)} />
                <span>{o.label}</span>
              </label>
            ))}
            {choice === 'new' && <input autoFocus value={newName} onChange={e => setNewName(e.target.value)} placeholder="Folder name"
              className="ml-6 w-64 rounded border border-gray-300 px-2 py-1 focus:border-indigo-500 focus:outline-none" />}
          </div>
        )}
        {target && <p className="rounded bg-gray-50 px-3 py-2 text-gray-700">Will be saved in: <strong>Files › {target.name}</strong></p>}
        {error && <p className="text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={go} disabled={!target || busy}>{busy ? 'Uploading…' : 'Upload and attach'}</Button>
        </div>
      </div>
    </Modal>
  );
}

// A file already in the client's Files tab (any folder), to attach.
function FilesPicker({ clientId, exclude, onCancel, onPick }) {
  const [files, setFiles] = useState(null);
  const [sel, setSel] = useState([]);
  const [q, setQ] = useState('');
  useEffect(() => { api.get(`/client-files?client_id=${clientId}&all=1`).then(r => setFiles(r.data)).catch(() => setFiles([])); }, [clientId]);
  const shown = (files || []).filter(f => !f.is_report && !exclude.includes(f.id)
    && (!q.trim() || `${fileName(f)} ${f.folder_name || ''}`.toLowerCase().includes(q.trim().toLowerCase())));
  const toggle = id => setSel(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));
  return (
    <Modal title="Add from the client’s Files" onClose={onCancel} z="z-[60]" wide>
      <div className="space-y-3 text-sm">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search files…" autoFocus
          className="w-full rounded border border-gray-300 px-3 py-1.5 focus:border-indigo-500 focus:outline-none" />
        {!files ? <p className="text-gray-400">Loading…</p> : shown.length ? (
          <ul className="max-h-80 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200">
            {shown.map(f => (
              <li key={f.id}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-gray-50">
                  <input type="checkbox" className="accent-indigo-600" checked={sel.includes(f.id)} onChange={() => toggle(f.id)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-gray-900">{fileName(f)}</p>
                    <p className="text-xs text-gray-500">{where(f)}{f.size ? ` · ${fmtSize(f.size)}` : ''}</p>
                  </div>
                </label>
              </li>
            ))}
          </ul>
        ) : <p className="text-gray-500">{files.length ? 'No other files match.' : 'This client has no files yet.'}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={() => onPick(sel)} disabled={!sel.length}>Attach{sel.length > 1 ? ` ${sel.length} files` : ''}</Button>
        </div>
      </div>
    </Modal>
  );
}
