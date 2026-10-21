/**
 * Microsoft Store screenshots (docs/store/), taken from the running app while
 * it follows the recorded Japji Sahib (see harness.ts): the operator window,
 * the projector in two looks and the operator window in Punjabi at
 * 1920 × 1080, and the phone page at 1080 × 1920.
 *
 *   npm run build
 *   xvfb-run -a -s "-screen 0 2560x1600x24" node dist/e2e/screenshots.js     (Linux)
 *
 * The phone page is rendered by Playwright's Chromium; set CHROMIUM to use
 * another Chromium or Chrome.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { launch, REPO, sleep, state, until } from './harness';

const OUT = join(REPO, 'docs', 'store');

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const k = await launch();
  const page = k.page;
  const now = () => state(k.base);
  const pick = (name: string, value: string) => page.click(`label:has(input[name="${name}"][value="${value}"])`);
  const shot = (p: Page, name: string) => p.screenshot({ path: join(OUT, name) });
  /** The operator window, with a real-looking input name instead of the test microphone's. */
  async function operator(name: string): Promise<void> {
    await page.$eval('#device', (s) => {
      const o = (s as HTMLSelectElement).selectedOptions[0];
      if (o) o.textContent = 'USB Audio Device';
    });
    await shot(page, name);
  }

  /** A window of the given content size showing a page of the presentation server. */
  async function window(path: string, width: number, height: number): Promise<Page> {
    const opened = k.app.waitForEvent('window');
    await k.app.evaluate(
      ({ BrowserWindow }, o) => {
        const w = new BrowserWindow({ useContentSize: true, width: o.width, height: o.height, show: false, frame: false });
        void w.loadURL(o.url);
      },
      { url: `${k.base}${path}`, width, height },
    );
    const p = await opened;
    await p.waitForLoadState();
    return p;
  }

  try {
    await k.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.setContentSize(1920, 1080);
      w.setPosition(0, 0);
    });

    // Follow the paath with the Punjabi arth and the English translation on.
    await page.click('[data-mode="paath"]');
    await pick('meaning', 'pa');
    await pick('meaning', 'en');
    await page.click('#mic');
    await page.waitForSelector('#lines li.current', { timeout: 150_000 });
    await until('a few lines in', now, (v) => (v.current?.line ?? 0) > 3 && !!v.current?.en, 60_000);
    await sleep(1500);
    await operator('1-operator.png');

    const projector = await window('/projector', 1920, 1080);
    await until('the tuk on the projector', async () => (await projector.locator('#current .gu').textContent()) ?? '', (t) => t.length > 0);
    await sleep(1000);
    await shot(projector, '2-projector.png');

    // The dark look, with the tuk in Hindi script too.
    await page.click('label.sw-dark');
    await pick('hindi', 'below');
    await until('the dark look', () => projector.locator('html').getAttribute('data-theme'), (t) => t === 'dark');
    await sleep(1000);
    await shot(projector, '3-projector-dark.png');
    await projector.close();

    // The whole app in Punjabi.
    await page.click('[data-tab="app"]');
    await pick('language', 'pa');
    await until('the Punjabi app', now, (v) => v.settings.language === 'pa');
    await page.click('[data-tab="screen"]');
    await sleep(1000);
    await operator('4-operator-punjabi.png');

    // A phone following along (1080 × 1920).
    const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
    const phone = await browser.newPage({ viewport: { width: 432, height: 768 }, deviceScaleFactor: 2.5 });
    await phone.goto(`${k.base}/follow`);
    await phone.waitForSelector('#lines li.current');
    await sleep(1000);
    await shot(phone, '5-phone.png');
    await browser.close();
  } finally {
    // The harness gives the app its own temporary settings folder.
    await k.app.close();
  }
  console.log(`Wrote the Store screenshots to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
