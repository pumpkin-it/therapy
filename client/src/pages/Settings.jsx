import { useState, useEffect } from 'react';
import api from '../lib/api';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';

export default function Settings() {
  const [form, setForm] = useState({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get('/settings').then(r => setForm(r.data));
  }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    await api.patch('/settings', form);
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
        {field('Address', 'practice_address')}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
        <h2 className="font-semibold text-gray-900">Email (SMTP)</h2>
        <p className="text-sm text-gray-500">Used for sending invoices directly to clients.</p>
        <div className="grid grid-cols-2 gap-3">
          {field('SMTP host',   'smtp_host')}
          {field('Port',        'smtp_port', 'number')}
          {field('Username',    'smtp_user')}
          {field('Password',    'smtp_pass', 'password')}
          {field('From name',   'smtp_from_name')}
          {field('From email',  'smtp_from_email', 'email')}
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox"
            checked={form.smtp_secure === '1'}
            onChange={e => set('smtp_secure', e.target.checked ? '1' : '0')} />
          Use TLS / SSL
        </label>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
        <h2 className="font-semibold text-gray-900">Invoicing</h2>
        <div className="grid grid-cols-2 gap-3">
          {field('GST rate (e.g. 0.1 for 10%)', 'tax_rate', 'number')}
        </div>
      </section>

      <div className="flex items-center gap-3">
        <Button onClick={save}>Save settings</Button>
        {saved && <span className="text-sm text-green-600">Saved!</span>}
      </div>
    </div>
  );
}
