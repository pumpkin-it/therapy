import Image from '@tiptap/extension-image';
import { NodeSelection } from '@tiptap/pm/state';

// Pictures come in two kinds, as in Word:
//   image       — on its own line, aligned left (default), centre or right ("align")
//   inlineImage — in line with text, e.g. a signature after "Signature:", sitting on the line or
//                 centred against the text ("valign": null = on the line, 'middle')
// Both are stored with their alignment in data- attributes, and getHTML() also writes it as inline
// style so emails and session notes show it without the editor's CSS. The PDF renderer
// (server/services/reportHtml.js) prints both the same way.

const RESIZE = { enabled: true, directions: ['bottom-right', 'bottom-left'], minWidth: 40, alwaysPreserveAspectRatio: true };
const BLOCK_STYLE = { center: 'display:block;margin-left:auto;margin-right:auto', right: 'display:block;margin-left:auto' };

// The resize node view puts the picture in a container; keep the alignment on that container
// (data-align / data-valign) so CSS can place it. The style isn't put on the <img> itself — the
// node view copies attributes onto it and would wipe the resized width.
function withPlacement(make, key) {
  if (!make) return null;
  return props => {
    const view = make(props);
    const sync = n => { if (n.attrs[key]) view.dom.dataset[key] = n.attrs[key]; else delete view.dom.dataset[key]; };
    sync(props.node);
    const update = view.update.bind(view);
    view.update = (n, ...rest) => { const ok = update(n, ...rest); if (ok) sync(n); return ok; };
    return view;
  };
}

export const BlockImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: null,
        parseHTML: el => (['center', 'right'].includes(el.getAttribute('data-align')) ? el.getAttribute('data-align') : null),
        renderHTML: a => (a.align ? { 'data-align': a.align } : {}),
      },
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    const style = BLOCK_STYLE[node.attrs.align];
    return ['img', { ...HTMLAttributes, ...(style ? { style } : {}) }];
  },
  addNodeView() { return withPlacement(this.parent?.(), 'align'); },
}).configure({ resize: RESIZE });

export const InlineImage = Image.extend({
  name: 'inlineImage',
  addOptions() { return { ...this.parent?.(), inline: true }; },
  addAttributes() {
    return {
      ...this.parent?.(),
      valign: {
        default: null,
        parseHTML: el => (el.getAttribute('data-valign') === 'middle' ? 'middle' : null),
        renderHTML: a => (a.valign ? { 'data-valign': a.valign } : {}),
      },
    };
  },
  parseHTML() { return [{ tag: 'img[data-inline][src]:not([src^="data:"])', priority: 60 }]; },
  renderHTML({ node, HTMLAttributes }) {
    return ['img', { ...HTMLAttributes, 'data-inline': '', style: `display:inline-block;vertical-align:${node.attrs.valign === 'middle' ? 'middle' : 'baseline'}` }];
  },
  addNodeView() { return withPlacement(this.parent?.(), 'valign'); },
  // Uploads insert a picture on its own line (BlockImage's setImage); no markdown shortcut either.
  addCommands() { return {}; },
  addInputRules() { return []; },
}).configure({ resize: RESIZE });

// The selected picture (either kind), or null.
export function selectedPicture(editor) {
  const node = editor.state.selection.node;
  return node && (node.type.name === 'image' || node.type.name === 'inlineImage') ? node : null;
}

// Switch the selected picture between "on its own line" and "in line with text". A picture moved
// into the text gets its own paragraph (type before it, or drag it next to a word); one moved out
// of the text goes on its own line just after that paragraph.
export function setPictureInline(editor, inline) {
  const { state } = editor;
  const { selection, schema } = state;
  const node = selectedPicture(editor);
  if (!node || (node.type.name === 'inlineImage') === inline) return false;
  const { src, alt, title, width, height } = node.attrs;
  const attrs = { src, alt, title, width, height };
  const tr = state.tr;
  const from = selection.from;
  if (inline) {
    tr.replaceWith(from, from + node.nodeSize, schema.nodes.paragraph.create(null, schema.nodes.inlineImage.create(attrs)));
    tr.setSelection(NodeSelection.create(tr.doc, from + 1));
  } else {
    const $pos = state.doc.resolve(from);
    const block = schema.nodes.image.create(attrs);
    if ($pos.parent.childCount === 1) {
      // The picture was alone in its paragraph: the paragraph becomes the picture.
      tr.replaceWith($pos.before(), $pos.after(), block);
      tr.setSelection(NodeSelection.create(tr.doc, $pos.before()));
    } else {
      tr.delete(from, from + node.nodeSize);
      const at = tr.mapping.map($pos.after());
      tr.insert(at, block);
      tr.setSelection(NodeSelection.create(tr.doc, at));
    }
  }
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  return true;
}
