import { useState, useEffect, useRef } from 'react';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import Quill from 'quill';
import 'quill/dist/quill.snow.css';
import api from '../lib/api';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';

// Variables available per template type/code
const EMAIL_VARS = {
  appt_created_client:       ['client_first_name', 'client_name', 'practitioner_name', 'appointment_date', 'location', 'appointment_notes', 'appointment_details'],
  appt_updated_client:       ['client_first_name', 'client_name', 'practitioner_name', 'appointment_date', 'location', 'appointment_notes', 'appointment_details'],
  appt_cancelled_client:     ['client_first_name', 'client_name', 'appointment_date', 'appointment_notes'],
  appt_created_practitioner: ['practitioner_name', 'client_name', 'appointment_date', 'location', 'appointment_notes', 'appointment_details'],
  appt_updated_practitioner: ['practitioner_name', 'client_name', 'appointment_date', 'location', 'appointment_notes', 'appointment_details'],
  appt_cancelled_practitioner: ['practitioner_name', 'client_name', 'appointment_date'],
  invoice_email:             ['invoice_number', 'client_name'],
  payment_reminder:          ['invoice_number', 'invoice_total', 'due_date'],
};

const NOTE_VARS = ['client_name', 'client_first_name', 'practitioner_name', 'date', 'next_appointment', 'practice_name'];
const AGREEMENT_VARS = [
  'client_name', 'client_first_name', 'client_address', 'client_email', 'client_ndis_number',
  'practitioner_name', 'practice_name', 'practice_phone', 'practice_abn', 'date',
  'plan_start_date', 'plan_end_date', 'funds_manager_name', 'funds_manager_email', 'funds_manager_phone',
  'pricing_table',
];

// ─── Rich text editor (Quill) ─────────────────────────────────────────────────
function RichEditor({ defaultValue, onChange, insertRef, toolbar = 'email' }) {
  const containerRef = useRef();
  const quillRef = useRef();

  useEffect(() => {
    const toolbarOptions = toolbar === 'email'
      ? [
          ['bold', 'italic', 'underline', 'strike'],
          [{ header: [1, 2, 3, false] }],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['link'],
          ['clean'],
        ]
      : [
          ['bold', 'italic', 'underline'],
          [{ list: 'bullet' }],
          ['clean'],
        ];

    const quill = new Quill(containerRef.current, {
      theme: 'snow',
      modules: { toolbar: toolbarOptions },
    });

    quill.clipboard.dangerouslyPasteHTML(defaultValue || '');

    quill.on('text-change', () => {
      // Quill wraps even empty editors with <p><br></p> — treat as empty
      const html = quill.root.innerHTML;
      onChange(html === '<p><br></p>' ? '' : html);
    });

    quillRef.current = quill;
    return () => { quill.off('text-change'); };
  }, []); // intentionally empty — Quill owns this DOM node

  // Expose variable insertion to parent via ref
  if (insertRef) {
    insertRef.current = text => {
      const quill = quillRef.current;
      if (!quill) return;
      const range = quill.getSelection(true);
      quill.insertText(range ? range.index : quill.getLength() - 1, text, 'user');
    };
  }

  return (
    <div className="quill-wrapper rounded-lg overflow-hidden border border-gray-300 focus-within:border-indigo-500 transition-colors">
      <div ref={containerRef} />
    </div>
  );
}

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
            <button onClick={() => startEdit(t)} className="p-1.5 text-gray-400 hover:text-indigo-600"><Pencil className="h-4 w-4" /></button>
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
            <button onClick={() => startEdit(t)} className="p-1.5 text-gray-400 hover:text-indigo-600"><Pencil className="h-4 w-4" /></button>
            {!t.is_system && <button onClick={() => remove(t.id)} className="p-1.5 text-gray-400 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Templates() {
  const [tab, setTab] = useState('email');
  const TABS = [['email', 'Email Templates'], ['session_note', 'Session Note Templates'], ['agreement', 'Agreement Templates']];

  return (
    <div className="max-w-3xl mx-auto space-y-6">
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
    </div>
  );
}
