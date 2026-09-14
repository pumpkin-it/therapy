import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, X, ChevronDown, ChevronRight, Folder } from 'lucide-react';
import api from '../lib/api';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import RichEditor from '../components/RichEditor';
import { buildFolderTree, sortedChildren, sortedItems, countItems } from '../lib/formFolders';

// Variables available per template type/code
const EMAIL_VARS = {
  appt_created_client:       ['client_first_name', 'client_name', 'practitioner_name', 'appointment_date', 'location', 'appointment_notes', 'appointment_details'],
  appt_updated_client:       ['client_first_name', 'client_name', 'practitioner_name', 'appointment_date', 'location', 'appointment_notes', 'appointment_details'],
  appt_cancelled_client:     ['client_first_name', 'client_name', 'appointment_date', 'appointment_notes', 'late_cancellation_notice'],
  appt_created_practitioner: ['practitioner_name', 'client_name', 'appointment_date', 'location', 'appointment_notes', 'appointment_details'],
  appt_updated_practitioner: ['practitioner_name', 'client_name', 'appointment_date', 'location', 'appointment_notes', 'appointment_details'],
  appt_cancelled_practitioner: ['practitioner_name', 'client_name', 'appointment_date'],
  invoice_email:             ['invoice_number', 'client_name'],
  payment_reminder:          ['invoice_number', 'invoice_total', 'due_date'],
  session_note_email:        ['client_name', 'client_first_name', 'practitioner_name', 'practice_name', 'date_range', 'note_count', 'recipient_name'],
};

const NOTE_VARS = ['client_name', 'client_first_name', 'practitioner_name', 'date', 'next_appointment', 'practice_name'];
const AGREEMENT_VARS = [
  'client_name', 'client_first_name', 'client_address', 'client_email', 'client_ndis_number',
  'practitioner_name', 'practice_name', 'practice_phone', 'practice_abn', 'date',
  'plan_start_date', 'plan_end_date', 'funds_manager_name', 'funds_manager_email', 'funds_manager_phone',
  'pricing_table',
];

function VarChips({ vars, insertRef }) {
  const insert = v => insertRef?.current?.(`{{${v}}}`);
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      <span className="text-xs text-gray-400 self-center">Insert:</span>
      {vars.map(v => (
        <button key={v} type="button" onClick={() => insert(v)}
          className="rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 hover:bg-indigo-100 font-mono transition-colors">
          {`{{${v}}}`}
        </button>
      ))}
    </div>
  );
}

// ─── Email Templates tab ──────────────────────────────────────────────────────
function EmailTemplates() {
  const [templates, setTemplates] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', subject: '', body: '' });
  const [saving, setSaving] = useState(false);
  const insertRef = useRef();

  const load = () => api.get('/templates?type=email').then(r => setTemplates(r.data));
  useEffect(() => { load(); }, []);

  const startEdit = t => { setEditing(t); setForm({ name: t.name, subject: t.subject || '', body: t.body }); };

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/templates/${editing.id}`, form);
      setEditing(null);
      load();
    } finally { setSaving(false); }
  };

  const vars = editing ? (EMAIL_VARS[editing.code] || []) : [];

  return (
    <div className="space-y-3">
      {editing && (
        <div className="rounded-xl border border-indigo-100 bg-white shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-gray-900">{editing.name}</p>
            <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-600">Subject</label>
            <input
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              value={form.subject}
              onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-600">Body</label>
            {/* key remounts Quill whenever a different template is opened */}
            <RichEditor
              key={editing.id}
              defaultValue={form.body}
              onChange={v => setForm(f => ({ ...f, body: v }))}
              insertRef={insertRef}
              toolbar="email"
            />
            <VarChips vars={vars} insertRef={insertRef} />
          </div>
          {editing.code?.startsWith('appt_') && (
            <p className="text-xs text-gray-400">
              <code className="bg-gray-100 px-1 rounded">{'{{appointment_details}}'}</code> inserts a formatted table of appointment details.
            </p>
          )}
          {editing.code === 'appt_cancelled_client' && (
            <p className="text-xs text-gray-400">
              <code className="bg-gray-100 px-1 rounded">{'{{late_cancellation_notice}}'}</code> inserts a warning that a cancellation fee applies — only when this cancellation was flagged as late. It's blank otherwise, so it's safe to leave in the template.
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      )}

      {templates.map(t => (
        <div key={t.id} className={`rounded-xl border bg-white shadow-sm p-4 flex items-start gap-3 ${editing?.id === t.id ? 'border-indigo-200' : 'border-gray-200'}`}>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-gray-900 text-sm">{t.name}</p>
            <p className="text-xs text-gray-400 mt-0.5 truncate">{t.subject}</p>
          </div>
          <button onClick={() => editing?.id === t.id ? setEditing(null) : startEdit(t)}
            className="p-1.5 text-gray-400 hover:text-indigo-600 shrink-0">
            <Pencil className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Session Note Templates tab ──────────────────────────────────────────────
function NoteTemplates() {
  const [templates, setTemplates] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', body: '' });
  const [saving, setSaving] = useState(false);
  const insertRef = useRef();

  const load = () => api.get('/templates?type=session_note').then(r => setTemplates(r.data));
  useEffect(() => { load(); }, []);

  const startEdit = t => { setEditing(t); setShowNew(false); setForm({ name: t.name, body: t.body }); };
  const startNew  = () => { setShowNew(true); setEditing(null); setForm({ name: '', body: '' }); };

  const save = async () => {
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/templates/${editing.id}`, form);
      } else {
        await api.post('/templates', form);
      }
      setEditing(null);
      setShowNew(false);
      load();
    } finally { setSaving(false); }
  };

  const remove = async id => {
    if (!confirm('Delete this template?')) return;
    await api.delete(`/templates/${id}`);
    load();
  };

  const isEditing = showNew || !!editing;
  const editorKey = editing ? `edit-${editing.id}` : 'new';

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        {!isEditing && (
          <Button size="sm" onClick={startNew}><Plus className="h-3.5 w-3.5" /> New template</Button>
        )}
      </div>

      {isEditing && (
        <div className="rounded-xl border border-indigo-100 bg-white shadow-sm p-5 space-y-4">
          <p className="font-semibold text-gray-900">{editing ? `Edit: ${editing.name}` : 'New template'}</p>
          <Input label="Template name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. NDIS Session Note" />
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-600">Body</label>
            <RichEditor
              key={editorKey}
              defaultValue={form.body}
              onChange={v => setForm(f => ({ ...f, body: v }))}
              insertRef={insertRef}
              toolbar="note"
            />
            <VarChips vars={NOTE_VARS} insertRef={insertRef} />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <Button variant="secondary" size="sm" onClick={() => { setEditing(null); setShowNew(false); }}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving || !form.name.trim() || !form.body.trim()}>
              {saving ? 'Saving…' : 'Save template'}
            </Button>
          </div>
        </div>
      )}

      {templates.length === 0 && !isEditing && (
        <p className="text-sm text-gray-400 py-8 text-center">No session note templates yet.</p>
      )}

      {templates.map(t => (
        <div key={t.id} className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-gray-900 text-sm">{t.name}</p>
            <p className="text-xs text-gray-400 mt-0.5 line-clamp-2" dangerouslySetInnerHTML={{ __html: t.body }} />
          </div>
          <div className="flex gap-1 shrink-0">
            <button onClick={() => editing?.id === t.id ? setEditing(null) : startEdit(t)} className="p-1.5 text-gray-400 hover:text-indigo-600"><Pencil className="h-4 w-4" /></button>
            <button onClick={() => remove(t.id)} className="p-1.5 text-gray-400 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Agreement Templates tab ─────────────────────────────────────────────────
function AgreementTemplates() {
  const [templates, setTemplates] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', body: '', has_pricing_table: true });
  const [saving, setSaving] = useState(false);
  const insertRef = useRef();

  const load = () => api.get('/templates?type=agreement').then(r => setTemplates(r.data));
  useEffect(() => { load(); }, []);

  const startEdit = t => { setEditing(t); setShowNew(false); setForm({ name: t.name, body: t.body, has_pricing_table: !!t.has_pricing_table }); };
  const startNew  = () => { setShowNew(true); setEditing(null); setForm({ name: '', body: '', has_pricing_table: true }); };

  const save = async () => {
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/templates/${editing.id}`, form);
      } else {
        await api.post('/templates', { ...form, type: 'agreement' });
      }
      setEditing(null);
      setShowNew(false);
      load();
    } finally { setSaving(false); }
  };

  const remove = async id => {
    if (!confirm('Delete this template?')) return;
    await api.delete(`/templates/${id}`);
    load();
  };

  const isEditing = showNew || !!editing;
  const editorKey = editing ? `edit-${editing.id}` : 'new';

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        {!isEditing && (
          <Button size="sm" onClick={startNew}><Plus className="h-3.5 w-3.5" /> New template</Button>
        )}
      </div>

      {isEditing && (
        <div className="rounded-xl border border-indigo-100 bg-white shadow-sm p-5 space-y-4">
          <p className="font-semibold text-gray-900">{editing ? `Edit: ${editing.name}` : 'New template'}</p>
          <Input label="Template name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Service Agreement" />
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" className="accent-indigo-600" checked={form.has_pricing_table}
              onChange={e => setForm(f => ({ ...f, has_pricing_table: e.target.checked }))} />
            Include pricing table
          </label>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-600">Body</label>
            <RichEditor
              key={editorKey}
              defaultValue={form.body}
              onChange={v => setForm(f => ({ ...f, body: v }))}
              insertRef={insertRef}
              toolbar="note"
            />
            <VarChips vars={AGREEMENT_VARS} insertRef={insertRef} />
            {form.has_pricing_table && (
              <p className="text-xs text-gray-400">
                <code className="bg-gray-100 px-1 rounded">{'{{pricing_table}}'}</code> inserts the service pricing table the practitioner builds when drafting the agreement.
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <Button variant="secondary" size="sm" onClick={() => { setEditing(null); setShowNew(false); }}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving || !form.name.trim() || !form.body.trim()}>
              {saving ? 'Saving…' : 'Save template'}
            </Button>
          </div>
        </div>
      )}

      {templates.length === 0 && !isEditing && (
        <p className="text-sm text-gray-400 py-8 text-center">No agreement templates yet.</p>
      )}

      {templates.map(t => (
        <div key={t.id} className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-gray-900 text-sm">{t.name}{t.has_pricing_table ? <span className="ml-2 text-xs text-indigo-500 font-normal">Pricing table</span> : null}</p>
            <p className="text-xs text-gray-400 mt-0.5 line-clamp-2" dangerouslySetInnerHTML={{ __html: t.body }} />
          </div>
          <div className="flex gap-1 shrink-0">
            <button onClick={() => editing?.id === t.id ? setEditing(null) : startEdit(t)} className="p-1.5 text-gray-400 hover:text-indigo-600"><Pencil className="h-4 w-4" /></button>
            {!t.is_system && <button onClick={() => remove(t.id)} className="p-1.5 text-gray-400 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Forms tab ────────────────────────────────────────────────────────────────
function FormCard({ f, onEdit, onRemove }) {
  const fieldCount = (f.schema?.sections || []).reduce((n, s) => n + s.fields.length, 0);
  const sectionCount = (f.schema?.sections || []).length;
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900 text-sm">{f.name}</p>
        <p className="text-xs text-gray-400 mt-0.5">
          {sectionCount} section{sectionCount === 1 ? '' : 's'} &middot; {fieldCount} field{fieldCount === 1 ? '' : 's'}
        </p>
      </div>
      <div className="flex gap-1 shrink-0">
        <button onClick={onEdit} className="p-1.5 text-gray-400 hover:text-indigo-600"><Pencil className="h-4 w-4" /></button>
        <button onClick={onRemove} className="p-1.5 text-gray-400 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

// Recursive folder tree — subfolders (sorted, collapsible) rendered before this level's own
// forms (also sorted), same ordering convention as a file explorer.
function FormFolderNode({ node, path, openFolders, toggleFolder, onEdit, onRemove }) {
  return (
    <div className="space-y-2">
      {sortedChildren(node).map(name => {
        const fullPath = path ? `${path}/${name}` : name;
        const isOpen = openFolders.has(fullPath);
        const child = node.children[name];
        return (
          <div key={fullPath} className="space-y-2">
            <button type="button" onClick={() => toggleFolder(fullPath)}
              className="w-full flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">
              {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
              <Folder className="h-4 w-4 shrink-0 text-indigo-400" />
              <span className="truncate">{name}</span>
              <span className="ml-auto text-xs text-gray-400 font-normal shrink-0">{countItems(child)}</span>
            </button>
            {isOpen && (
              <div className="pl-4 ml-2.5 border-l border-gray-100 space-y-2">
                <FormFolderNode node={child} path={fullPath} openFolders={openFolders} toggleFolder={toggleFolder} onEdit={onEdit} onRemove={onRemove} />
              </div>
            )}
          </div>
        );
      })}
      {sortedItems(node).map(f => (
        <FormCard key={f.id} f={f} onEdit={() => onEdit(f)} onRemove={() => onRemove(f)} />
      ))}
    </div>
  );
}

function FormTemplates() {
  const [forms, setForms] = useState([]);
  const [openFolders, setOpenFolders] = useState(() => new Set());
  const navigate = useNavigate();

  const load = () => api.get('/form-templates').then(r => setForms(r.data));
  useEffect(() => { load(); }, []);

  const remove = async f => {
    if (!confirm('Delete this form?')) return;
    await api.delete(`/form-templates/${f.id}`);
    load();
  };

  const toggleFolder = path => setOpenFolders(prev => {
    const next = new Set(prev);
    next.has(path) ? next.delete(path) : next.add(path);
    return next;
  });

  const tree = buildFolderTree(forms);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => navigate('/templates/forms/new')}><Plus className="h-3.5 w-3.5" /> New form</Button>
      </div>

      {forms.length === 0 && (
        <p className="text-sm text-gray-400 py-8 text-center">No forms yet — build one to gather client info in-session or send it ahead via a link.</p>
      )}

      <FormFolderNode
        node={tree}
        path=""
        openFolders={openFolders}
        toggleFolder={toggleFolder}
        onEdit={f => navigate(`/templates/forms/${f.id}`)}
        onRemove={remove}
      />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Templates() {
  const location = useLocation();
  const [tab, setTab] = useState(location.state?.tab || 'email');
  const TABS = [['email', 'Email Templates'], ['session_note', 'Session Note Templates'], ['agreement', 'Agreement Templates'], ['forms', 'Forms']];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Templates</h1>
        <p className="text-sm text-gray-500 mt-0.5">Edit system email templates and create session note templates</p>
      </div>

      <div className="border-b border-gray-200">
        <div className="flex gap-0">
          {TABS.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === id ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'email'        && <EmailTemplates />}
      {tab === 'session_note' && <NoteTemplates />}
      {tab === 'agreement'    && <AgreementTemplates />}
      {tab === 'forms'        && <FormTemplates />}
    </div>
  );
}
