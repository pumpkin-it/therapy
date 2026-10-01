import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import { Bold, Italic, Underline, List, ListOrdered, Link2, Undo2, Redo2 } from 'lucide-react';

// A small rich-text box for writing emails: bold/italic/underline, lists and links.
export default function EmailEditor({ value, onChange, placeholder = 'Write your email…', minHeight = 180, autoFocus = false }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, code: false, link: { openOnClick: false, autolink: true, defaultProtocol: 'https' } }),
      Placeholder.configure({ placeholder }),
    ],
    content: value || '',
    // The editable area itself fills the box (minus the py-2 padding), so a click anywhere in the
    // empty box lands in it — not just on the first line.
    editorProps: { attributes: { style: `min-height: ${minHeight - 16}px` } },
    autofocus: autoFocus ? 'start' : false,
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  });

  // Replaced from outside (e.g. a restored draft): show the new content.
  useEffect(() => {
    if (editor && value !== editor.getHTML()) editor.commands.setContent(value || '', { emitUpdate: false });
  }, [value, editor]);

  if (!editor) return null;
  const btn = (active, onClick, Icon, title) => (
    <button type="button" title={title} onMouseDown={e => e.preventDefault()} onClick={onClick}
      className={`rounded p-1.5 ${active ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'}`}>
      <Icon className="h-4 w-4" />
    </button>
  );
  const setLink = () => {
    const prev = editor.getAttributes('link').href || '';
    const url = window.prompt('Link address', prev || 'https://');
    if (url === null) return;
    if (!url.trim() || url.trim() === 'https://') editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };

  return (
    <div className="rounded-lg border border-gray-300 focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500">
      <div className="flex flex-wrap gap-0.5 border-b border-gray-200 px-1.5 py-1">
        {btn(editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), Bold, 'Bold')}
        {btn(editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), Italic, 'Italic')}
        {btn(editor.isActive('underline'), () => editor.chain().focus().toggleUnderline().run(), Underline, 'Underline')}
        {btn(editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run(), List, 'Bullet list')}
        {btn(editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), ListOrdered, 'Numbered list')}
        {btn(editor.isActive('link'), setLink, Link2, 'Link')}
        <span className="mx-1 w-px bg-gray-200" />
        {btn(false, () => editor.chain().focus().undo().run(), Undo2, 'Undo')}
        {btn(false, () => editor.chain().focus().redo().run(), Redo2, 'Redo')}
      </div>
      <EditorContent editor={editor}
        className="email-editor prose prose-sm max-w-none px-3 py-2 text-sm [&_.ProseMirror]:outline-none [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0 [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-gray-400 [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-indigo-600 [&_a]:underline"
        style={{ minHeight }}
        onMouseDown={e => { if (e.target === e.currentTarget) { e.preventDefault(); editor.commands.focus('end'); } }} />
    </div>
  );
}
