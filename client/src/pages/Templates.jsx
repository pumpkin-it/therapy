import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight, Folder } from 'lucide-react';
import api from '../lib/api';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import RichEditor from '../components/RichEditor';
import { buildFolderTree, sortedChildren, sortedItems, countItems } from '../lib/formFolders';
import { useAuth } from '../context/AuthContext';
import ReportTemplates from './ReportTemplates';
import { useConfirm } from '../components/ui/ConfirmDialog';

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

// ─── Shared list layout ──────────────────────────────────────────────────────
// Every tab uses the Report Templates layout: a description with the New button beside it, one
// bordered list with a row per template, and editing in a modal.

function TabHeader({ description, action }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <p className="text-sm text-gray-500">{description}</p>
      {action}
    </div>
  );
}

function TemplateList({ items, empty, children }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      {items === null ? <p className="p-8 text-center text-sm text-gray-400">Loading…</p>
        : !items.length ? <p className="p-8 text-center text-sm text-gray-400">{empty}</p>
        : <ul className="divide-y divide-gray-100">{children}</ul>}
    </div>
  );
}

const stripHtml = html => (html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

function TemplateRow({ name, tag, sub, onEdit, onRemove, indent = 0 }) {
  return (
    <li className="flex items-center gap-4 px-5 py-3.5" style={indent ? { paddingLeft: 20 + indent * 24 } : undefined}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <button className="truncate text-left font-medium text-gray-900 hover:text-indigo-700" onClick={onEdit}>{name}</button>
          {tag && <Badge color="indigo">{tag}</Badge>}
        </div>
        {sub && <p className="truncate text-sm text-gray-500">{sub}</p>}
      </div>
      <Button size="sm" variant="secondary" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
      {onRemove && <button className="p-1 text-red-300 hover:text-red-500" title="Delete" onClick={onRemove}><Trash2 className="h-4 w-4" /></button>}
    </li>
  );
}

// Edit/new form in a modal. Closing (×, Escape, Cancel) asks first if there are unsaved changes.
function EditorModal({ title, dirty, saving, canSave, saveLabel = 'Save', onSave, onClose, children }) {
  const confirm = useConfirm();
  const close = async () => { if (!dirty || await confirm({ title: 'Unsaved changes', message: 'Discard your unsaved changes?', confirmLabel: 'Discard', danger: true })) onClose(); };
  return (
    <Modal title={title} onClose={close} size="xl">
      <div className="space-y-4">
        {children}
        <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
          <Button variant="secondary" size="sm" onClick={close}>Cancel</Button>
          <Button size="sm" onClick={onSave} disabled={saving || !canSave}>{saving ? 'Saving…' : saveLabel}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Email Templates tab ──────────────────────────────────────────────────────
function EmailTemplates() {
  const [templates, setTemplates] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', subject: '', body: '' });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const insertRef = useRef();

  const load = () => api.get('/templates?type=email').then(r => setTemplates(r.data)).catch(() => setTemplates([]));
  useEffect(() => { load(); }, []);

  const startEdit = t => { setEditing(t); setDirty(false); setForm({ name: t.name, subject: t.subject || '', body: t.body }); };
  const change = patch => { setForm(f => ({ ...f, ...patch })); setDirty(true); };

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
    <div className="max-w-4xl space-y-6">
      <TabHeader description="The emails the system sends to clients and practitioners. These are built in — you can change the wording but not add or remove them." />

      <TemplateList items={templates} empty="No email templates.">
        {templates?.map(t => <TemplateRow key={t.id} name={t.name} sub={t.subject} onEdit={() => startEdit(t)} />)}
      </TemplateList>

      {editing && (
        <EditorModal title={editing.name} dirty={dirty} saving={saving} canSave onSave={save} onClose={() => setEditing(null)}>
          <Input label="Subject" value={form.subject} onChange={e => change({ subject: e.target.value })} />
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Body</label>
            {/* key remounts Quill whenever a different template is opened */}
            <RichEditor
              key={editing.id}
              defaultValue={form.body}
              onChange={v => change({ body: v })}
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
        </EditorModal>
      )}
    </div>
  );
}

// ─── Session Note / Agreement Templates tabs ─────────────────────────────────
// Same list and editor; agreements add the pricing-table option.
function BodyTemplates({ type, description, empty, namePlaceholder, vars, withPricing = false }) {
  const confirm = useConfirm();
  const [templates, setTemplates] = useState(null);
  const [editing, setEditing] = useState(null); // a template, or {} for a new one
  const [form, setForm] = useState({ name: '', body: '', has_pricing_table: true });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const insertRef = useRef();

  const load = () => api.get(`/templates?type=${type}`).then(r => setTemplates(r.data)).catch(() => setTemplates([]));
  useEffect(() => { load(); }, [type]);

  const open = t => {
    setEditing(t); setDirty(false);
    setForm({ name: t.name || '', body: t.body || '', has_pricing_table: t.id ? !!t.has_pricing_table : true });
  };
  const change = patch => { setForm(f => ({ ...f, ...patch })); setDirty(true); };

  const save = async () => {
    setSaving(true);
    try {
      const body = withPricing ? form : { name: form.name, body: form.body };
      if (editing.id) await api.put(`/templates/${editing.id}`, body);
      else await api.post('/templates', { ...body, type });
      setEditing(null);
      load();
    } finally { setSaving(false); }
  };

  const remove = async t => {
    if (!await confirm({ title: 'Delete template', message: `Delete the template "${t.name}"?`, confirmLabel: 'Delete', danger: true })) return;
    await api.delete(`/templates/${t.id}`);
    load();
  };

  return (
    <div className="max-w-4xl space-y-6">
      <TabHeader description={description}
        action={<Button onClick={() => open({})}><Plus className="h-4 w-4" /> New template</Button>} />

      <TemplateList items={templates} empty={empty}>
        {templates?.map(t => (
          <TemplateRow key={t.id} name={t.name} tag={withPricing && t.has_pricing_table ? 'Pricing table' : null}
            sub={stripHtml(t.body)} onEdit={() => open(t)} onRemove={t.is_system ? null : () => remove(t)} />
        ))}
      </TemplateList>

      {editing && (
        <EditorModal title={editing.id ? `Edit: ${editing.name}` : 'New template'} dirty={dirty} saving={saving}
          canSave={form.name.trim() && form.body.trim()} saveLabel="Save template" onSave={save} onClose={() => setEditing(null)}>
          <Input label="Template name" value={form.name} onChange={e => change({ name: e.target.value })} placeholder={namePlaceholder} />
          {withPricing && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" className="accent-indigo-600" checked={form.has_pricing_table}
                onChange={e => change({ has_pricing_table: e.target.checked })} />
              Include pricing table
            </label>
          )}
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Body</label>
            <RichEditor
              key={editing.id ? `edit-${editing.id}` : 'new'}
              defaultValue={form.body}
              onChange={v => change({ body: v })}
              insertRef={insertRef}
              toolbar="note"
            />
            <VarChips vars={vars} insertRef={insertRef} />
            {withPricing && form.has_pricing_table && (
              <p className="text-xs text-gray-400">
                <code className="bg-gray-100 px-1 rounded">{'{{pricing_table}}'}</code> inserts the service pricing table the practitioner builds when drafting the agreement.
              </p>
            )}
          </div>
        </EditorModal>
      )}
    </div>
  );
}

// ─── Forms tab ────────────────────────────────────────────────────────────────
// Folders and forms as rows of the one list: a folder row toggles its contents, which are indented
// beneath it (subfolders first, then forms, both sorted — like a file explorer).
function formRows(node, path, depth, openFolders, rows) {
  for (const name of sortedChildren(node)) {
    const fullPath = path ? `${path}/${name}` : name;
    const child = node.children[name];
    rows.push({ folder: true, key: `d:${fullPath}`, name, fullPath, depth, count: countItems(child) });
    if (openFolders.has(fullPath)) formRows(child, fullPath, depth + 1, openFolders, rows);
  }
  for (const f of sortedItems(node)) rows.push({ key: `f:${f.id}`, form: f, depth });
  return rows;
}

function FormTemplates() {
  const confirm = useConfirm();
  const [forms, setForms] = useState(null);
  const [openFolders, setOpenFolders] = useState(() => new Set());
  const navigate = useNavigate();

  const load = () => api.get('/form-templates').then(r => setForms(r.data)).catch(() => setForms([]));
  useEffect(() => { load(); }, []);

  const remove = async f => {
    if (!await confirm({ title: 'Delete form', message: `Delete the form "${f.name}"?`, confirmLabel: 'Delete', danger: true })) return;
    await api.delete(`/form-templates/${f.id}`);
    load();
  };

  const toggleFolder = path => setOpenFolders(prev => {
    const next = new Set(prev);
    next.has(path) ? next.delete(path) : next.add(path);
    return next;
  });

  const rows = forms ? formRows(buildFolderTree(forms), '', 0, openFolders, []) : null;

  return (
    <div className="max-w-4xl space-y-6">
      <TabHeader description="Forms to gather client information in a session or send ahead with a link."
        action={<Button onClick={() => navigate('/templates/forms/new')}><Plus className="h-4 w-4" /> New form</Button>} />

      <TemplateList items={rows} empty="No forms yet.">
        {rows?.map(r => {
          if (r.folder) {
            const isOpen = openFolders.has(r.fullPath);
            return (
              <li key={r.key}>
                <button type="button" onClick={() => toggleFolder(r.fullPath)}
                  className="flex w-full items-center gap-2 bg-gray-50 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
                  style={r.depth ? { paddingLeft: 20 + r.depth * 24 } : undefined}>
                  {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                  <Folder className="h-4 w-4 shrink-0 text-indigo-400" />
                  <span className="truncate">{r.name}</span>
                  <span className="ml-auto shrink-0 text-xs font-normal text-gray-400">{r.count}</span>
                </button>
              </li>
            );
          }
          const f = r.form;
          const sections = f.schema?.sections || [];
          const fieldCount = sections.reduce((n, s) => n + s.fields.length, 0);
          return (
            <TemplateRow key={r.key} indent={r.depth} name={f.name}
              sub={f.description || `${sections.length} section${sections.length === 1 ? '' : 's'} · ${fieldCount} field${fieldCount === 1 ? '' : 's'}`}
              onEdit={() => navigate(`/templates/forms/${f.id}`)} onRemove={() => remove(f)} />
          );
        })}
      </TemplateList>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Templates() {
  const location = useLocation();
  const { user } = useAuth();
  // Email/note/agreement/form templates need the Settings permission; report templates are for
  // owners and admins (who don't have Settings by default) — so an admin sees only that tab.
  const canSettings = !!user?.permissions?.settings;
  const canReports = ['owner', 'admin'].includes(user?.role);
  const TABS = [
    ...(canSettings ? [['email', 'Email Templates'], ['session_note', 'Session Note Templates'], ['agreement', 'Agreement Templates'], ['forms', 'Forms']] : []),
    ...(canReports ? [['reports', 'Report Templates']] : []),
  ];
  const requested = location.state?.tab;
  const [tab, setTab] = useState(TABS.some(([id]) => id === requested) ? requested : TABS[0]?.[0]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Templates</h1>
        <p className="text-sm text-gray-500 mt-0.5">Emails, session notes, agreements, forms and reports</p>
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
      {tab === 'session_note' && <BodyTemplates key="session_note" type="session_note" vars={NOTE_VARS}
        description="Starting text for session notes. Practitioners pick one when writing a note."
        empty="No session note templates yet." namePlaceholder="e.g. NDIS Session Note" />}
      {tab === 'agreement'    && <BodyTemplates key="agreement" type="agreement" vars={AGREEMENT_VARS} withPricing
        description="Service agreements sent to clients to sign."
        empty="No agreement templates yet." namePlaceholder="e.g. Service Agreement" />}
      {tab === 'forms'        && <FormTemplates />}
      {tab === 'reports'      && <ReportTemplates embedded />}
    </div>
  );
}
