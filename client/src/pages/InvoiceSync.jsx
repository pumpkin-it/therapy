import { useState } from 'react';
import { Upload, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import api from '../lib/api';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { currency, fmtDate } from '../lib/utils';

const STATUS_ICON = {
  matched: <CheckCircle2 className="h-4 w-4 text-green-600" />,
  ambiguous: <AlertTriangle className="h-4 w-4 text-amber-500" />,
  unmatched: <XCircle className="h-4 w-4 text-gray-400" />,
};

function LinkInvoicesSection() {
  const [preview, setPreview] = useState(null);
  const [choices, setChoices] = useState({}); // key: `${invoiceNo}|${cardId}|${detailDate}` -> Set of appointmentIds
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState(null);

  const rowKey = (invoiceNo, sg) => `${invoiceNo}|${sg.cardId}|${sg.detailDate}`;

  const onFile = async e => {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true); setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post('/myob-sync/preview-tbsale', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setPreview(data.invoiceGroups);
      const initial = {};
      for (const group of data.invoiceGroups) {
        for (const sg of group.subGroups) {
          if (sg.status === 'matched') initial[rowKey(group.invoiceNo, sg)] = new Set([sg.matchedAppointmentId]);
        }
      }
      setChoices(initial);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to read file');
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  };

  const toggleCandidate = (key, id) => setChoices(c => {
    const set = new Set(c[key] || []);
    set.has(id) ? set.delete(id) : set.add(id);
    return { ...c, [key]: set };
  });

  const apply = async () => {
    const links = [];
    for (const group of preview) {
      for (const sg of group.subGroups) {
        const set = choices[rowKey(group.invoiceNo, sg)];
        if (set) for (const id of set) links.push({ appointmentId: id, invoiceNo: group.invoiceNo });
      }
    }
    if (!links.length) return;
    setApplying(true);
    try {
      const { data } = await api.post('/myob-sync/apply-tbsale', { links });
      setResult(data);
      setPreview(null);
    } finally { setApplying(false); }
  };

  const readyCount = preview
    ? preview.reduce((s, g) => s + g.subGroups.reduce((s2, sg) => s2 + (choices[rowKey(g.invoiceNo, sg)]?.size || 0), 0), 0)
    : 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Step 1 — Link MYOB invoice numbers</h2>
        <p className="text-sm text-gray-500 mt-0.5">Upload MYOB's TBSALE export for a batch you've imported. Each line's Invoice No. gets matched back to the appointment it came from.</p>
      </div>

      <label className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer w-fit">
        <Upload className="h-4 w-4" /> {loading ? 'Reading…' : 'Upload TBSALE.csv'}
        <input type="file" accept=".csv" className="hidden" onChange={onFile} disabled={loading} />
      </label>

      {result && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-800">
          Linked {result.linked} appointment{result.linked !== 1 ? 's' : ''} to their MYOB invoice number{result.linked !== 1 ? 's' : ''}.
        </div>
      )}

      {preview && (
        <>
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  {['Invoice No.', 'Date', 'Amount', ''].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {preview.flatMap(group => group.subGroups.map((sg, i) => {
                  const key = rowKey(group.invoiceNo, sg);
                  return (
                    <tr key={key}>
                      <td className="px-4 py-2.5 text-sm font-mono text-gray-700">{i === 0 ? group.invoiceNo : ''}</td>
                      <td className="px-4 py-2.5 text-sm text-gray-600">{sg.detailDate ? fmtDate(sg.detailDate) : '—'}</td>
                      <td className="px-4 py-2.5 text-sm text-gray-900">{currency(sg.amount)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          {STATUS_ICON[sg.status]}
                          {sg.status === 'matched' && (
                            <span className="text-sm text-gray-600">{sg.candidates.find(c => c.id === sg.matchedAppointmentId)?.client_name}</span>
                          )}
                          {sg.status === 'ambiguous' && (
                            <div className="flex flex-col gap-1">
                              <span className="text-xs text-amber-700">
                                No single candidate matches {currency(sg.amount)} — tick every appointment this invoice actually covers (a MYOB invoice can bundle more than one):
                              </span>
                              {sg.candidates.map(c => (
                                <label key={c.id} className="flex items-center gap-2 text-sm text-gray-700">
                                  <input type="checkbox" className="accent-indigo-600"
                                    checked={choices[key]?.has(c.id) || false}
                                    onChange={() => toggleCandidate(key, c.id)} />
                                  {c.client_name} — expected {currency(c.expectedTotal)}
                                </label>
                              ))}
                            </div>
                          )}
                          {sg.status === 'unmatched' && <span className="text-sm text-gray-400">No candidate appointment found</span>}
                        </div>
                      </td>
                    </tr>
                  );
                }))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end">
            <Button onClick={apply} disabled={!readyCount || applying}>
              {applying ? 'Linking…' : `Link ${readyCount} appointment${readyCount !== 1 ? 's' : ''}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function StatusUpdateSection() {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState(null);

  const onFile = async e => {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true); setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post('/myob-sync/preview-status', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setRows(data.rows);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to read file');
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  };

  const applicableRows = rows ? rows.filter(r => r.matchedAppointmentIds.length > 0) : [];

  const apply = async () => {
    const updates = applicableRows.map(r => ({ invoiceNo: r.invoiceNo, status: r.normalizedStatus, amountDue: r.amountDue }));
    setApplying(true);
    try {
      const { data } = await api.post('/myob-sync/apply-status', { updates });
      setResult(data);
      setRows(null);
    } finally { setApplying(false); }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Step 2 — Update invoice status</h2>
        <p className="text-sm text-gray-500 mt-0.5">Upload MYOB's invoice status export (recurring). Matches by Invoice No. — only invoices already linked in Step 1 can be updated.</p>
      </div>

      <label className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer w-fit">
        <Upload className="h-4 w-4" /> {loading ? 'Reading…' : 'Upload invoice status file'}
        <input type="file" accept=".xlsx,.xls" className="hidden" onChange={onFile} disabled={loading} />
      </label>

      {result && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-800">
          Updated {result.appointmentsUpdated} appointment{result.appointmentsUpdated !== 1 ? 's' : ''} across {result.invoicesUpdated} invoice{result.invoicesUpdated !== 1 ? 's' : ''}.
        </div>
      )}

      {rows && (
        <>
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  {['Invoice No.', 'Customer', 'Amount', 'Amt Due', 'Status', ''].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(r => (
                  <tr key={r.invoiceNo}>
                    <td className="px-4 py-2.5 text-sm font-mono text-gray-700">{r.invoiceNo}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-600">{r.customer}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-900">{currency(r.amount)}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-900">{currency(r.amountDue)}</td>
                    <td className="px-4 py-2.5">
                      <Badge color={r.normalizedStatus === 'closed' ? 'green' : 'amber'}>{r.status || r.normalizedStatus}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-sm">
                      {r.matchedAppointmentIds.length > 0 ? (
                        <span className="text-gray-500">will update {r.matchedAppointmentIds.length} appointment{r.matchedAppointmentIds.length !== 1 ? 's' : ''}</span>
                      ) : (
                        <span className="text-gray-400">not linked yet — run Step 1 first</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end">
            <Button onClick={apply} disabled={!applicableRows.length || applying}>
              {applying ? 'Updating…' : `Update ${applicableRows.length} invoice${applicableRows.length !== 1 ? 's' : ''}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export default function InvoiceSync() {
  return (
    <div className="space-y-8">
      <LinkInvoicesSection />
      <div className="border-t border-gray-200" />
      <StatusUpdateSection />
    </div>
  );
}
