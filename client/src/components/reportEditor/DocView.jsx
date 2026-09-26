import { useMemo } from 'react';
import { toEditorHtml } from './docHtml';
import './report-doc.css';

// A saved note or agreement shown in the app with the document's own styles (lists, tables,
// pictures) — old-editor markup and plain-text notes are converted the same way the editor does.
export default function DocView({ html, className = '' }) {
  const clean = useMemo(() => toEditorHtml(html), [html]);
  return <div className={`report-doc doc-view ${className}`} dangerouslySetInnerHTML={{ __html: clean }} />;
}
