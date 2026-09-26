import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import HorizontalRule from '@tiptap/extension-horizontal-rule';

// Fields a report can pull in. The document stores only the key; the value shown comes from the
// server (billableReports.js fieldValues) and will be frozen into the document when it's
// committed. Add new ones here and in fieldValues together.
export const FIELD_GROUPS = [
  { label: 'Client', fields: [
    { key: 'client_name', label: 'Client full name' },
    { key: 'client_first_name', label: 'Client first name' },
    { key: 'client_last_name', label: 'Client last name' },
    { key: 'client_dob', label: 'Client date of birth' },
    { key: 'client_age', label: 'Client age' },
    { key: 'client_address', label: 'Client address' },
    { key: 'client_phone', label: 'Client phone' },
    { key: 'client_email', label: 'Client email' },
  ] },
  { label: 'Funding', fields: [
    { key: 'funding_type', label: 'Funding type' },
    { key: 'funding_number', label: 'NDIS / funding number' },
    { key: 'plan_start', label: 'Plan start date' },
    { key: 'plan_end', label: 'Plan end date' },
  ] },
  { label: 'Practitioner', fields: [
    { key: 'practitioner_name', label: 'Practitioner name' },
    { key: 'practitioner_title', label: 'Practitioner title / qualification' },
    { key: 'provider_number', label: 'Provider number' },
    { key: 'practitioner_email', label: 'Practitioner email' },
    { key: 'practitioner_phone', label: 'Practitioner phone' },
  ] },
  { label: 'Practice', fields: [
    { key: 'practice_name', label: 'Practice name' },
    { key: 'practice_address', label: 'Practice address' },
    { key: 'practice_phone', label: 'Practice phone' },
    { key: 'practice_email', label: 'Practice email' },
    { key: 'practice_abn', label: 'Practice ABN' },
  ] },
  { label: 'Report', fields: [
    { key: 'report_title', label: 'Report title' },
    { key: 'today', label: 'Report date (today)' },
  ] },
];
export const CLIENT_FIELDS = FIELD_GROUPS.flatMap(g => g.fields);

function ClientFieldView({ node, extension, selected }) {
  const field = CLIENT_FIELDS.find(f => f.key === node.attrs.key);
  const label = field?.label || node.attrs.key;
  // In a template there's no client yet — show which field goes here instead of a value.
  if (extension.options.showLabels) {
    return <NodeViewWrapper as="span" className={`client-field is-template${selected ? ' is-selected' : ''}`} title="Filled in when a report is started">{label}</NodeViewWrapper>;
  }
  const value = extension.options.getFields()?.[node.attrs.key];
  return (
    <NodeViewWrapper as="span" className={`client-field${selected ? ' is-selected' : ''}${value ? '' : ' is-empty'}`}
      title={value ? `${label} — filled in automatically` : `${label} — not recorded yet`}>
      {value || `[${label}]`}
    </NodeViewWrapper>
  );
}

// An inline, uneditable chip for one client field — deleted as a whole, never typed into.
export const ClientField = Node.create({
  name: 'clientField',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  // getFields: () => ({ client_name: 'Jane Smith', ... }) — supplied by the editor page once the
  // report has loaded (see ReportEditor.jsx).
  addOptions() { return { getFields: () => ({}), showLabels: false }; },

  addAttributes() {
    return {
      key: {
        default: null,
        parseHTML: el => el.getAttribute('data-client-field'),
        renderHTML: attrs => ({ 'data-client-field': attrs.key }),
      },
    };
  },
  parseHTML() { return [{ tag: 'span[data-client-field]' }]; },
  renderHTML({ HTMLAttributes, node }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'client-field' }), `{{${node.attrs.key}}}`];
  },
  addNodeView() { return ReactNodeViewRenderer(ClientFieldView); },
  addCommands() {
    return {
      insertClientField: key => ({ commands }) => commands.insertContent({ type: this.name, attrs: { key } }),
    };
  },
});

const LOGO_SIZES = { small: 110, medium: 180, large: 260 };
export const LOGO_SIZE_NAMES = Object.keys(LOGO_SIZES);

function PracticeLogoView({ node, selected }) {
  return (
    <NodeViewWrapper as="span" className={`practice-logo${selected ? ' is-selected' : ''}`} title="Practice logo (from Settings)">
      <img src="/api/report-images/practice-logo" alt="Practice logo" style={{ width: LOGO_SIZES[node.attrs.size] || LOGO_SIZES.medium }}
        onError={e => { e.currentTarget.replaceWith(Object.assign(document.createElement('span'), { className: 'practice-logo-missing', textContent: '[Practice logo — add one in Settings]' })); }} />
    </NodeViewWrapper>
  );
}

// The practice logo from Settings — always the current one, so a template never holds a stale copy.
// Inline, so the paragraph's alignment (left / centre / right) positions it.
export const PracticeLogo = Node.create({
  name: 'practiceLogo',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { size: { default: 'medium', parseHTML: el => el.getAttribute('data-size') || 'medium', renderHTML: a => ({ 'data-size': a.size }) } };
  },
  parseHTML() { return [{ tag: 'span[data-practice-logo]' }]; },
  renderHTML({ HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes, { 'data-practice-logo': '' })]; },
  addNodeView() { return ReactNodeViewRenderer(PracticeLogoView); },
  addCommands() {
    return {
      insertPracticeLogo: () => ({ commands }) => commands.insertContent({ type: this.name }),
      setPracticeLogoSize: size => ({ commands }) => commands.updateAttributes(this.name, { size }),
    };
  },
});

// Forces a new page in the PDF. Shown in the editor as a labelled dashed line. Built on TipTap's
// horizontal rule so it gets the same insert behaviour: the cursor lands on the line after the
// break (a new paragraph is added if there isn't one), rather than the break staying selected.
export const PageBreak = HorizontalRule.extend({
  name: 'pageBreak',
  parseHTML() { return [{ tag: 'div[data-page-break]' }]; },
  renderHTML() { return ['div', { 'data-page-break': '', class: 'page-break' }]; },
  addCommands() {
    const { setHorizontalRule } = this.parent();
    return { setPageBreak: setHorizontalRule };
  },
  addInputRules() { return []; }, // no "---" shortcut — that stays a horizontal line
  addKeyboardShortcuts() {
    return { 'Mod-Enter': () => this.editor.commands.setPageBreak() };
  },
});

// Images pasted from Word arrive as <img src="file:///...clip_image001.png"> — a path on the
// author's own computer that the browser can never load, so they'd paste as broken images.
// Strip them (and Word's VML image markup) and report how many were dropped.
export function stripUnloadableImages(html) {
  let dropped = 0;
  const cleaned = convertWordLists(html)
    .replace(/<img\b[^>]*\bsrc\s*=\s*["']?(file:|cid:)[^>]*>/gi, () => { dropped++; return ''; })
    .replace(/<!--\[if gte vml 1\]>[\s\S]*?<!\[endif\]-->/gi, '')
    .replace(/<v:imagedata\b[^>]*>/gi, '');
  return { html: cleaned, dropped };
}

// Word doesn't paste lists as <ul>/<ol>: each item is a <p class="MsoListParagraph..."> with an
// "mso-list:l0 level2 lfo1" style and the bullet or number as literal text in a
// <span style="mso-list:Ignore">. Rebuild real (nested) lists from consecutive list paragraphs so
// bullets stay bullets instead of becoming "·" characters.
function convertWordLists(html) {
  if (!/mso-list/i.test(html)) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const isListPara = el => el?.tagName === 'P' && /mso-list:\s*l\d+\s+level\d+/i.test(el.getAttribute('style') || '');
  const done = new Set();
  for (const first of [...doc.body.querySelectorAll('p')].filter(isListPara)) {
    if (done.has(first)) continue;
    const run = [];
    for (let el = first; isListPara(el); el = el.nextElementSibling) { run.push(el); done.add(el); }
    const anchor = doc.createComment('list');
    first.before(anchor);
    const stack = []; // open lists, outermost first: { level, list, lastLi }
    for (const p of run) {
      const level = Number((p.getAttribute('style').match(/level(\d+)/i) || [])[1] || 1);
      const marker = [...p.querySelectorAll('span')].find(sp => /mso-list:\s*Ignore/i.test(sp.getAttribute('style') || ''));
      const ordered = /^[\dA-Za-z]{1,4}[.)]$/.test((marker?.textContent || '').trim());
      marker?.remove();
      while (stack.length && stack[stack.length - 1].level > level) stack.pop();
      let top = stack[stack.length - 1];
      if (!top || top.level < level) {
        const list = doc.createElement(ordered ? 'ol' : 'ul');
        if (top?.lastLi) top.lastLi.appendChild(list); else anchor.before(list);
        stack.push(top = { level, list, lastLi: null });
      }
      const li = doc.createElement('li');
      const para = doc.createElement('p');
      para.innerHTML = p.innerHTML;
      li.appendChild(para);
      top.list.appendChild(li);
      top.lastLi = li;
      p.remove();
    }
    anchor.remove();
  }
  return doc.body.innerHTML;
}

// Shrinks big photos/screenshots before upload so a report full of images stays quick to open
// and autosave. PNGs under 1.5MB keep their format (sharp diagrams, transparency).
export async function prepareImage(file) {
  if (file.type === 'image/gif' || (file.type === 'image/png' && file.size < 1.5 * 1024 * 1024)) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / bitmap.width);
  if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}

// A {{variable}} in an email, session-note or agreement template, shown as a chip with a readable
// name. Stored as <span data-var="client_name">{{client_name}}</span>, so the {{…}} text the
// server substitutes is still there (mailer.js renderTemplate unwraps the span first).
const ACRONYMS = { abn: 'ABN', ndis: 'NDIS', url: 'URL' };
export const humaniseVar = key => {
  const s = String(key || '').split('_').map(w => ACRONYMS[w] || w).join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const TemplateVar = Node.create({
  name: 'templateVar',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { key: { default: null, parseHTML: el => el.getAttribute('data-var'), renderHTML: a => ({ 'data-var': a.key }) } };
  },
  parseHTML() { return [{ tag: 'span[data-var]' }]; },
  renderHTML({ HTMLAttributes, node }) { return ['span', mergeAttributes(HTMLAttributes), `{{${node.attrs.key}}}`]; },
  renderText({ node }) { return `{{${node.attrs.key}}}`; },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span');
      dom.className = 'client-field is-template';
      dom.textContent = humaniseVar(node.attrs.key);
      dom.title = `Fills in with the ${humaniseVar(node.attrs.key).toLowerCase()} — {{${node.attrs.key}}}`;
      return { dom };
    };
  },
  addCommands() {
    return { insertTemplateVar: key => ({ commands }) => commands.insertContent({ type: this.name, attrs: { key } }) };
  },
});
