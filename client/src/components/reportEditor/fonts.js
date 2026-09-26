// Report fonts. Each Word font name used in reports is mapped to a free font with identical
// character widths (Arimo = Arial, Carlito = Calibri, Caladea = Cambria, Tinos = Times New Roman,
// Gelasio = Georgia) and registered UNDER THE WORD NAME, so a report lays out exactly the same on
// every computer (with or without Office installed) and in the PDF — which embeds the same files
// (server/services/reportFonts.js). That's what keeps the page guides and the PDF's page breaks
// in step. Keep the two lists identical.
import arimo400 from '@fontsource/arimo/files/arimo-latin-400-normal.woff2';
import arimo400i from '@fontsource/arimo/files/arimo-latin-400-italic.woff2';
import arimo700 from '@fontsource/arimo/files/arimo-latin-700-normal.woff2';
import arimo700i from '@fontsource/arimo/files/arimo-latin-700-italic.woff2';
import carlito400 from '@fontsource/carlito/files/carlito-latin-400-normal.woff2';
import carlito400i from '@fontsource/carlito/files/carlito-latin-400-italic.woff2';
import carlito700 from '@fontsource/carlito/files/carlito-latin-700-normal.woff2';
import carlito700i from '@fontsource/carlito/files/carlito-latin-700-italic.woff2';
import caladea400 from '@fontsource/caladea/files/caladea-latin-400-normal.woff2';
import caladea400i from '@fontsource/caladea/files/caladea-latin-400-italic.woff2';
import caladea700 from '@fontsource/caladea/files/caladea-latin-700-normal.woff2';
import caladea700i from '@fontsource/caladea/files/caladea-latin-700-italic.woff2';
import tinos400 from '@fontsource/tinos/files/tinos-latin-400-normal.woff2';
import tinos400i from '@fontsource/tinos/files/tinos-latin-400-italic.woff2';
import tinos700 from '@fontsource/tinos/files/tinos-latin-700-normal.woff2';
import tinos700i from '@fontsource/tinos/files/tinos-latin-700-italic.woff2';
import gelasio400 from '@fontsource/gelasio/files/gelasio-latin-400-normal.woff2';
import gelasio400i from '@fontsource/gelasio/files/gelasio-latin-400-italic.woff2';
import gelasio700 from '@fontsource/gelasio/files/gelasio-latin-700-normal.woff2';
import gelasio700i from '@fontsource/gelasio/files/gelasio-latin-700-italic.woff2';

export const REPORT_FONTS = ['Arial', 'Calibri', 'Cambria', 'Georgia', 'Times New Roman'];

const FACES = {
  'Arial': [arimo400, arimo400i, arimo700, arimo700i],
  'Calibri': [carlito400, carlito400i, carlito700, carlito700i],
  'Cambria': [caladea400, caladea400i, caladea700, caladea700i],
  'Times New Roman': [tinos400, tinos400i, tinos700, tinos700i],
  'Georgia': [gelasio400, gelasio400i, gelasio700, gelasio700i],
};

let installed = false;
// Adds the @font-face rules once. The browser only downloads a file when text actually uses it.
export function installReportFonts() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const variants = [['normal', 400], ['italic', 400], ['normal', 700], ['italic', 700]];
  const css = Object.entries(FACES).flatMap(([family, urls]) => urls.map((url, i) =>
    `@font-face { font-family: '${family}'; src: url(${url}) format('woff2'); font-style: ${variants[i][0]}; font-weight: ${variants[i][1]}; font-display: block; }`
  )).join('\n');
  const style = document.createElement('style');
  style.setAttribute('data-report-fonts', '');
  style.textContent = css;
  document.head.appendChild(style);
}
