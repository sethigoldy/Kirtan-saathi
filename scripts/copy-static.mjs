// Assembles renderer assets into dist/ after both TypeScript builds.
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

mkdirSync('dist/static/fonts', { recursive: true });
mkdirSync('dist/renderer', { recursive: true });

for (const f of readdirSync('static')) {
  if (f === 'index.html') continue;
  cpSync(join('static', f), join('dist/static', f), { recursive: true });
}
copyFileSync('static/index.html', 'dist/renderer/index.html');
copyFileSync('dist/renderer-build/renderer/renderer.js', 'dist/renderer/renderer.js');
// Presentation page (projector, overlay, follow), served by the local server.
for (const f of ['present.js', 'format.js']) {
  copyFileSync(join('dist/renderer-build/present', f), join('dist/static/present', f));
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
