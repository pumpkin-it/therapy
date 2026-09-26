import { useCallback, useRef } from 'react';
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle, Color, FontFamily, FontSize } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import { Placeholder, CharacterCount } from '@tiptap/extensions';
import api from '../../lib/api';
import { ClientField, PracticeLogo, PageBreak, stripUnloadableImages, prepareImage } from './extensions';
import { installReportFonts } from './fonts';
import './report-doc.css';

installReportFonts();

// The one editor setup shared by report writing (pages/ReportEditor.jsx) and report templates
// (pages/ReportTemplateEditor.jsx), so a template always looks and behaves exactly like the
// reports made from it.
//   uploadUrl  — where pasted/dropped/picked pictures are uploaded
//   getFields  — () => field values (client name etc.); ignored when showLabels is set
//   showLabels — templates: show each field's name instead of a value
//   onUpdate   — called with the editor on every change
//   onNotice   — called with a message for the user (e.g. pictures dropped from a Word paste)
export default function useDocEditor({ uploadUrl, getFields = () => ({}), showLabels = false, onUpdate, onNotice, placeholder }) {
  const editorRef = useRef(null);

  const uploadImages = useCallback(async files => {
    for (const f of files) {
      try {
        const prepared = await prepareImage(f);
        const fd = new FormData();
        fd.append('image', prepared);
        const { data } = await api.post(uploadUrl, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        editorRef.current?.chain().focus().setImage({ src: data.url, alt: f.name }).run();
      } catch (e) {
        onNotice?.(e.response?.data?.error || `Couldn't add "${f.name}".`);
      }
    }
  }, [uploadUrl, onNotice]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      TableKit.configure({ table: { resizable: true } }),
      Image.configure({ resize: { enabled: true, directions: ['bottom-right', 'bottom-left'], minWidth: 40, alwaysPreserveAspectRatio: true } }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TextStyle, Color, FontFamily, FontSize,
      Highlight.configure({ multicolor: true }),
      Placeholder.configure({ placeholder: placeholder || 'Start writing your report…' }),
      CharacterCount,
      ClientField.configure({ getFields, showLabels }),
      PracticeLogo,
      PageBreak,
    ],
    editable: false,
    editorProps: {
      attributes: { class: 'report-doc focus:outline-none', spellcheck: 'true' },
      transformPastedHTML(html) {
        const { html: cleaned, dropped } = stripUnloadableImages(html);
        if (dropped) onNotice?.(`${dropped} picture${dropped === 1 ? '' : 's'} from Word couldn't be pasted with the text. Insert ${dropped === 1 ? 'it' : 'them'} with the picture button, or copy and paste each picture on its own.`);
        return cleaned;
      },
      // A copied picture or screenshot on its own (no accompanying HTML — Word also puts an image
      // of the selection on the clipboard, which must not replace the pasted text).
      handlePaste(view, event) {
        const cd = event.clipboardData;
        if (!cd || cd.getData('text/html')) return false;
        const files = [...cd.files].filter(f => f.type.startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        uploadImages(files);
        return true;
      },
      handleDrop(view, event, slice, moved) {
        if (moved) return false;
        const files = [...(event.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        uploadImages(files);
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => onUpdate?.(ed),
  });
  editorRef.current = editor;

  return { editor, uploadImages };
}
