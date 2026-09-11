import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import api from '../lib/api';

export default function ReportView() {
  const { token } = useParams();
  const [report, setReport] = useState(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    api.get(`/report-view/${token}`).then(r => setReport(r.data)).catch(() => setNotFound(true));
  }, [token]);

  if (notFound) {
    return <div className="max-w-2xl mx-auto py-16 px-4 text-center text-gray-500">This link is invalid or has expired.</div>;
  }
  if (!report) return <div className="max-w-2xl mx-auto py-16 px-4 text-center text-gray-400">Loading…</div>;

  const fileUrl = `/api/report-view/${token}/file`;

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{report.title}</h1>
        <p className="text-sm text-gray-500">{report.client_name}</p>
      </div>

      {report.status === 'released' ? (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          This report has been released. You can view and download the full document below.
        </div>
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Draft preview only. Report can be downloaded once completed.
        </div>
      )}

      {report.mime_type?.startsWith('image/') ? (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden flex justify-center">
          <img src={fileUrl} alt={report.title} className="max-w-full" />
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden" style={{ height: '80vh' }}>
          <object data={fileUrl} type="application/pdf" className="w-full h-full">
            <p className="p-6 text-sm text-gray-500">
              Your browser can't preview PDFs inline. <a className="text-indigo-600 underline" href={fileUrl} target="_blank" rel="noreferrer">Open the document</a> instead.
            </p>
          </object>
        </div>
      )}
    </div>
  );
}
