import { useState, useEffect, useRef } from 'react';
import { Upload, X, Plus, Trash2, Pencil } from 'lucide-react';
import api from '../lib/api';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import AddressAutocomplete from '../components/AddressAutocomplete';
import { DEFAULT_TIMEZONE, TIMEZONES } from '../lib/utils';
import { useSettings } from '../context/SettingsContext';

export default function Settings() {
  const { reload: reloadSettings } = useSettings();
  const [form, setForm] = useState({});
  const [saved, setSaved] = useState(false);
  const [logoUrl, setLogoUrl] = useState(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef();

  const [cancelTiers, setCancelTiers] = useState([]);
  const [gstRates, setGstRates] = useState([]);
  const [newGst, setNewGst] = useState({ rate: '', effective_from: '' });
  const [fundingTypes, setFundingTypes] = useState([]);
  const [ftEdit, setFtEdit] = useState(null); // null | { id?, name, color, has_ndis_management }

  const SECTIONS = [
    { key: 'calendar',      label: 'Calendar' },
    { key: 'clients',       label: 'Clients' },
    { key: 'users',         label: 'Users' },
    { key: 'funds_managers',label: 'Funders' },
    { key: 'locations',     label: 'Locations' },
    { key: 'services',      label: 'Services' },
    { key: 'invoices',      label: 'Invoices' },
    { key: 'settings',      label: 'Settings' },
  ];
  const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', practitioner: 'Practitioner', finance: 'Finance' };
  const DEFAULT_PERMS = {
    owner:        { calendar:true,  clients:true,  users:true,  funds_managers:true,  locations:true,  services:true,  invoices:true,  settings:true  },
    admin:        { calendar:true,  clients:true,  users:true,  funds_managers:true,  locations:true,  services:true,  invoices:true,  settings:false },
    practitioner: { calendar:true,  clients:true,  users:false, funds_managers:false, locations:true,  services:true,  invoices:false, settings:false },
    finance:      { calendar:false, clients:true,  users:false, funds_managers:true,  locations:false, services:true,  invoices:true,  settings:false },
  };
  const [perms, setPerms] = useState(DEFAULT_PERMS);

  useEffect(() => {
    api.get('/settings').then(r => {
      setForm(r.data);
      try { setCancelTiers(JSON.parse(r.data.cancellation_policy || '[]')); } catch { setCancelTiers([]); }
      try { setPerms(JSON.parse(r.data.role_permissions || '{}')); } catch {}
    });
    api.get('/settings/logo', { responseType: 'blob' })
      .then(r => setLogoUrl(URL.createObjectURL(r.data)))
      .catch(() => setLogoUrl(null));
    api.get('/gst-rates').then(r => setGstRates(r.data));
    api.get('/funding-types').then(r => setFundingTypes(r.data));
  }, []);

  const loadFT = () => api.get('/funding-types').then(r => setFundingTypes(r.data));
  const saveFT = async () => {
    if (!ftEdit?.name) return;
    if (ftEdit.id) await api.patch(`/funding-types/${ftEdit.id}`, ftEdit);
    else await api.post('/funding-types', ftEdit);
    setFtEdit(null); loadFT();
  };
  const deleteFT = async (id) => { await api.delete(`/funding-types/${id}`); loadFT(); };

  const addGstRate = async () => {
    if (!newGst.rate || !newGst.effective_from) return;
    await api.post('/gst-rates', newGst);
    setNewGst({ rate: '', effective_from: '' });
    api.get('/gst-rates').then(r => setGstRates(r.data));
  };

  const deleteGstRate = async (id) => {
    await api.delete(`/gst-rates/${id}`);
    api.get('/gst-rates').then(r => setGstRates(r.data));
  };

  const uploadLogo = async (file) => {
    if (!file) return;
    // Show local preview immediately
    setLogoUrl(URL.createObjectURL(file));
    setLogoUploading(true);
    try {
      const fd = new FormData();
      fd.append('logo', file);
      await api.post('/settings/logo', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    } catch {
      setLogoUrl(null);
    } finally { setLogoUploading(false); }
  };

  const removeLogo = async () => {
    await api.delete('/settings/logo');
    setLogoUrl(null);
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const setTier = (i, k, v) => setCancelTiers(ts => ts.map((t, idx) => idx === i ? { ...t, [k]: v } : t));
  const addTier = () => setCancelTiers(ts => [...ts, { days: '', percent: '' }]);
  const removeTier = i => setCancelTiers(ts => ts.filter((_, idx) => idx !== i));

  const save = async () => {
    const sorted = [...cancelTiers]
      .filter(t => t.days !== '' && t.percent !== '')
      .sort((a, b) => Number(a.days) - Number(b.days));
    await api.patch('/settings', { ...form, cancellation_policy: JSON.stringify(sorted), role_permissions: JSON.stringify(perms) });
    reloadSettings();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const field = (label, key, type = 'text') => (
    <Input label={label} type={type} value={form[key] || ''} onChange={e => set(key, e.target.value)} />
  );

  return (
    <div className="max-w-2xl space-y-8">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
        <h2 className="font-semibold text-gray-900">Practice details</h2>
        <div className="grid grid-cols-2 gap-3">
          {field('Practice name',  'practice_name')}
          {field('ABN',            'practice_abn')}
          {field('Email',          'practice_email', 'email')}
          {field('Phone',          'practice_phone')}
        </div>
        <AddressAutocomplete label="Address" value={form.practice_address || ''} onChange={v => set('practice_address', v)} />
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Time zone</span>
            <select
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              value={form.timezone || DEFAULT_TIMEZONE}
              onChange={e => set('timezone', e.target.value)}
            >
              {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
        </div>
        <p className="text-xs text-gray-500">All timestamps throughout the system are displayed in this time zone.</p>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
        <h2 className="font-semibold text-gray-900">Practice Logo</h2>
        <p className="text-sm text-gray-500">Used on invoices and emails. Max 2 MB.</p>
        <div className="flex items-center gap-4">
          {logoUrl
            ? <img src={logoUrl} alt="Logo" className="h-16 max-w-[200px] object-contain rounded border border-gray-200 p-1" />
            : <div className="h-16 w-32 rounded border-2 border-dashed border-gray-300 flex items-center justify-center text-xs text-gray-400">No logo</div>
          }
          <div className="flex flex-col gap-2">
            <input ref={logoInputRef} type="file" accept="image/*" className="hidden"
              onChange={e => uploadLogo(e.target.files[0])} />
            <Button variant="secondary" size="sm" onClick={() => logoInputRef.current.click()} disabled={logoUploading}>
              <Upload className="h-3.5 w-3.5" /> {logoUploading ? 'Uploading…' : logoUrl ? 'Replace logo' : 'Upload logo'}
            </Button>
            {logoUrl && (
              <Button variant="ghost" size="sm" onClick={removeLogo}>
                <X className="h-3.5 w-3.5 text-red-400" /> Remove
              </Button>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
        <h2 className="font-semibold text-gray-900">Integrations</h2>
        {field('Google Maps API Key', 'google_maps_api_key')}
        <p className="text-xs text-gray-400">Used for address autocomplete. Requires Places API enabled.</p>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900">Funding Types</h2>
          <p className="text-xs text-gray-400 mt-1">Manage the funding types available when setting up client funding periods.</p>
        </div>
        <div className="space-y-2">
          {fundingTypes.map(ft => (
            <div key={ft.id} className="flex items-center gap-3 text-sm">
              <span className="font-mono text-xs text-gray-400 w-16">FT-{String(ft.id).padStart(5,'0')}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                { blue:'bg-blue-100 text-blue-700', green:'bg-green-100 text-green-700', purple:'bg-purple-100 text-purple-700',
                  orange:'bg-orange-100 text-orange-700', red:'bg-red-100 text-red-700', amber:'bg-amber-100 text-amber-700',
                  gray:'bg-gray-100 text-gray-700', indigo:'bg-indigo-100 text-indigo-700', pink:'bg-pink-100 text-pink-700',
                  teal:'bg-teal-100 text-teal-700' }[ft.color] || 'bg-gray-100 text-gray-700'
              }`}>{ft.name}</span>
              {ft.has_ndis_management ? <span className="text-xs text-indigo-500">NDIS management</span> : null}
              <div className="ml-auto flex gap-1">
                <button onClick={() => setFtEdit({ id: ft.id, name: ft.name, color: ft.color, has_ndis_management: ft.has_ndis_management })} className="text-gray-400 hover:text-gray-600"><Pencil className="h-3.5 w-3.5" /></button>
                <button onClick={() => deleteFT(ft.id)} className="text-red-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
        {ftEdit ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <input className="rounded border border-gray-300 px-2 py-1.5 text-sm" placeholder="Name"
                value={ftEdit.name} onChange={e => setFtEdit(f => ({ ...f, name: e.target.value }))} />
              <select className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                value={ftEdit.color} onChange={e => setFtEdit(f => ({ ...f, color: e.target.value }))}>
                {['blue','green','purple','orange','red','amber','gray','indigo','pink','teal'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" className="accent-indigo-600" checked={!!ftEdit.has_ndis_management}
                  onChange={e => setFtEdit(f => ({ ...f, has_ndis_management: e.target.checked }))} />
                NDIS management options
              </label>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={saveFT}>{ftEdit.id ? 'Save' : 'Add'}</Button>
              <Button size="sm" variant="secondary" onClick={() => setFtEdit(null)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setFtEdit({ name: '', color: 'gray', has_ndis_management: false })}>
            <Plus className="h-3.5 w-3.5" /> Add funding type
          </Button>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900">GST Rates</h2>
          <p className="text-xs text-gray-400 mt-1">Services are assigned a GST type (GST / GST Free / N-T). The GST percentage is set here globally with an effective date — rate changes only apply to invoices after that date.</p>
        </div>
        <div className="space-y-2">
          {gstRates.map(r => (
            <div key={r.id} className="flex items-center gap-3 text-sm">
              <span className="font-medium text-gray-900 w-16">{Math.round(r.rate * 100)}%</span>
              <span className="text-gray-500">from {r.effective_from}</span>
              {gstRates.length > 1 && (
                <button onClick={() => deleteGstRate(r.id)} className="text-red-400 hover:text-red-600 ml-auto">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <label className="text-xs text-gray-500">New rate (%)</label>
            <input type="number" min="0" step="1" placeholder="e.g. 15"
              className="w-20 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              value={newGst.rate} onChange={e => setNewGst(g => ({ ...g, rate: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-gray-500">Effective from</label>
            <input type="date"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              value={newGst.effective_from} onChange={e => setNewGst(g => ({ ...g, effective_from: e.target.value }))} />
          </div>
          <Button variant="secondary" size="sm" onClick={addGstRate} disabled={!newGst.rate || !newGst.effective_from}>
            <Plus className="h-3.5 w-3.5" /> Add rate
          </Button>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
        <h2 className="font-semibold text-gray-900">Banking / Payment Details</h2>
        <p className="text-xs text-gray-400">Shown at the bottom of invoices.</p>
        <div className="grid grid-cols-2 gap-3">
          {field('Account name', 'bank_account_name')}
          {field('BSB', 'bank_bsb')}
          {field('Account number', 'bank_account_number')}
          {field('Remittance email', 'remittance_email', 'email')}
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
        <h2 className="font-semibold text-gray-900">Invoice Settings</h2>
        <div className="grid grid-cols-2 gap-3">
          {field('Payment terms (days)', 'invoice_payment_terms_days', 'number')}
          {field('Reminder interval (days)', 'invoice_reminder_interval_days', 'number')}
        </div>
        <p className="text-xs text-gray-400">Reminders are sent automatically to funders for overdue invoices at this interval.</p>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900">Late Cancellation Policy</h2>
          <p className="text-sm text-gray-500 mt-1">Define tiers by how many days before the appointment the cancellation occurs. Tiers are sorted automatically — the shortest window takes priority.</p>
        </div>
        <div className="space-y-2">
          {cancelTiers.length === 0 && (
            <p className="text-sm text-gray-400">No tiers set — all cancellations are free.</p>
          )}
          {cancelTiers.map((tier, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-sm text-gray-600 shrink-0">Within</span>
              <input type="number" min="1" placeholder="days"
                className="w-20 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                value={tier.days} onChange={e => setTier(i, 'days', e.target.value)} />
              <span className="text-sm text-gray-600 shrink-0">days, charge</span>
              <input type="number" min="0" max="100" placeholder="%"
                className="w-20 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                value={tier.percent} onChange={e => setTier(i, 'percent', e.target.value)} />
              <span className="text-sm text-gray-600 shrink-0">%</span>
              <button onClick={() => removeTier(i)} className="ml-1 text-gray-400 hover:text-red-500">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <Button variant="secondary" size="sm" onClick={addTier}>
          <Plus className="h-3.5 w-3.5" /> Add tier
        </Button>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900">Role Permissions</h2>
          <p className="text-sm text-gray-500 mt-1">Control which sections each role can access.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left font-medium text-gray-500 pb-2 pr-4 w-36">Section</th>
                {Object.keys(ROLE_LABELS).map(role => (
                  <th key={role} className="text-center font-medium text-gray-700 pb-2 px-3 min-w-[90px]">
                    {ROLE_LABELS[role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {SECTIONS.map(sec => (
                <tr key={sec.key}>
                  <td className="py-2 pr-4 text-gray-700">{sec.label}</td>
                  {Object.keys(ROLE_LABELS).map(role => {
                    const checked = perms[role]?.[sec.key] ?? false;
                    const isOwner = role === 'owner';
                    return (
                      <td key={role} className="py-2 px-3 text-center">
                        <input type="checkbox"
                          className="h-4 w-4 accent-indigo-600"
                          checked={isOwner ? true : checked}
                          disabled={isOwner}
                          onChange={e => setPerms(p => ({
                            ...p,
                            [role]: { ...p[role], [sec.key]: e.target.checked }
                          }))} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400">Owner always has full access and cannot be restricted.</p>
      </section>

      <div className="flex items-center gap-3">
        <Button onClick={save}>Save settings</Button>
        {saved && <span className="text-sm text-green-600">Saved!</span>}
      </div>
    </div>
  );
}
