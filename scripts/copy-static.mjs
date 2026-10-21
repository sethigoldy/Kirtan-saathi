// Assembles renderer assets into dist/ after both TypeScript builds.
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

mkdirSync('dist/static/fonts', { recursive: true });
mkdirSync('dist/renderer/present', { recursive: true });

for (const f of readdirSync('static')) {
  if (f === 'index.html') continue;
  cpSync(join('static', f), join('dist/static', f), { recursive: true });
}
copyFileSync('static/index.html', 'dist/renderer/index.html');
// The operator window shares format.js and ui-words.js with the presentation
// page. Their ES module builds go next to it (dist/present/ holds the main
// process's CommonJS builds), so its imports move from ../present/ to ./present/.
const renderer = readFileSync('dist/renderer-build/renderer/renderer.js', 'utf8');
writeFileSync('dist/renderer/renderer.js', renderer.replaceAll("from '../present/", "from './present/"));
for (const f of ['format.js', 'ui-words.js']) copyFileSync(join('dist/renderer-build/present', f), join('dist/renderer/present', f));
// Presentation page (projector, overlay, follow), served by the local server.
for (const f of ['present.js', 'format.js']) {
  copyFileSync(join('dist/renderer-build/present', f), join('dist/static/present', f));
}

// Anek Gurmukhi (operator interface; SIL OFL 1.1), variable weight and width.
for (const f of ['anek-gurmukhi-latin-wdth-normal.woff2', 'anek-gurmukhi-gurmukhi-wdth-normal.woff2']) {
  copyFileSync(join('node_modules/@fontsource-variable/anek-gurmukhi/files', f), join('dist/static/fonts', f));
}

// Noto Sans Gurmukhi and Devanagari (SIL OFL 1.1), bundled so the app renders offline.
for (const script of ['gurmukhi', 'devanagari']) {
  const fontDir = `node_modules/@fontsource/noto-sans-${script}/files`;
  if (!existsSync(fontDir)) throw new Error(`missing ${fontDir}: run npm install`);
  for (const w of ['400', '600']) {
    const f = `noto-sans-${script}-${script}-${w}-normal.woff2`;
    copyFileSync(join(fontDir, f), join('dist/static/fonts', f));
  }
}
