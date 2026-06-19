import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { ArrowLeft, Plus, Pencil, Trash2, AlertTriangle, Upload, Download, File, X, UserX, UserCheck } from 'lucide-react';
import api from '../lib/api';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Input from '../components/ui/Input';
import SearchSelect from '../components/ui/SearchSelect';
import { EmbeddedCalendar } from '../components/CalendarViews';

const FUNDING_COLOR = { NDIS: 'blue', Medicare: 'green', Private: 'purple', 'Aged Care': 'orange', Other: 'gray' };

// ─── Date input helper (reliable cross-browser) ───────────────────────────────
function DateInput({ label, value, onChange }) {
  const ref = useRef();
  const externalVal = useRef(value);
  useEffect(() => {
    if (externalVal.current !== value && ref.current) {
      ref.current.value = value || '';
      externalVal.current = value;
    }
  }, [value]);
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <input ref={ref} type="date"
        defaultValue={value || ''}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        onChange={e => { externalVal.current = e.target.value; onChange(e.target.value); }}
      />
    </div>
  );
}

function ClearableDateInput({ label, value, onChange }) {
  const ref = useRef();
  const externalVal = useRef(value);
  useEffect(() => {
    if (externalVal.current !== value && ref.current) {
      ref.current.value = value || '';
      externalVal.current = value;
    }
  }, [value]);
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-700">{label} <span className="text-gray-400">(optional)</span></label>
      <div className="flex gap-1 items-center">
        <input ref={ref} type="date"
          defaultValue={value || ''}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          onChange={e => { externalVal.current = e.target.value; onChange(e.target.value); }}
        />
        {value && (
          <button type="button" onClick={() => { onChange(''); if (ref.current) { ref.current.value = ''; externalVal.current = ''; } }}
            className="p-1.5 text-gray-400 hover:text-red-500">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Add Funds Manager mini-modal ─────────────────────────────────────────────
function AddFundsManagerInline({ initialName, onClose, onSaved }) {
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try { const res = await api.post('/funds-managers', { name, email }); onSaved(res.data); }
    finally { setSaving(false); }
  };
  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 space-y-2">
      <p className="text-sm font-medium text-indigo-700">New funder</p>
      <div className="grid grid-cols-2 gap-2">
        <Input label="Name" value={name} onChange={e => setName(e.target.value)} />
        <Input label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={save} disabled={saving || !name}>{saving ? 'Saving…' : 'Add'}</Button>
      </div>
    </div>
  );
}

// ─── Funding tab ──────────────────────────────────────────────────────────────
const EMPTY_PERIOD = { funding_type: '', funds_manager_id: '', client_identifier: '', start_date: '', end_date: '' };

function FundingTab({ clientId }) {
  const [periods, setPeriods] = useState([]);
  const [fundsManagers, setFundsManagers] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_PERIOD);
  const [overlapWarning, setOverlapWarning] = useState('');
  const [saving, setSaving] = useState(false);
  const [addFMName, setAddFMName] = useState(null);

  const loadPeriods = () => api.get(`/funding-periods?client_id=${clientId}`).then(r => setPeriods(r.data));
  const loadFMs    = () => api.get('/funds-managers').then(r => setFundsManagers(r.data));
  useEffect(() => { loadPeriods(); loadFMs(); }, []);

  const fmOptions = fundsManagers.map(fm => ({ value: fm.id, label: fm.email ? `${fm.name} — ${fm.email}` : fm.name }));
  const handleAddFM = name => new Promise(resolve => setAddFMName({ name, resolve }));
  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setOverlapWarning(''); };
  const openAdd  = () => { setEditing('new'); setForm(EMPTY_PERIOD); setOverlapWarning(''); };
  const openEdit = p  => { setEditing(p); setForm({ funding_type: p.funding_type, funds_manager_id: p.funds_manager_id || '', client_identifier: p.client_identifier || '', start_date: p.start_date, end_date: p.end_date }); setOverlapWarning(''); };
  const cancel   = () => { setEditing(null); setOverlapWarning(''); };

  const save = async () => {
    setOverlapWarning(''); setSaving(true);
    try {
      if (editing === 'new') await api.post('/funding-periods', { ...form, client_id: clientId, funds_manager_id: form.funds_manager_id || null });
      else await api.patch(`/funding-periods/${editing.id}`, { ...form, funds_manager_id: form.funds_manager_id || null });
      setEditing(null); loadPeriods();
    } catch (e) {
      if (e.response?.status === 422) setOverlapWarning(e.response.data.error);
    } finally { setSaving(false); }
  };

  const remove = async id => {
    if (!confirm('Delete this funding period?')) return;
    await api.delete(`/funding-periods/${id}`); loadPeriods();
  };

  const today = new Date().toISOString().slice(0, 10);
  const isActive = p => (!p.start_date || p.start_date <= today) && (!p.end_date || p.end_date >= today);

  return (
    <div className="space-y-3">
      {periods.length === 0 && !editing && <p className="text-sm text-gray-400 py-4 text-center">No funding periods added yet.</p>}

      {periods.map(p => (
        <div key={p.id} className={`rounded-lg border p-3 ${isActive(p) ? 'border-indigo-200 bg-indigo-50/40' : 'border-gray-200 bg-white'}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Badge color={FUNDING_COLOR[p.funding_type] || 'gray'}>{p.funding_type}</Badge>
                {isActive(p) && <span className="text-xs text-indigo-600 font-medium">Active</span>}
              </div>
              {(p.start_date || p.end_date) && (
                <p className="text-sm text-gray-700 mt-1">
                  {p.start_date ? format(parseISO(p.start_date), 'd MMM yyyy') : '—'} – {p.end_date ? format(parseISO(p.end_date), 'd MMM yyyy') : 'ongoing'}
                </p>
              )}
              {p.funds_manager_name && <p className="text-xs text-gray-500">Funder: {p.funds_manager_name}</p>}
              {p.client_identifier && <p className="text-xs text-gray-500">Client ID: {p.client_identifier}</p>}
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => openEdit(p)} className="text-gray-400 hover:text-gray-600 p-1"><Pencil className="h-3.5 w-3.5" /></button>
              <button onClick={() => remove(p.id)} className="text-red-300 hover:text-red-500 p-1"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        </div>
      ))}

      {editing ? (
        <div className="rounded-lg border border-gray-200 p-4 space-y-3 bg-gray-50">
          <p className="text-sm font-medium text-gray-700">{editing === 'new' ? 'Add funding period' : 'Edit funding period'}</p>
          {overlapWarning && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />{overlapWarning}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Funding type</label>
              <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={form.funding_type} onChange={e => set('funding_type', e.target.value)}>
                <option value="">Select…</option>
                {['NDIS', 'Medicare', 'Private', 'Aged Care', 'Other'].map(f => <option key={f}>{f}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Funder <span className="text-gray-400">(optional)</span></label>
              <SearchSelect options={fmOptions} value={form.funds_manager_id} onChange={v => set('funds_manager_id', v)} placeholder="None" onAddNew={handleAddFM} addNewLabel="Add funder" />
            </div>
            <div className="col-span-2 space-y-1">
              <label className="block text-sm font-medium text-gray-700">Client ID <span className="text-gray-400">(optional)</span></label>
              <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                value={form.client_identifier} onChange={e => set('client_identifier', e.target.value)} placeholder="e.g. NDIS participant number" />
            </div>
            <ClearableDateInput label="Start date" value={form.start_date} onChange={v => set('start_date', v)} />
            <ClearableDateInput label="End date"   value={form.end_date}   onChange={v => set('end_date',   v)} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={cancel}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving || !form.funding_type}>
              {saving ? 'Saving…' : editing === 'new' ? 'Add period' : 'Save changes'}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" size="sm" onClick={openAdd}><Plus className="h-3.5 w-3.5" /> Add funding period</Button>
      )}

      {addFMName && (
        <AddFundsManagerInline
          initialName={addFMName.name}
          onClose={() => setAddFMName(null)}
          onSaved={async fm => {
            await loadFMs();
            set('funds_manager_id', fm.id);
            addFMName.resolve({ value: fm.id, label: fm.email ? `${fm.name} — ${fm.email}` : fm.name });
            setAddFMName(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Files tab ────────────────────────────────────────────────────────────────
function FilesTab({ clientId }) {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef();

  const load = () => api.get(`/client-files?client_id=${clientId}`).then(r => setFiles(r.data));
  useEffect(() => { load(); }, []);

  const upload = async e => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('client_id', clientId);
      await api.post('/client-files', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      load();
    } finally { setUploading(false); e.target.value = ''; }
  };

  const remove = async id => {
    if (!confirm('Delete this file?')) return;
    await api.delete(`/client-files/${id}`);
    load();
  };

  const download = id => {
    const token = localStorage.getItem('token');
    const a = document.createElement('a');
    a.href = `/api/client-files/${id}/download`;
    a.click();
  };

  const fmt = bytes => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <input ref={inputRef} type="file" className="hidden" onChange={upload} />
        <Button size="sm" onClick={() => inputRef.current.click()} disabled={uploading}>
          <Upload className="h-3.5 w-3.5" /> {uploading ? 'Uploading…' : 'Upload file'}
        </Button>
      </div>
      {files.length === 0 && <p className="text-sm text-gray-400 py-6 text-center">No files uploaded yet.</p>}
      {files.map(f => (
        <div key={f.id} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5">
          <File className="h-4 w-4 text-gray-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-800 truncate">{f.original_name}</p>
            <p className="text-xs text-gray-400">{fmt(f.size)} · {format(parseISO(f.created_at), 'd MMM yyyy')}</p>
          </div>
          <button onClick={() => download(f.id)} className="text-indigo-500 hover:text-indigo-700 p-1"><Download className="h-4 w-4" /></button>
          <button onClick={() => remove(f.id)} className="text-red-300 hover:text-red-500 p-1"><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
    </div>
  );
}

// ─── Case Notes tab ───────────────────────────────────────────────────────────
function CaseNotesTab({ clientId }) {
  const [notes, setNotes] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const load = () => api.get(`/case-notes?client_id=${clientId}`).then(r => setNotes(r.data));
  useEffect(() => { load(); }, []);
  const saveEdit = async id => { await api.patch(`/case-notes/${id}`, { note: editText }); setEditingId(null); load(); };
  const remove   = async id => { if (!confirm('Delete this note?')) return; await api.delete(`/case-notes/${id}`); load(); };
  return (
    <div className="space-y-3">
      {notes.length === 0 && <p className="text-sm text-gray-400 py-6 text-center">No case notes yet. Add them from the calendar when editing an appointment.</p>}
      {notes.map(n => (
        <div key={n.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
          {editingId === n.id ? (
            <div className="space-y-2">
              <textarea rows={3} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm resize-none" value={editText} onChange={e => setEditText(e.target.value)} autoFocus />
              <div className="flex gap-2 justify-end">
                <Button variant="secondary" size="sm" onClick={() => setEditingId(null)}>Cancel</Button>
                <Button size="sm" onClick={() => saveEdit(n.id)}>Save</Button>
              </div>
            </div>
          ) : (
            <div className="group flex gap-2">
              <div className="flex-1">
                <p className="text-sm text-gray-800 whitespace-pre-wrap">{n.note}</p>
                <p className="text-xs text-gray-400 mt-1.5">
                  {n.practitioner_name && <span className="font-medium">{n.practitioner_name} · </span>}
                  {format(parseISO(n.created_at), 'd MMM yyyy h:mm a')}
                </p>
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button onClick={() => { setEditingId(n.id); setEditText(n.note); }} className="text-gray-400 hover:text-gray-600"><Pencil className="h-3.5 w-3.5" /></button>
                <button onClick={() => remove(n.id)} className="text-red-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Main detail page ─────────────────────────────────────────────────────────
const EMPTY_FORM = {
  first_name: '', last_name: '', email: '', phone: '', date_of_birth: '', address: '',
  ndis_number: '', notes: '', alert: '',
  emergency_contact_name: '', emergency_contact_phone: '', emergency_contact_relationship: '', emergency_contact_email: '',
  diagnosis: '', allergies: '', regular_medication: '',
};

export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = id === 'new';
  const [client, setClient] = useState(isNew ? {} : null);
  const [tab, setTab] = useState('details');
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = () => {
    if (isNew) return;
    api.get(`/clients/${id}`).then(r => {
      setClient(r.data);
      setForm({
        first_name: r.data.first_name || '',
        last_name:  r.data.last_name  || '',
        email:      r.data.email      || '',
        phone:      r.data.phone      || '',
        date_of_birth: r.data.date_of_birth || '',
        address:    r.data.address    || '',
        ndis_number: r.data.ndis_number || '',
        notes:      r.data.notes      || '',
        alert:      r.data.alert      || '',
        emergency_contact_name:         r.data.emergency_contact_name         || '',
        emergency_contact_phone:        r.data.emergency_contact_phone        || '',
        emergency_contact_relationship: r.data.emergency_contact_relationship || '',
        emergency_contact_email:        r.data.emergency_contact_email        || '',
        diagnosis:         r.data.diagnosis         || '',
        allergies:         r.data.allergies         || '',
        regular_medication: r.data.regular_medication || '',
      });
    });
  };

  useEffect(() => { load(); }, [id]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      if (isNew) {
        const res = await api.post('/clients', form);
        navigate(`/clients/${res.data.id}`, { replace: true });
      } else {
        await api.patch(`/clients/${id}`, form);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        load();
      }
    } finally { setSaving(false); }
  };

  if (!client) return <div className="p-6 text-gray-400">Loading…</div>;

  const TABS = [
    ['details', 'Details'], ['funding', 'Funding'], ['medical', 'Medical'],
    ['notes', 'Case Notes'], ['files', 'Files'], ['calendar', 'Calendar'],
  ];

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/clients')} className="text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className={`text-2xl font-semibold ${client.active === 0 ? 'text-gray-400' : ''}`}>
              {isNew ? 'New Client' : `${client.first_name} ${client.last_name}`}
            </h1>
            {!isNew && client.active === 0 && <span className="text-xs bg-gray-100 text-gray-500 rounded-full px-2 py-0.5 font-medium">Inactive</span>}
          </div>
          {!isNew && client.active_funding_type && (
            <Badge color={FUNDING_COLOR[client.active_funding_type] || 'gray'} className="mt-0.5">{client.active_funding_type}</Badge>
          )}
        </div>
        {!isNew && (
          <button
            onClick={async () => { await api.patch(`/clients/${id}/active`, { active: client.active === 0 ? 1 : 0 }); load(); }}
            className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors ${client.active === 0 ? 'border-green-300 text-green-700 hover:bg-green-50' : 'border-red-200 text-red-500 hover:bg-red-50'}`}
          >
            {client.active === 0 ? <><UserCheck className="h-4 w-4" /> Reactivate</> : <><UserX className="h-4 w-4" /> Deactivate</>}
          </button>
        )}
      </div>

      {/* Alert banner */}
      {client.alert && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-300 px-4 py-3 text-amber-800">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <p className="text-sm font-medium">{client.alert}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <div className="flex gap-0">
          {TABS.map(([tid, label]) => (
            <button key={tid} onClick={() => setTab(tid)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === tid ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        {tab === 'details' && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <Input label="First name" value={form.first_name} onChange={e => set('first_name', e.target.value)} />
              <Input label="Last name"  value={form.last_name}  onChange={e => set('last_name',  e.target.value)} />
              <Input label="Email"      value={form.email}      onChange={e => set('email',      e.target.value)} type="email" />
              <Input label="Phone"      value={form.phone}      onChange={e => set('phone',      e.target.value)} />
              <DateInput label="Date of birth" value={form.date_of_birth} onChange={v => set('date_of_birth', v)} />
              <div className="col-span-1" />
              <div className="col-span-2">
                <Input label="Address" value={form.address} onChange={e => set('address', e.target.value)} />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Alert <span className="text-gray-400 font-normal">(shown prominently on client profile)</span></label>
              <input className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400 placeholder:text-amber-400"
                value={form.alert} onChange={e => set('alert', e.target.value)}
                placeholder="e.g. Latex allergy, do not photograph" />
            </div>

            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Emergency contact</p>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Name"         value={form.emergency_contact_name}         onChange={e => set('emergency_contact_name',         e.target.value)} />
                <Input label="Phone"        value={form.emergency_contact_phone}        onChange={e => set('emergency_contact_phone',        e.target.value)} />
                <Input label="Email" type="email" value={form.emergency_contact_email} onChange={e => set('emergency_contact_email', e.target.value)} />
                <Input label="Relationship" value={form.emergency_contact_relationship} onChange={e => set('emergency_contact_relationship', e.target.value)} placeholder="e.g. Parent" />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Notes</label>
              <textarea rows={3} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none focus:border-indigo-500 focus:outline-none"
                value={form.notes} onChange={e => set('notes', e.target.value)} />
            </div>
          </div>
        )}

        {tab === 'medical' && (
          <div className="space-y-4">
            {[['Diagnosis', 'diagnosis', 3], ['Allergies', 'allergies', 2], ['Regular medication', 'regular_medication', 3]].map(([label, key, rows]) => (
              <div key={key} className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">{label}</label>
                <textarea rows={rows} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none focus:border-indigo-500 focus:outline-none"
                  value={form[key] || ''} onChange={e => set(key, e.target.value)} />
              </div>
            ))}
          </div>
        )}

        {tab === 'funding'   && (isNew ? <p className="text-sm text-gray-400 py-8 text-center">Save the client first to manage funding.</p> : <FundingTab  clientId={id} />)}
        {tab === 'notes'     && (isNew ? <p className="text-sm text-gray-400 py-8 text-center">Save the client first to add notes.</p> : <CaseNotesTab clientId={id} />)}
        {tab === 'files'     && (isNew ? <p className="text-sm text-gray-400 py-8 text-center">Save the client first to upload files.</p> : <FilesTab     clientId={id} />)}
        {tab === 'calendar'  && (isNew ? <p className="text-sm text-gray-400 py-8 text-center">Save the client first to view calendar.</p> : <EmbeddedCalendar clientId={id} />)}
      </div>

      {/* Save bar */}
      {(isNew || tab === 'details' || tab === 'medical') && (
        <div className="flex justify-end gap-2">
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : saved ? '✓ Saved' : isNew ? 'Create client' : 'Save changes'}
          </Button>
        </div>
      )}
    </div>
  );
}
