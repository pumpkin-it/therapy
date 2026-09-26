import { useEffect, useMemo, useState } from 'react';
import api from '../../lib/api';
import Modal from '../ui/Modal';
import { compareDocs } from './compare';

// Side-by-side isn't practical at A4 width in a modal, so changes are shown inline, Word-style:
// added text green and underlined, removed text red and struck through.

const fmt = iso => new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function BlockText({ row }) {
  if (row.type === 'changed') {
    return row.parts.map((p, i) => (
      p.added ? <ins key={i} className="rounded-sm bg-green-100 text-green-900 underline decoration-green-500">{p.value}</ins>
        : p.removed ? <del key={i} className="rounded-sm bg-red-100 text-red-800 line-through decoration-red-500">{p.value}</del>
          : <span key={i}>{p.value}</span>
    ));
  }
  return row.block.text || ' ';
}

function Block({ row }) {
  const b = row.block;
  const tone = row.type === 'added' ? 'bg-green-50 text-green-900 border-l-4 border-green-400 pl-2'
    : row.type === 'removed' ? 'bg-red-50 text-red-800 line-through decoration-red-400 border-l-4 border-red-300 pl-2'
      : row.type === 'changed' ? 'border-l-4 border-amber-300 pl-2' : 'pl-3';
  const kindCls = { h1: 'text-lg font-bold', h2: 'text-base font-bold', h3: 'font-bold', row: 'font-mono text-[13px]', img: 'italic text-gray-500', break: 'text-center text-xs text-gray-400', hr: 'text-center text-gray-300' }[b.kind] || '';
  const indent = b.kind === 'li' ? { paddingLeft: 12 + (b.depth || 0) * 18 } : undefined;
  return (
    <div className={`py-0.5 ${tone} ${kindCls}`} style={indent}>
      {b.kind === 'li' && <span className="mr-2 text-gray-400">{b.marker}</span>}
      <BlockText row={row} />
    </div>
  );
}

// fromVersion: a committed version number. toVersion: another version number, or 'draft' to
// compare against the text being revised now (passed in as `draft`: { content, fields }).
export default function CompareView({ reportId, fromVersion, toVersion, draft, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [onlyChanges, setOnlyChanges] = useState(true);

  useEffect(() => {
    const get = v => api.get(`/billable-reports/${reportId}/versions/${v}`).then(r => r.data);
    Promise.all([get(fromVersion), toVersion === 'draft' ? Promise.resolve(draft) : get(toVersion)])
      .then(([a, b]) => setData({ a, b }))
      .catch(() => setError('Couldn’t load those versions.'));
  }, [reportId, fromVersion, toVersion]);

  const result = useMemo(() => (data ? compareDocs(data.a.content, data.a.fields, data.b.content, data.b.fields) : null), [data]);

  // Collapse long runs of unchanged blocks, keeping one line of context either side of a change.
  const visible = useMemo(() => {
    if (!result) return [];
    if (!onlyChanges) return result.rows.map(r => ({ row: r }));
    const keep = result.rows.map((r, i) => r.type !== 'same'
      || (result.rows[i - 1] && result.rows[i - 1].type !== 'same') || (result.rows[i + 1] && result.rows[i + 1].type !== 'same'));
    const out = [];
    let skipped = 0;
    result.rows.forEach((r, i) => {
      if (keep[i]) { if (skipped) out.push({ gap: skipped }); skipped = 0; out.push({ row: r }); }
      else skipped++;
    });
    if (skipped) out.push({ gap: skipped });
    return out;
  }, [result, onlyChanges]);

  const toLabel = toVersion === 'draft' ? 'your current changes' : `version ${toVersion}`;
  const total = result ? result.counts.added + result.counts.removed + result.counts.changed : 0;

  return (
    <Modal title={`Version ${fromVersion} compared with ${toLabel}`} onClose={onClose} size="xl">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!result && !error && <p className="py-8 text-center text-sm text-gray-400">Comparing…</p>}
      {result && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-gray-700">
              {total === 0 ? 'No text changes.' : (
                <>{result.counts.changed > 0 && <>{result.counts.changed} edited · </>}
                  <span className="text-green-700">{result.counts.added} added</span> · <span className="text-red-700">{result.counts.removed} removed</span></>
              )}
            </span>
            {data?.a?.committed_at && <span className="text-xs text-gray-400">v{fromVersion}: {fmt(data.a.committed_at)}{data?.b?.committed_at ? ` · v${toVersion}: ${fmt(data.b.committed_at)}` : ''}</span>}
            <label className="ml-auto flex items-center gap-2 text-gray-600">
              <input type="checkbox" checked={onlyChanges} onChange={e => setOnlyChanges(e.target.checked)} /> Show only changes
            </label>
          </div>
          <p className="text-xs text-gray-400">Text changes only — formatting-only changes (bold, colours, fonts) aren’t shown. Client details are compared as each version recorded them.</p>
          <div className="rounded-lg border border-gray-200 bg-white p-4 text-[15px] leading-relaxed">
            {visible.map((v, i) => (v.gap
              ? <div key={i} className="my-1 text-center text-xs text-gray-400">… {v.gap} unchanged {v.gap === 1 ? 'block' : 'blocks'} …</div>
              : <Block key={i} row={v.row} />))}
            {!visible.length && <p className="text-sm text-gray-400">The report is empty.</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}
