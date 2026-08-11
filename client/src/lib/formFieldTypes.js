// Smart fields bind to a real column and are written back to the client/funding_periods record
// once a submitted form is accepted (that accept step isn't built yet — see server/database.js's
// form_templates/form_responses comment block for the full contract). Each `binding` here matches
// exactly one column, never a composite, so the future accept step is a straight field write.
export const SMART_FIELDS = [
  { type: 'first_name',      label: 'First name',       binding: 'client.first_name' },
  { type: 'last_name',       label: 'Last name',        binding: 'client.last_name' },
  { type: 'date_of_birth',   label: 'Date of birth',    binding: 'client.date_of_birth' },
  { type: 'gender',          label: 'Gender identity',  binding: 'client.gender' },
  { type: 'address',         label: 'Address',          binding: 'client.address' },
  { type: 'ndis_number',     label: 'NDIS number',      binding: 'client.ndis_number' },
  { type: 'funder',          label: 'Funder',           binding: 'funding_period.funding_type' },
  { type: 'fund_management', label: 'Fund management',  binding: 'funding_period.ndis_management' },
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
