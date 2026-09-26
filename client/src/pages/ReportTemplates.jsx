import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Copy, Trash2 } from 'lucide-react';
import api from '../lib/api';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Input from '../components/ui/Input';
import Modal from '../components/ui/Modal';
import { useConfirm } from '../components/ui/ConfirmDialog';

// Report templates for writing reports in the system (owner/admin). Each is written in the same
// editor as a report; a report started from one gets its own copy (server/routes/reportDocTemplates.js).
// (Replaces an earlier, never-routed ReportTemplates.jsx for the old clinical-report feature.)

const fmt = iso => (iso ? new Date(iso.endsWith('Z') ? iso : iso.replace(' ', 'T') + 'Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export default function ReportTemplates({ embedded = false }) {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState(null);
  const [creating, setCreating] = useState(null); // { copy_from, name }
  const [error, setError] = useState('');

  const load = () => api.get('/report-doc-templates?all=1').then(r => setTemplates(r.data)).catch(() => setTemplates([]));
  useEffect(() => { load(); }, []);

  const create = async () => {
    setError('');
    if (!creating.name?.trim()) return setError('Enter a template name');
    try {
      const { data } = await api.post('/report-doc-templates', { name: creating.name.trim(), description: creating.description, copy_from: creating.copy_from || undefined });
      navigate(`/report-templates/${data.id}`);
    } catch (e) { setError(e.response?.data?.error || 'Failed to create template'); }
  };

  const toggle = async t => { await api.put(`/report-doc-templates/${t.id}`, { active: !t.active }); load(); };
  const remove = async t => {
    if (!await confirm({ title: 'Delete template', message: `Delete the template "${t.name}"? Reports already started from it keep their own copy.`, confirmLabel: 'Delete', danger: true })) return;
    await api.delete(`/report-doc-templates/${t.id}`);
    load();
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          {!embedded && <h1 className="text-2xl font-semibold">Report templates</h1>}
          <p className="text-sm text-gray-500">Starting points for reports written in the system. Therapists pick one (or a blank page) when they start a report.</p>
        </div>
        <Button onClick={() => { setError(''); setCreating({ name: '', description: '', copy_from: '' }); }}><Plus className="h-4 w-4" /> New template</Button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        {templates === null ? <p className="p-8 text-center text-sm text-gray-400">Loading…</p>
          : !templates.length ? <p className="p-8 text-center text-sm text-gray-400">No templates yet.</p>
          : (
            <ul className="divide-y divide-gray-100">
              {templates.map(t => (
                <li key={t.id} className="flex items-center gap-4 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <button className="font-medium text-gray-900 hover:text-indigo-700" onClick={() => navigate(`/report-templates/${t.id}`)}>{t.name}</button>
                      {!t.active && <Badge color="gray">Off</Badge>}
                    </div>
                    {t.description && <p className="truncate text-sm text-gray-500">{t.description}</p>}
                    <p className="text-xs text-gray-400">Updated {fmt(t.updated_at)}{t.updated_by_name ? ` by ${t.updated_by_name}` : ''}</p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => navigate(`/report-templates/${t.id}`)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                  <Button size="sm" variant="ghost" title="Make a copy" onClick={() => { setError(''); setCreating({ name: `${t.name} (copy)`, description: t.description || '', copy_from: t.id }); }}><Copy className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => toggle(t)} title={t.active ? 'Hide from the template list when starting a report' : 'Show in the template list again'}>{t.active ? 'Turn off' : 'Turn on'}</Button>
                  <button className="p-1 text-red-300 hover:text-red-500" title="Delete" onClick={() => remove(t)}><Trash2 className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
          )}
      </div>

      {creating && (
        <Modal title={creating.copy_from ? 'Copy template' : 'New template'} onClose={() => setCreating(null)}>
          <div className="space-y-4">
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Input label="Name" value={creating.name} autoFocus onChange={e => setCreating(c => ({ ...c, name: e.target.value }))} placeholder="Functional capacity assessment" />
            <Input label="Description (optional)" value={creating.description} onChange={e => setCreating(c => ({ ...c, description: e.target.value }))} placeholder="When to use this template" />
            {!creating.copy_from && templates?.length > 0 && (
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Start from</label>
                <select className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={creating.copy_from} onChange={e => setCreating(c => ({ ...c, copy_from: e.target.value }))}>
                  <option value="">Blank page</option>
                  {templates.map(t => <option key={t.id} value={t.id}>Copy of “{t.name}”</option>)}
                </select>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setCreating(null)}>Cancel</Button>
              <Button size="sm" onClick={create}>Create and edit</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
