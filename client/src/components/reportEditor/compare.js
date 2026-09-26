import { diffArrays, diffWordsWithSpace } from 'diff';
import { CLIENT_FIELDS } from './extensions';

// Comparing two versions of a written report, like Word's "Compare documents": the report is
// flattened into its blocks (headings, paragraphs, list items, table rows, pictures, page breaks),
// the two block lists are lined up, and an edited block shows its word-level changes.
// Field chips are compared by the VALUE each version froze (a corrected date of birth shows up
// as a change). Formatting-only changes (e.g. making a word bold) aren't shown — text only.

const label = key => CLIENT_FIELDS.find(f => f.key === key)?.label || key;

function inlineText(nodes, fields) {
  return (nodes || []).map(n => {
    if (n.type === 'text') return n.text;
    if (n.type === 'hardBreak') return '\n';
    if (n.type === 'clientField') return fields?.[n.attrs?.key] || `[${label(n.attrs?.key)}]`;
    if (n.type === 'practiceLogo') return '[Practice logo]';
    return inlineText(n.content, fields);
  }).join('');
}

export function toBlocks(doc, fields) {
  const out = [];
  const walk = (nodes, depth = 0) => {
    for (const n of nodes || []) {
      switch (n.type) {
        case 'heading': out.push({ kind: `h${n.attrs?.level || 1}`, text: inlineText(n.content, fields) }); break;
        case 'paragraph': {
          const text = inlineText(n.content, fields);
          if (text.trim() || (n.content || []).length) out.push({ kind: 'p', text });
          break;
        }
        case 'bulletList':
        case 'orderedList':
          (n.content || []).forEach((li, i) => {
            const own = (li.content || []).filter(c => c.type !== 'bulletList' && c.type !== 'orderedList');
            out.push({ kind: 'li', depth, marker: n.type === 'orderedList' ? `${(n.attrs?.start || 1) + i}.` : '•', text: own.map(c => inlineText(c.content, fields)).join(' ') });
            walk((li.content || []).filter(c => c.type === 'bulletList' || c.type === 'orderedList'), depth + 1);
          });
          break;
        case 'table':
          for (const row of n.content || []) {
            out.push({ kind: 'row', cells: (row.content || []).map(c => (c.content || []).map(p => inlineText(p.content, fields)).join(' ')), text: '' });
            out[out.length - 1].text = out[out.length - 1].cells.join(' | ');
          }
          break;
        case 'image': out.push({ kind: 'img', text: `[Picture${n.attrs?.alt ? `: ${n.attrs.alt}` : ''}]`, key: n.attrs?.src }); break;
        case 'pageBreak': out.push({ kind: 'break', text: '— page break —' }); break;
        case 'horizontalRule': out.push({ kind: 'hr', text: '———' }); break;
        case 'blockquote': walk(n.content, depth); break;
        default: if (n.content) walk(n.content, depth);
      }
    }
  };
  walk(doc?.content);
  return out;
}

const keyOf = b => `${b.kind}\u0000${b.depth || 0}\u0000${b.key || ''}\u0000${b.text}`;

// Returns rows of { type: 'same' | 'added' | 'removed' | 'changed', block, parts? } plus counts.
export function compareDocs(oldDoc, oldFields, newDoc, newFields) {
  const a = toBlocks(oldDoc, oldFields);
  const b = toBlocks(newDoc, newFields);
  const runs = diffArrays(a.map(keyOf), b.map(keyOf));
  const rows = [];
  let ai = 0, bi = 0;
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    const n = r.count ?? r.value.length;
    if (!r.added && !r.removed) {
      for (let k = 0; k < n; k++) rows.push({ type: 'same', block: b[bi + k] });
      ai += n; bi += n;
      continue;
    }
    // A removal directly followed by an addition (or the reverse) is an edit: pair the blocks up
    // one-to-one and show word-level changes for pairs of the same kind.
    const next = runs[i + 1];
    const pairWithNext = next && ((r.removed && next.added) || (r.added && next.removed));
    if (pairWithNext) {
      const removedRun = r.removed ? r : next;
      const addedRun = r.added ? r : next;
      const rn = removedRun.count ?? removedRun.value.length;
      const an = addedRun.count ?? addedRun.value.length;
      const oldBlocks = a.slice(ai, ai + rn);
      const newBlocks = b.slice(bi, bi + an);
      const pairs = Math.min(rn, an);
      for (let k = 0; k < pairs; k++) {
        const o = oldBlocks[k], nb = newBlocks[k];
        if (o.kind === nb.kind && o.kind !== 'img' && o.kind !== 'break') {
          rows.push({ type: 'changed', block: nb, parts: diffWordsWithSpace(o.text, nb.text) });
        } else {
          rows.push({ type: 'removed', block: o });
          rows.push({ type: 'added', block: nb });
        }
      }
      for (let k = pairs; k < rn; k++) rows.push({ type: 'removed', block: oldBlocks[k] });
      for (let k = pairs; k < an; k++) rows.push({ type: 'added', block: newBlocks[k] });
      ai += rn; bi += an; i++;
      continue;
    }
    if (r.removed) { for (let k = 0; k < n; k++) rows.push({ type: 'removed', block: a[ai + k] }); ai += n; }
    else { for (let k = 0; k < n; k++) rows.push({ type: 'added', block: b[bi + k] }); bi += n; }
  }
  const counts = { added: 0, removed: 0, changed: 0 };
  for (const r of rows) if (r.type !== 'same') counts[r.type]++;
  return { rows, counts };
}
