const fs = require('fs');
const path = require('path');

// The same font files the editor uses (client/src/components/reportEditor/fonts.js), registered
// under the Word names so the PDF lays out exactly like the editor. Keep the two lists identical.
const FAMILIES = {
  'Arial': 'arimo',
  'Calibri': 'carlito',
  'Cambria': 'caladea',
  'Times New Roman': 'tinos',
  'Georgia': 'gelasio',
};
const VARIANTS = [['normal', 400], ['italic', 400], ['normal', 700], ['italic', 700]];
const cache = new Map();

function fontFaceCss(families) {
  const wanted = families.filter(f => FAMILIES[f]);
  return wanted.flatMap(family => VARIANTS.map(([style, weight]) => {
    const pkg = FAMILIES[family];
    const file = path.join(__dirname, `../node_modules/@fontsource/${pkg}/files/${pkg}-latin-${weight}-${style}.woff2`);
    if (!cache.has(file)) cache.set(file, fs.readFileSync(file).toString('base64'));
    return `@font-face { font-family: '${family}'; src: url(data:font/woff2;base64,${cache.get(file)}) format('woff2'); font-style: ${style}; font-weight: ${weight}; }`;
  })).join('\n');
}

module.exports = { fontFaceCss, REPORT_FONT_NAMES: Object.keys(FAMILIES) };
