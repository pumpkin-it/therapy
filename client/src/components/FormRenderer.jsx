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

function FieldInput({ field, value, onChange, funderOptions }) {
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
    case 'ndis_number':
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

    case 'funder':
      return (
        <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          value={value || ''} onChange={e => onChange(e.target.value)}>
          <option value="">—</option>
          {(funderOptions || []).map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
        </select>
      );

    case 'fund_management':
      return (
        <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          value={value || ''} onChange={e => onChange(e.target.value)}>
          <option value="">—</option>
          {FUND_MANAGEMENT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );

    default:
      return null;
  }
}

export default function FormRenderer({ schema, values, onChange, funderOptions }) {
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
              <FieldInput field={field} value={values[field.id]} onChange={v => onChange(field.id, v)} funderOptions={funderOptions} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
