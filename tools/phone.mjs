// The game in an emulated iPhone with real touch input (drags, flicks, holds) + screenshots.
// node tools/phone.mjs <url> <outDir> [portrait|landscape]
// Chromium, not Safari: still try a real phone.
import { chromium, devices } from 'playwright';

const [url = 'http://localhost:5181/', out = 'screenshots', mode = 'portrait'] = process.argv.slice(2);
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices[mode === 'portrait' ? 'iPhone 13' : 'iPhone 13 landscape'] });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
p.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text()));
await p.goto(url, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);
const vp = p.viewportSize();
const cdp = await ctx.newCDPSession(p);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
const pos = () => p.evaluate(() => window.__murphy?.());

/** Finger down at (x,y), drag by (dx,dy) in steps, hold ms, release. */
async function drag(x, y, dx, dy, ms) {
  await touch('touchStart', [[x, y]]);
  for (let i = 1; i <= 6; i++) {
    await touch('touchMove', [[x + (dx * i) / 6, y + (dy * i) / 6]]);
    await p.waitForTimeout(16);
  }
  await p.waitForTimeout(ms);
  await touch('touchEnd', []);
}

const cx = vp.width / 2, cy = vp.height * 0.7;
console.log('start', await pos());
await p.screenshot({ path: `${out}/phone-${mode}-0.png` });
await drag(cx, cy, -60, 0, 700); // hold left
console.log('after hold left', await pos());
await drag(cx, cy, 0, 40, 30); // quick flick down: one step
await p.waitForTimeout(400);
console.log('after flick down', await pos());
// Screenshot while dragging up (stick visible).
await touch('touchStart', [[cx, cy]]);
await touch('touchMove', [[cx, cy - 50]]);
await p.waitForTimeout(150);
await p.screenshot({ path: `${out}/phone-${mode}-1.png` });
await touch('touchEnd', []);
await p.waitForTimeout(400);
console.log('after drag up', await pos());
await b.close();
