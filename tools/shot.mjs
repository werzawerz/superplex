// Headless screenshot helper: node tools/shot.mjs <out.png> [url] [keys-to-press] [waitMs]
// Uses software WebGL so it works without a GPU. Prints page console errors.
import { chromium } from 'playwright';

const [out = 'shot.png', url = 'http://localhost:5173/', keys = '', wait = '800'] = process.argv.slice(2);

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
page.on('console', (m) => console.log(`[console.${m.type()}]`, m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForTimeout(Number(wait));
for (const k of keys.split(',').filter(Boolean)) {
  const [key, ms = '0'] = k.split(':');
  await page.keyboard.down(key);
  await page.waitForTimeout(Number(ms) || 50);
  await page.keyboard.up(key);
}
await page.waitForTimeout(400);
await page.screenshot({ path: out });
await browser.close();
console.log('saved', out);
