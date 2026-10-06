// Email programs put a gap above and below every <p>, so a signature written one line per paragraph
// comes out double-spaced. Outlook writes its own email paragraphs with no margin and uses an empty
// paragraph for a blank line; this does the same to HTML written in Therapy's editor before sending.
function tightParagraphs(html) {
  return String(html || '')
    // An empty paragraph is a deliberate blank line: keep it visible.
    .replace(/<p([^>]*)>\s*(<br\s*\/?>)?\s*<\/p>/gi, '<p$1>&nbsp;</p>')
    // No gap around paragraphs (an existing style is kept; its own margin wins if it sets one).
    .replace(/<p(\s[^>]*)?>/gi, (tag, attrs = '') => {
      if (/\bstyle\s*=\s*["'][^"']*\bmargin\b/i.test(attrs)) return tag;
      if (/\bstyle\s*=\s*["']/i.test(attrs)) return `<p${attrs.replace(/\bstyle\s*=\s*(["'])/i, 'style=$1margin:0;')}>`;
      return `<p${attrs} style="margin:0">`;
    });
}

module.exports = { tightParagraphs };
