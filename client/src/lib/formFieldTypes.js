// Smart fields bind to a real column and are written back to the client/funding_periods record
// once a submitted form is accepted (that accept step isn't built yet — see server/database.js's
// form_templates/form_responses comment block for the full contract). Each `binding` here matches
// exactly one column, never a composite, EXCEPT 'funding_details' — see its own note below.
export const SMART_FIELDS = [
  { type: 'first_name',      label: 'First name',       binding: 'client.first_name' },
  { type: 'last_name',       label: 'Last name',        binding: 'client.last_name' },
  { type: 'date_of_birth',   label: 'Date of birth',    binding: 'client.date_of_birth' },
  { type: 'gender',          label: 'Gender identity',  binding: 'client.gender' },
  { type: 'address',         label: 'Address',          binding: 'client.address' },
  // Composite — one field that renders a Funder select (funding_period.funding_type), then
  // conditionally reveals Fund management + Fund manager (only when the selected funding_type's
  // has_ndis_management is set) and Start/End date (only when its show_period_dates is set),
  // plus an identifier input always shown and labeled per that funding type's identifier_label
  // (e.g. "NDIS number" vs "Medicare number" vs generic "Client ID"). Its answer is a small
  // object, not a scalar: { funding_type, ndis_management, funds_manager_id, client_identifier,
  // start_date, end_date }. binding is 'funding_period.*' because accept must write the whole
  // object into one funding_periods row, not a single column.
  { type: 'funding_details', label: 'Funding details',  binding: 'funding_period.*' },
];

// Generic/custom fields — answers only ever live in form_responses.answers_json, never written
// back to a client/funding_periods column.
export const CUSTOM_FIELD_CATEGORIES = [
  { category: 'Statement', fields: [
    { type: 'statement', label: 'Text block' },
  ]},
  { category: 'Text', fields: [
    { type: 'short_answer', label: 'Short answer' },
    { type: 'paragraph',    label: 'Paragraph' },
    { type: 'page_break',   label: 'Page break' },
  ]},
  { category: 'Choices', fields: [
    { type: 'checkboxes',      label: 'Checkboxes' },
    { type: 'dropdown',        label: 'Dropdown' },
    { type: 'multiple_choice', label: 'Multiple choice' },
  ]},
  { category: 'Attachments', fields: [
    { type: 'file_upload', label: 'File upload' },
  ]},
];

const ALL_CUSTOM = CUSTOM_FIELD_CATEGORIES.flatMap(c => c.fields);
const TYPE_META = Object.fromEntries([
  ...SMART_FIELDS.map(f => [f.type, { ...f, kind: 'smart' }]),
  ...ALL_CUSTOM.map(f => [f.type, { ...f, kind: 'custom' }]),
]);

export function fieldTypeMeta(type) {
  return TYPE_META[type];
}

// Field shapes: { id, kind, type, label, required, options?, binding? }
export function makeField(type) {
  const meta = TYPE_META[type];
  const base = { id: crypto.randomUUID(), kind: meta.kind, type, label: meta.label, required: false };
  if (meta.kind === 'smart') base.binding = meta.binding;
  if (['checkboxes', 'dropdown', 'multiple_choice'].includes(type)) base.options = ['Option 1'];
  if (['short_answer', 'paragraph'].includes(type)) base.placeholder = '';
  if (type === 'statement') { base.content = ''; delete base.required; }
  if (type === 'page_break') delete base.required;
  return base;
}

export function makeSection(title = 'New section') {
  return { id: crypto.randomUUID(), title, fields: [] };
}
