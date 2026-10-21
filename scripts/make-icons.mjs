// Renders build/icon.svg into every icon the installers use:
//   build/icon.png   1024 px (Linux, and the source electron-builder resizes)
//   build/icon.ico   Windows, 16–256 px
//   build/icon.icns  macOS, 16–1024 px
//   build/appx/      Microsoft Store tiles (the pothi and waveform alone on
//                    the tile colour for the Start tiles)
//
//   node scripts/make-icons.mjs
//
// Needs a Chromium for Playwright: `npx playwright install chromium`, or set
// CHROMIUM to a Chromium or Chrome executable.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const svg = readFileSync('build/icon.svg', 'utf8');
/** The pothi and waveform without the background (icon.svg coordinates). */
const GLYPH = { cx: 512, cy: 520, w: 712, h: 582 };

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage();

/** A w × h PNG of the icon. With `fill`, only the pothi and waveform, taking that fraction of the image. */
async function render(w, h = w, fill = 0) {
  let s = svg.replace('<svg ', `<svg width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" `);
  if (fill) {
    const k = Math.min((w * fill) / GLYPH.w, (h * fill) / GLYPH.h);
    const vw = w / k;
    const vh = h / k;
    s = s
      .replace('viewBox="0 0 1024 1024"', `viewBox="${GLYPH.cx - vw / 2} ${GLYPH.cy - vh / 2} ${vw} ${vh}"`)
      .replace('<g id="background">', '<g id="background" display="none">');
  }
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${s}`);
  return page.locator('svg').screenshot({ omitBackground: true });
}

/** Windows .ico with PNG images. */
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(([size, png], i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e);
    head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...images.map(([, png]) => png)]);
}

/** macOS .icns with PNG images, by icon type. */
function icns(entries) {
  const parts = entries.map(([type, png]) => {
    const h = Buffer.alloc(8);
    h.write(type, 0, 'ascii');
    h.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([h, png]);
  });
  const h = Buffer.alloc(8);
  h.write('icns', 0, 'ascii');
  h.writeUInt32BE(8 + parts.reduce((n, p) => n + p.length, 0), 4);
  return Buffer.concat([h, ...parts]);
}

const px = {};
for (const n of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) px[n] = await render(n);

writeFileSync('build/icon.png', px[1024]);
writeFileSync('build/icon.ico', ico([16, 24, 32, 48, 64, 128, 256].map((n) => [n, px[n]])));
writeFileSync(
  'build/icon.icns',
  icns([
    ['icp4', px[16]], ['icp5', px[32]], ['ic11', px[32]], ['ic12', px[64]], ['ic07', px[128]],
    ['ic13', px[256]], ['ic08', px[256]], ['ic14', px[512]], ['ic09', px[512]], ['ic10', px[1024]],
  ]),
);
mkdirSync('build/appx', { recursive: true });
writeFileSync('build/appx/StoreLogo.png', await render(50));
writeFileSync('build/appx/Square44x44Logo.png', await render(44));
writeFileSync('build/appx/Square150x150Logo.png', await render(150, 150, 0.66));
writeFileSync('build/appx/Wide310x150Logo.png', await render(310, 150, 0.66));
await browser.close();
console.log('Wrote build/icon.png, build/icon.ico, build/icon.icns and build/appx/*.png');
