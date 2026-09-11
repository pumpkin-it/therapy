import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import api from '../lib/api';
import { downloadFile } from '../lib/utils';

const STATUS_TEXT = {
  pending: { label: 'Draft preview only. Report can be downloaded once completed.', color: 'text-amber-700' },
  released: { label: 'Ready to download.', color: 'text-green-700' },
};

export default function ClientPortal() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const load = () => api.get(`/portal/${token}`).then(r => setData(r.data)).catch(() => setNotFound(true));
  useEffect(() => { load(); }, [token]);

  if (notFound) {
    return <div className="max-w-2xl mx-auto py-16 px-4 text-center text-gray-500">This link is invalid or has expired.</div>;
  }
  if (!data) return <div className="max-w-2xl mx-auto py-16 px-4 text-center text-gray-400">Loading…</div>;

  const openItem = item => {
    const url = `/api/portal/${token}/item/${item.id}/file`;
    if (item.status === 'released') downloadFile(api, url, `${item.title}.pdf`);
    else window.open(url, '_blank');
  };

  return (
    <div className="max-w-2xl mx-auto py-10 px-4 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{data.client_name}</h1>
        <p className="text-sm text-gray-500">Shared documents</p>
      </div>

      {data.items.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">Nothing has been shared yet.</p>
      ) : (
        <div className="space-y-2">
          {data.items.map(item => (
            <div key={item.id} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white shadow-sm px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{item.title}</p>
                <p className={`text-xs ${STATUS_TEXT[item.status].color}`}>{STATUS_TEXT[item.status].label}</p>
              </div>
              <button onClick={() => openItem(item)}
                className={`text-sm px-3 py-1.5 rounded-lg font-medium shrink-0 ${
                  item.status === 'released' ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}>
                {item.status === 'released' ? 'Download' : 'View draft'}
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-400 text-center pt-2">Only items explicitly shared by the practice appear here.</p>
    </div>
  );
}
