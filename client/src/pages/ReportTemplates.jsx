import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, GripVertical, X } from 'lucide-react';
import api from '../lib/api';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';

function TemplateEditor({ template, onSave, onCancel }) {
  const [name, setName] = useState(template?.name || '');
  const [description, setDescription] = useState(template?.description || '');
  const [sections, setSections] = useState(
    template?.sections?.length ? template.sections : [{ title: '', placeholder: '' }]
  );
  const [saving, setSaving] = useState(false);

  const addSection = () => setSections(s => [...s, { title: '', placeholder: '' }]);
  const removeSection = i => setSections(s => s.filter((_, idx) => idx !== i));
  const updateSection = (i, key, val) =>
    setSections(s => s.map((sec, idx) => idx === i ? { ...sec, [key]: val } : sec));

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({ name: name.trim(), description: description.trim(), sections });
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Input label="Template name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Initial Assessment" />
        <Input label="Description (optional)" value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief description" />
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-700">Sections</p>
        {sections.map((sec, i) => (
          <div key={i} className="flex gap-2 items-start rounded-lg border border-gray-200 p-3 bg-gray-50">
            <GripVertical className="h-4 w-4 mt-2 text-gray-300 shrink-0" />
            <div className="flex-1 space-y-2">
              <input
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="Section title (e.g. Presenting Concerns)"
                value={sec.title}
                onChange={e => updateSection(i, 'title', e.target.value)}
              />
              <textarea
                rows={2}
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm resize-none focus:border-indigo-500 focus:outline-none"
                placeholder="Placeholder / guidance text shown to practitioner"
                value={sec.placeholder}
                onChange={e => updateSection(i, 'placeholder', e.target.value)}
              />
            </div>
            <button onClick={() => removeSection(i)} className="mt-1 text-gray-400 hover:text-red-500">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button
          onClick={addSection}
          className="flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
        >
          <Plus className="h-3.5 w-3.5" /> Add section
        </button>
      </div>

      <div className="flex gap-2 justify-end pt-2 border-t border-gray-100">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button onClick={save} disabled={saving || !name.trim()}>
          {saving ? 'Saving…' : 'Save template'}
        </Button>
      </div>
    </div>
  );
}

export default function ReportTemplates() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | 'new' | template object
  const [deleting, setDeleting] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/report-templates').then(r => setTemplates(r.data)).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleSave = async (data) => {
    if (editing === 'new') {
      await api.post('/report-templates', data);
    } else {
      await api.put(`/report-templates/${editing.id}`, data);
    }
    setEditing(null);
    load();
  };

  const handleDelete = async (id) => {
    await api.delete(`/report-templates/${id}`);
    setDeleting(null);
    load();
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Report Templates</h1>
          <p className="text-sm text-gray-500 mt-0.5">Pre-structured templates for client assessment reports</p>
        </div>
        {!editing && (
          <Button onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4 mr-1" /> New template
          </Button>
        )}
      </div>

      {editing && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">
            {editing === 'new' ? 'New template' : `Edit: ${editing.name}`}
          </h2>
          <TemplateEditor
            template={editing === 'new' ? null : editing}
            onSave={handleSave}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : templates.length === 0 && !editing ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center">
          <p className="text-sm text-gray-500">No templates yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map(t => (
            <div key={t.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900">{t.name}</p>
                  {t.description && <p className="text-sm text-gray-500 mt-0.5">{t.description}</p>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {t.sections.map((sec, i) => (
                      <span key={i} className="inline-block rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600">
                        {sec.title || `Section ${i + 1}`}
                      </span>
                    ))}
                    {t.sections.length === 0 && <span className="text-xs text-gray-400">No sections</span>}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => setEditing(t)} className="p-1.5 text-gray-400 hover:text-indigo-600 rounded">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => setDeleting(t)} className="p-1.5 text-gray-400 hover:text-red-500 rounded">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <p className="font-semibold text-gray-900">Delete "{deleting.name}"?</p>
            <p className="text-sm text-gray-500">This will hide the template from new reports. Existing reports using this template are not affected.</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => handleDelete(deleting.id)}>Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
