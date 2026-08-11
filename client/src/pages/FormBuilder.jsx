import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Plus, Trash2, ArrowUp, ArrowDown, Copy, X, Sparkles } from 'lucide-react';
import api from '../lib/api';
import Button from '../components/ui/Button';
import { SMART_FIELDS, CUSTOM_FIELD_CATEGORIES, fieldTypeMeta, makeField, makeSection } from '../lib/formFieldTypes';

function move(arr, index, dir) {
  const target = index + dir;
  if (target < 0 || target >= arr.length) return arr;
  const copy = [...arr];
  [copy[index], copy[target]] = [copy[target], copy[index]];
  return copy;
}

// ─── One field card inside a section ──────────────────────────────────────────
function FieldCard({ field, onChange, onRemove, onDuplicate, onMove, isFirst, isLast }) {
  const meta = fieldTypeMeta(field.type);
  const set = patch => onChange({ ...field, ...patch });
  const isChoice = ['checkboxes', 'dropdown', 'multiple_choice'].includes(field.type);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        {field.type === 'statement' ? (
          <span className="text-xs font-medium text-gray-500 pt-2">Text block</span>
        ) : (
          <input
            className="flex-1 font-medium text-gray-900 text-sm border-0 border-b border-transparent hover:border-gray-200 focus:border-indigo-500 focus:outline-none px-0 py-1 bg-transparent"
            value={field.label}
            onChange={e => set({ label: e.target.value })}
            placeholder="Question label"
          />
        )}
        {field.kind === 'smart' && (
          <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-indigo-50 text-indigo-600 text-[11px] font-medium px-2 py-0.5">
            <Sparkles className="h-3 w-3" /> Smart &rarr; {field.binding}
          </span>
        )}
      </div>

      {field.type === 'statement' && (
        <textarea
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          rows={2}
          placeholder="Instructional text shown to whoever fills out the form (not a question)."
          value={field.content}
          onChange={e => set({ content: e.target.value })}
        />
      )}

      {(field.type === 'short_answer' || field.type === 'paragraph') && (
        <input
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-500 focus:border-indigo-500 focus:outline-none"
          placeholder="Placeholder / helper text shown inside the empty field (optional)"
          value={field.placeholder}
          onChange={e => set({ placeholder: e.target.value })}
        />
      )}

      {isChoice && (
        <div className="space-y-1.5">
          {field.options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
                value={opt}
                onChange={e => set({ options: field.options.map((o, j) => j === i ? e.target.value : o) })}
              />
              <button
                type="button"
                onClick={() => set({ options: field.options.filter((_, j) => j !== i) })}
                disabled={field.options.length <= 1}
                className="p-1 text-gray-400 hover:text-red-500 disabled:opacity-30 disabled:hover:text-gray-400"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => set({ options: [...field.options, `Option ${field.options.length + 1}`] })}
            className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 border border-indigo-200 rounded-lg px-2.5 py-1"
          >
            <Plus className="h-3 w-3" /> Option
          </button>
        </div>
      )}

      {field.type === 'file_upload' && (
        <p className="text-xs text-gray-400">Client can attach a file here.</p>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
        {'required' in field ? (
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" className="accent-indigo-600" checked={field.required} onChange={e => set({ required: e.target.checked })} />
            Required
          </label>
        ) : <span />}
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => onMove(-1)} disabled={isFirst} className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={() => onMove(1)} disabled={isLast} className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={onDuplicate} className="p-1 text-gray-400 hover:text-indigo-600"><Copy className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={onRemove} className="p-1 text-gray-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
    </div>
  );
}

// ─── A section: purple header + its field cards ───────────────────────────────
function SectionCard({ section, index, total, active, onSelect, onChange, onRemove, onDuplicate, onMove }) {
  const setField = (fieldId, updated) => onChange({ ...section, fields: section.fields.map(f => f.id === fieldId ? updated : f) });
  const removeField = fieldId => onChange({ ...section, fields: section.fields.filter(f => f.id !== fieldId) });
  const duplicateField = fieldId => {
    const f = section.fields.find(x => x.id === fieldId);
    const idx = section.fields.findIndex(x => x.id === fieldId);
    const copy = { ...f, id: crypto.randomUUID() };
    const fields = [...section.fields];
    fields.splice(idx + 1, 0, copy);
    onChange({ ...section, fields });
  };
  const moveField = (fieldId, dir) => {
    const idx = section.fields.findIndex(x => x.id === fieldId);
    onChange({ ...section, fields: move(section.fields, idx, dir) });
  };

  return (
    <div onClick={onSelect} className={`rounded-xl overflow-hidden border ${active ? 'border-indigo-300 ring-1 ring-indigo-200' : 'border-gray-200'}`}>
      <div className="bg-indigo-500 px-4 py-3 flex items-center justify-between gap-3">
        <input
          className="flex-1 bg-transparent text-white font-medium placeholder-indigo-200 border-0 focus:outline-none focus:ring-0"
          value={section.title}
          onChange={e => onChange({ ...section, title: e.target.value })}
          onClick={e => e.stopPropagation()}
          placeholder="Section title"
        />
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" onClick={e => { e.stopPropagation(); onMove(-1); }} disabled={index === 0} className="p-1 text-indigo-100 hover:text-white disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
          <button type="button" onClick={e => { e.stopPropagation(); onMove(1); }} disabled={index === total - 1} className="p-1 text-indigo-100 hover:text-white disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
          <button type="button" onClick={e => { e.stopPropagation(); onDuplicate(); }} className="p-1 text-indigo-100 hover:text-white"><Copy className="h-4 w-4" /></button>
          <button type="button" onClick={e => { e.stopPropagation(); onRemove(); }} className="p-1 text-indigo-100 hover:text-white"><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="bg-gray-50 p-4 space-y-3">
        {section.fields.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-6">
            {active ? 'Click a field type on the left to add it here.' : 'No fields yet — click this section to select it, then add a field from the left.'}
          </p>
        )}
        {section.fields.map((field, i) => (
          <FieldCard
            key={field.id}
            field={field}
            onChange={updated => setField(field.id, updated)}
            onRemove={() => removeField(field.id)}
            onDuplicate={() => duplicateField(field.id)}
            onMove={dir => moveField(field.id, dir)}
            isFirst={i === 0}
            isLast={i === section.fields.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Left palette ──────────────────────────────────────────────────────────────
function Palette({ onAddSection, onAddField }) {
  return (
    <div className="w-64 shrink-0 space-y-5">
      <button
        onClick={onAddSection}
        className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        <Plus className="h-4 w-4" /> New section
      </button>

      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Smart fields</p>
        <p className="text-xs text-gray-400 mb-2">Prefill from and write back to the client's record.</p>
        <div className="space-y-1">
          {SMART_FIELDS.map(f => (
            <button key={f.type} onClick={() => onAddField(f.type)}
              className="w-full flex items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-sm text-indigo-700 hover:bg-indigo-50 text-left">
              <Sparkles className="h-3.5 w-3.5 shrink-0" /> {f.label}
            </button>
          ))}
        </div>
      </div>

      {CUSTOM_FIELD_CATEGORIES.map(cat => (
        <div key={cat.category}>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{cat.category}</p>
          <div className="space-y-1">
            {cat.fields.map(f => (
              <button key={f.type} onClick={() => onAddField(f.type)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 text-left">
                {f.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────
export default function FormBuilder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = id === 'new';

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [sections, setSections] = useState([makeSection('Section 1')]);
  const [activeSectionId, setActiveSectionId] = useState(sections[0].id);

  useEffect(() => {
    if (isNew) return;
    api.get(`/form-templates/${id}`).then(r => {
      setName(r.data.name);
      const loaded = r.data.schema.sections?.length ? r.data.schema.sections : [makeSection('Section 1')];
      setSections(loaded);
      setActiveSectionId(loaded[0].id);
      setLoading(false);
    });
  }, [id, isNew]);

  const addSection = () => {
    const s = makeSection(`Section ${sections.length + 1}`);
    setSections(prev => [...prev, s]);
    setActiveSectionId(s.id);
  };

  const addField = type => {
    setSections(prev => {
      const targetId = prev.find(s => s.id === activeSectionId) ? activeSectionId : prev[prev.length - 1]?.id;
      if (!targetId) return prev;
      return prev.map(s => s.id === targetId ? { ...s, fields: [...s.fields, makeField(type)] } : s);
    });
  };

  const updateSection = (idx, updated) => setSections(prev => prev.map((s, i) => i === idx ? updated : s));
  const removeSection = idx => {
    if (!confirm('Delete this section and all its fields?')) return;
    setSections(prev => prev.filter((_, i) => i !== idx));
  };
  const duplicateSection = idx => {
    setSections(prev => {
      const copy = { ...prev[idx], id: crypto.randomUUID(), fields: prev[idx].fields.map(f => ({ ...f, id: crypto.randomUUID() })) };
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  };
  const moveSection = (idx, dir) => setSections(prev => move(prev, idx, dir));

  const save = async () => {
    if (!name.trim()) return alert('Give this form a name first.');
    setSaving(true);
    try {
      const payload = { name, schema: { sections } };
      if (isNew) {
        await api.post('/form-templates', payload);
      } else {
        await api.put(`/form-templates/${id}`, payload);
      }
      navigate('/templates', { state: { tab: 'forms' } });
    } finally { setSaving(false); }
  };

  if (loading) return <div className="max-w-3xl mx-auto py-12 text-center text-gray-400">Loading…</div>;

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{isNew ? 'New form template' : 'Edit form template'}</h1>
          <p className="text-sm text-gray-500">Not yet sendable — this builds the template only.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => navigate('/templates', { state: { tab: 'forms' } })}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>

      <div className="flex gap-6 items-start">
        <Palette onAddSection={addSection} onAddField={addField} />

        <div className="flex-1 min-w-0 space-y-4">
          <input
            className="w-full text-2xl font-bold text-gray-900 border-0 border-b-2 border-transparent hover:border-gray-200 focus:border-indigo-500 focus:outline-none px-0 py-1 bg-transparent"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Untitled form"
          />

          {sections.map((section, i) => (
            <SectionCard
              key={section.id}
              section={section}
              index={i}
              total={sections.length}
              active={section.id === activeSectionId}
              onSelect={() => setActiveSectionId(section.id)}
              onChange={updated => updateSection(i, updated)}
              onRemove={() => removeSection(i)}
              onDuplicate={() => duplicateSection(i)}
              onMove={dir => moveSection(i, dir)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
