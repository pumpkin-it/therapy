import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import api from '../lib/api';
import Button from '../components/ui/Button';

export default function SignAgreement() {
  const { token } = useParams();
  const [agreement, setAgreement] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // null | 'signed' | 'declined'

  const load = () => api.get(`/sign/${token}`).then(r => setAgreement(r.data)).catch(() => setNotFound(true));
  useEffect(() => { load(); }, [token]);

  const sign = async () => {
    setSubmitting(true);
    try {
      await api.post(`/sign/${token}`, { signer_name: signerName });
      setResult('signed');
    } finally { setSubmitting(false); }
  };

  const decline = async () => {
    if (!confirm('Decline this agreement?')) return;
    await api.post(`/sign/${token}/decline`);
    setResult('declined');
  };

  if (notFound) {
    return <div className="max-w-2xl mx-auto py-16 px-4 text-center text-gray-500">This link is invalid or has expired.</div>;
  }
  if (!agreement) return <div className="max-w-2xl mx-auto py-16 px-4 text-center text-gray-400">Loading…</div>;

  const finalStatus = result || agreement.status;
  const alreadyDone = ['signed', 'declined', 'voided'].includes(finalStatus);

  return (
    <div className="max-w-2xl mx-auto py-10 px-4 space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">{agreement.title}</h1>

      {alreadyDone ? (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6 text-center space-y-2">
          {finalStatus === 'signed' && <p className="text-green-700 font-medium">This agreement has been signed{agreement.signed_at ? ` on ${new Date(agreement.signed_at).toLocaleDateString('en-AU')}` : ''}.</p>}
          {finalStatus === 'declined' && <p className="text-red-600 font-medium">This agreement was declined.</p>}
          {finalStatus === 'voided' && <p className="text-gray-500 font-medium">This agreement is no longer available.</p>}
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6 prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: agreement.rendered_html }} />

          <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6 space-y-4">
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Full name</label>
              <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                value={signerName} onChange={e => setSignerName(e.target.value)} placeholder="Type your full name to sign" />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" className="accent-indigo-600" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
              I have read and agree to the terms above.
            </label>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={decline}>Decline</Button>
              <Button onClick={sign} disabled={!agreed || !signerName.trim() || submitting}>
                {submitting ? 'Signing…' : 'Sign & Submit'}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
