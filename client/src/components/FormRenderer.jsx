import { useRef, useEffect } from 'react';
import AddressAutocomplete from './AddressAutocomplete';

const GENDER_OPTIONS = ['Male', 'Female', 'Non-binary', 'Other', 'Prefer not to say'];
const FUND_MANAGEMENT_OPTIONS = [
  { value: 'plan', label: 'Plan managed' },
  { value: 'agency', label: 'Agency managed' },
  { value: 'self', label: 'Self managed' },
];

// Uncontrolled date input (defaultValue + ref) — controlled date inputs break mid-typing year
// entry in this codebase's other forms (see ClientDetail.jsx's DateInput); same pattern here.
function DateField({ value, onChange }) {
  const ref = useRef();
  const external = useRef(value);
  useEffect(() => {
    if (external.current !== value && ref.current) { ref.current.value = value || ''; external.current = value; }
  }, [value]);
  return (
    <input ref={ref} type="date" defaultValue={value || ''}
      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
      onChange={e => { external.current = e.target.value; onChange(e.target.value); }} />
  );
}

// The composite funding field: pick a Funder, then reveal only the sub-fields that funding
// type actually needs (per its has_ndis_management / show_period_dates / identifier_label
// settings — edited in Settings → Services & Rates → Funding Types). Its value is a small
// object, not a scalar — { funding_type, ndis_management, funds_manager_id, client_identifier,
// start_date, end_date } — matching the funding_periods columns it's destined to write on
// accept (not built yet).
function FundingDetailsField({ value, onChange, funderOptions, fundsManagerOptions }) {
  const v = value || {};
  const set = patch => onChange({ ...v, ...patch });
  const selectedType = (funderOptions || []).find(f => f.name === v.funding_type);
  const showNdisManagement = !!selectedType?.has_ndis_management;
  const showDates = !!selectedType && selectedType.show_period_dates !== 0;
  const identifierLabel = selectedType?.identifier_label || 'Client ID';

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50/50 p-3">
      <div className="space-y-1">
        <label className="block text-xs font-medium text-gray-600">Funder</label>
        <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          value={v.funding_type || ''} onChange={e => set({ funding_type: e.target.value })}>
          <option value="">—</option>
          {(funderOptions || []).map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
        </select>
      </div>

      {selectedType && (
        <>
          {showNdisManagement && (
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-600">Fund management</label>
              <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                value={v.ndis_management || ''} onChange={e => set({ ndis_management: e.target.value })}>
                <option value="">—</option>
                {FUND_MANAGEMENT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          )}

          {showNdisManagement && v.ndis_management === 'plan' && (
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-600">Fund manager</label>
              <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                value={v.funds_manager_id || ''} onChange={e => set({ funds_manager_id: e.target.value })}>
                <option value="">—</option>
                {(fundsManagerOptions || []).map(fm => <option key={fm.id} value={fm.id}>{fm.name}</option>)}
              </select>
            </div>
          )}

          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-600">{identifierLabel}</label>
            <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              value={v.client_identifier || ''} onChange={e => set({ client_identifier: e.target.value })} />
          </div>

          {showDates && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-600">Start date</label>
                <DateField value={v.start_date} onChange={d => set({ start_date: d })} />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-600">End date</label>
                <DateField value={v.end_date} onChange={d => set({ end_date: d })} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FieldInput({ field, value, onChange, funderOptions, fundsManagerOptions }) {
  switch (field.type) {
    case 'statement':
      return field.content ? <p className="text-sm text-gray-600 whitespace-pre-wrap">{field.content}</p> : null;

    case 'page_break':
      return <hr className="border-t-2 border-dashed border-gray-200" />;

    case 'short_answer':
      return (
        <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          placeholder={field.placeholder || ''} value={value || ''} onChange={e => onChange(e.target.value)} />
      );

    case 'paragraph':
      return (
        <textarea rows={3} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          placeholder={field.placeholder || ''} value={value || ''} onChange={e => onChange(e.target.value)} />
      );

    case 'checkboxes': {
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className="space-y-1.5">
          {field.options.map(opt => (
            <label key={opt} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" className="accent-indigo-600" checked={selected.includes(opt)}
                onChange={e => onChange(e.target.checked ? [...selected, opt] : selected.filter(o => o !== opt))} />
              {opt}
            </label>
          ))}
        </div>
      );
    }

    case 'dropdown':
      return (
        <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          value={value || ''} onChange={e => onChange(e.target.value)}>
          <option value="">—</option>
          {field.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      );

    case 'multiple_choice':
      return (
        <div className="space-y-1.5">
          {field.options.map(opt => (
            <label key={opt} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="radio" className="accent-indigo-600" name={field.id} checked={value === opt} onChange={() => onChange(opt)} />
              {opt}
            </label>
          ))}
        </div>
      );

    case 'file_upload':
      return <p className="text-sm text-gray-400 italic">File attachments aren't supported in forms yet.</p>;

    case 'first_name':
    case 'last_name':
      return (
        <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          value={value || ''} onChange={e => onChange(e.target.value)} />
      );

    case 'date_of_birth':
      return <DateField value={value} onChange={onChange} />;

    case 'gender':
      return (
        <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          value={value || ''} onChange={e => onChange(e.target.value)}>
          <option value="">—</option>
          {GENDER_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
      );

    case 'address':
      return <AddressAutocomplete value={value || ''} onChange={onChange} />;

    case 'funding_details':
      return <FundingDetailsField value={value} onChange={onChange} funderOptions={funderOptions} fundsManagerOptions={fundsManagerOptions} />;

    default:
      return null;
  }
}

export default function FormRenderer({ schema, values, onChange, funderOptions, fundsManagerOptions }) {
  const sections = schema?.sections || [];
  return (
    <div className="space-y-6">
      {sections.map(section => (
        <div key={section.id} className="space-y-4">
          <h3 className="font-semibold text-gray-900 border-b border-gray-100 pb-2">{section.title}</h3>
          {section.fields.map(field => (
            <div key={field.id} className="space-y-1">
              {field.type !== 'statement' && field.type !== 'page_break' && (
                <label className="block text-sm font-medium text-gray-700">
                  {field.label}{field.required && <span className="text-red-500 ml-0.5">*</span>}
                </label>
              )}
              <FieldInput field={field} value={values[field.id]} onChange={v => onChange(field.id, v)} funderOptions={funderOptions} fundsManagerOptions={fundsManagerOptions} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
