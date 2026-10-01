import { useEffect, useRef, useState } from 'react';
import { ImageOff } from 'lucide-react';
import api from '../../lib/api';
import { Highlight, highlightDocument } from '../../lib/highlight';

// An email's body. HTML is already cleaned on the server; it's shown in a sandboxed frame where
// nothing can run, and pictures from the internet stay blocked until someone asks for them
// (they can tell the sender the email was opened).
export default function EmailBody({ message, terms = [] }) {
  const [html, setHtml] = useState(null);
  const [error, setError] = useState('');
  const [showRemote, setShowRemote] = useState(false);
  const frameRef = useRef(null);

  useEffect(() => {
    setHtml(null); setError(''); setShowRemote(false);
    if (!message.has_html) return undefined;
    let live = true;
    api.get(`/email/messages/${message.id}/html`, { responseType: 'text', transformResponse: r => r })
      .then(r => { if (live) setHtml(r.data); })
      .catch(() => { if (live) setError('Could not load this email'); });
    return () => { live = false; };
  }, [message.id, message.has_html]);

  const hasRemote = html && /<img[^>]+src="https?:/i.test(html);
  const csp = `default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:${showRemote ? ' https: http:' : ''}`;
  const srcDoc = html == null ? '' : `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<base target="_blank">
<style>body{margin:0;padding:4px;font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:14px;color:#111827;word-wrap:break-word}img{max-width:100%;height:auto}table{max-width:100%}</style>
</head><body>${html}</body></html>`;

  // Grow the frame to fit its content (same-origin frame, scripts still disabled inside it), mark
  // the searched words and bring the first one into view.
  const fit = () => {
    const doc = frameRef.current?.contentDocument;
    if (!doc?.body) return;
    const first = highlightDocument(doc, terms);
    frameRef.current.style.height = `${Math.max(120, doc.documentElement.scrollHeight + 8)}px`;
    if (first) first.scrollIntoView({ block: 'center' });
  };

  if (!message.has_html) {
    return <pre className="whitespace-pre-wrap break-words font-sans text-sm text-gray-800">{message.body_text ? <Highlight text={message.body_text} terms={terms} /> : '(no text)'}</pre>;
  }
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (html == null) return <p className="text-sm text-gray-400">Loading…</p>;
  return (
    <div>
      {hasRemote && !showRemote && (
        <button type="button" onClick={() => setShowRemote(true)}
          className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-200">
          <ImageOff className="h-3.5 w-3.5" /> Pictures from the internet are hidden — show them
        </button>
      )}
      <iframe ref={frameRef} key={`${showRemote ? 'remote' : 'local'}|${terms.join(' ')}`} title="Email body" srcDoc={srcDoc} onLoad={fit}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        className="w-full border-0" style={{ height: 200 }} />
    </div>
  );
}
