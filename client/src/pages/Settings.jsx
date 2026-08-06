import { useState, useEffect, useRef } from 'react';
import { Upload, X, Plus, Trash2 } from 'lucide-react';
import api from '../lib/api';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import AddressAutocomplete from '../components/AddressAutocomplete';

export default function Settings() {
  const [form, setForm] = useState({});
  const [saved, setSaved] = useState(false);
  const [logoUrl, setLogoUrl] = useState(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef();

  const [cancelTiers, setCancelTiers] = useState([]);
  const [gstRates, setGstRates] = useState([]);
  const [newGst, setNewGst] = useState({ rate: '', effective_from: '' });

  const SECTIONS = [
    { key: 'calendar',      label: 'Calendar' },
    { key: 'clients',       label: 'Clients' },
    { key: 'funding_periods', label: 'Funding Periods' },
    { key: 'users',         label: 'Users' },
    { key: 'funds_managers',label: 'Funders' },
    { key: 'locations',     label: 'Locations' },
    { key: 'services',      label: 'Services' },
    { key: 'invoices',      label: 'Invoices' },
    { key: 'settings',      label: 'Settings' },
  ];
  const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', practitioner: 'Practitioner', finance: 'Finance' };
  const DEFAULT_PERMS = {
    owner:        { calendar:true,  clients:true,  funding_periods:true,  users:true,  funds_managers:true,  locations:true,  services:true,  invoices:true,  settings:true  },
    admin:        { calendar:true,  clients:true,  funding_periods:true,  users:true,  funds_managers:true,  locations:true,  services:true,  invoices:true,  settings:false },
    practitioner: { calendar:true,  clients:true,  funding_periods:false, users:false, funds_managers:false, locations:true,  services:true,  invoices:false, settings:false },
    finance:      { calendar:false, clients:true,  funding_periods:true,  users:false, funds_managers:true,  locations:false, services:true,  invoices:true,  settings:false },
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
  }, []);

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
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700">Timezone</label>
          <select
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            value={form.timezone || 'Australia/Sydney'}
            onChange={e => set('timezone', e.target.value)}
          >
            <optgroup label="Australia">
              <option value="Australia/Sydney">Australia/Sydney (AEST/AEDT)</option>
              <option value="Australia/Melbourne">Australia/Melbourne (AEST/AEDT)</option>
              <option value="Australia/Brisbane">Australia/Brisbane (AEST)</option>
              <option value="Australia/Adelaide">Australia/Adelaide (ACST/ACDT)</option>
              <option value="Australia/Darwin">Australia/Darwin (ACST)</option>
              <option value="Australia/Perth">Australia/Perth (AWST)</option>
              <option value="Australia/Hobart">Australia/Hobart (AEST/AEDT)</option>
            </optgroup>
            <optgroup label="Pacific">
              <option value="Pacific/Auckland">Pacific/Auckland (NZST/NZDT)</option>
              <option value="Pacific/Fiji">Pacific/Fiji</option>
            </optgroup>
            <optgroup label="Asia">
              <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
              <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
              <option value="Asia/Shanghai">Asia/Shanghai (CST)</option>
              <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
              <option value="Asia/Dubai">Asia/Dubai (GST)</option>
            </optgroup>
            <optgroup label="Europe">
              <option value="Europe/London">Europe/London (GMT/BST)</option>
              <option value="Europe/Paris">Europe/Paris (CET/CEST)</option>
            </optgroup>
            <optgroup label="Americas">
              <option value="America/New_York">America/New_York (EST/EDT)</option>
              <option value="America/Chicago">America/Chicago (CST/CDT)</option>
              <option value="America/Denver">America/Denver (MST/MDT)</option>
              <option value="America/Los_Angeles">America/Los_Angeles (PST/PDT)</option>
            </optgroup>
            <optgroup label="UTC">
              <option value="UTC">UTC</option>
            </optgroup>
          </select>
          <p className="text-xs text-gray-400">All audit log and activity timestamps will be displayed in this timezone.</p>
        </div>
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

        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">How does your practice manage invoices?</label>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => set('invoicing_mode', 'generate')}
              className={`text-left rounded-lg border-2 px-3 py-2.5 transition-colors ${
                (form.invoicing_mode || 'generate') === 'generate' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'
              }`}>
              <div className="text-sm font-medium text-gray-900">Generate invoices in this system</div>
              <div className="text-xs text-gray-500 mt-0.5">Full invoice lifecycle: generate, send, track paid/void here.</div>
            </button>
            <button type="button" onClick={() => set('invoicing_mode', 'export_only')}
              className={`text-left rounded-lg border-2 px-3 py-2.5 transition-colors ${
                form.invoicing_mode === 'export_only' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'
              }`}>
              <div className="text-sm font-medium text-gray-900">Export to accounting software only</div>
              <div className="text-xs text-gray-500 mt-0.5">e.g. MYOB generates the invoice — this system just exports billing data.</div>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {field('Payment terms (days)', 'invoice_payment_terms_days', 'number')}
          {field('Reminder interval (days)', 'invoice_reminder_interval_days', 'number')}
        </div>
        <p className="text-xs text-gray-400">Reminders are sent automatically to funders for overdue invoices at this interval.</p>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900">Service Agreement Reminders</h2>
          <p className="text-sm text-gray-500 mt-1">Unsigned agreements are automatically re-emailed at this interval until either signed or the reminder window ends.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {field('Reminder interval (days)', 'agreement_reminder_interval_days', 'number')}
          {field('Reminder duration (days)', 'agreement_reminder_duration_days', 'number')}
        </div>
        <p className="text-xs text-gray-400">
          e.g. interval 3 / duration 10 ≈ 3 reminders sent. Sets the default for new agreements — each one's reminder end date can also be changed individually.
        </p>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900">Late Cancellation Policy</h2>
          <p className="text-sm text-gray-500 mt-1">Define tiers by how many business days before the appointment the cancellation occurs (weekends don't count toward the notice period). Tiers are sorted automatically — the shortest window takes priority.</p>
        </div>
        <div className="space-y-2">
          {cancelTiers.length === 0 && (
            <p className="text-sm text-gray-400">No tiers set — all cancellations are free.</p>
          )}
          {cancelTiers.map((tier, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-sm text-gray-600 shrink-0">Within</span>
              <input type="number" min="1" placeholder="business days"
                className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                value={tier.days} onChange={e => setTier(i, 'days', e.target.value)} />
              <span className="text-sm text-gray-600 shrink-0">business days, charge</span>
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
