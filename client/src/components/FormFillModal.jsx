import { useState, useEffect } from 'react';
import api from '../lib/api';
import Modal from './ui/Modal';
import Button from './ui/Button';
import FormRenderer from './FormRenderer';
import { localToday } from '../lib/utils';

const isActivePeriod = p => (!p.start_date || p.start_date === '1111-01-01' || p.start_date <= localToday())
  && (!p.end_date || p.end_date === '9999-09-09' || p.end_date >= localToday());

// Prefill smart fields from the client's own record (and their currently-active funding period,
// if any) so the practitioner isn't retyping data the practice already has. This is display-only
// convenience — submitting the form does NOT write these values back to clients/funding_periods;
// that accept/apply step isn't built yet (see server/database.js's form_templates comment).
function buildInitialAnswers(schema, client, activeFundingPeriod) {
  const answers = {};
  for (const section of schema?.sections || []) {
    for (const field of section.fields) {
      if (field.kind !== 'smart') continue;
      switch (field.type) {
        case 'first_name':      answers[field.id] = client?.first_name || ''; break;
        case 'last_name':       answers[field.id] = client?.last_name || ''; break;
        case 'date_of_birth':   answers[field.id] = client?.date_of_birth || ''; break;
        case 'gender':          answers[field.id] = client?.gender || ''; break;
        case 'address':         answers[field.id] = client?.address || ''; break;
        case 'ndis_number':     answers[field.id] = activeFundingPeriod?.client_identifier || ''; break;
        case 'funder':          answers[field.id] = activeFundingPeriod?.funding_type || ''; break;
        case 'fund_management': answers[field.id] = activeFundingPeriod?.ndis_management || ''; break;
        default: break;
      }
    }
  }
  return answers;
}

export default function FormFillModal({ clientId, client, formTemplate, responseId, onClose, onSaved }) {
  const [schema, setSchema] = useState(formTemplate?.schema || null);
  const [templateName, setTemplateName] = useState(formTemplate?.name || '');
  const [answers, setAnswers] = useState({});
  const [funderOptions, setFunderOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [fundingTypesRes, periodsRes] = await Promise.all([
        api.get('/funding-types'),
        api.get(`/funding-periods?client_id=${clientId}`),
      ]);
      setFunderOptions(fundingTypesRes.data.filter(ft => ft.active));
      const activePeriod = periodsRes.data.find(isActivePeriod);

      if (responseId) {
        const r = await api.get(`/form-responses/${responseId}`);
        setSchema(r.data.template_schema);
        setTemplateName(r.data.template_name);
        setAnswers(r.data.answers);
      } else {
        setAnswers(buildInitialAnswers(formTemplate.schema, client, activePeriod));
      }
      setLoading(false);
    })();
  }, []);

  const setAnswer = (fieldId, value) => setAnswers(a => ({ ...a, [fieldId]: value }));

  const save = async () => {
    setSaving(true);
    try {
      if (responseId) {
        await api.put(`/form-responses/${responseId}`, { answers });
      } else {
        await api.post('/form-responses', { form_template_id: formTemplate.id, client_id: clientId, answers });
      }
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <Modal title={templateName || 'Form'} onClose={onClose} size="xl">
      {loading ? (
        <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
      ) : (
        <div className="space-y-6">
          <FormRenderer schema={schema} values={answers} onChange={setAnswer} funderOptions={funderOptions} />
          <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
            <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
