// The game in an emulated iPhone with real touch input (drags, flicks, taps) + screenshots.
// node tools/phone.mjs [url] [outDir] [portrait|landscape]   (url should start a level: ?level=1)
// Chromium, not Safari: still try a real phone.
import { chromium, devices } from 'playwright';

const [url = 'http://localhost:5181/?level=1', out = 'screenshots', mode = 'portrait'] = process.argv.slice(2);
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices[mode === 'portrait' ? 'iPhone 13' : 'iPhone 13 landscape'] });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(url, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2500);
const vp = p.viewportSize();
const cdp = await ctx.newCDPSession(p);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
const pos = () => p.evaluate(() => window.__murphy?.());
const settle = () => p.waitForTimeout(600);

/** Finger down, drag by (dx,dy) in a few moves, hold ms, release. */
async function drag(x, y, dx, dy, ms) {
  await touch('touchStart', [[x, y]]);
  for (let i = 1; i <= 4; i++) {
    await touch('touchMove', [[x + (dx * i) / 4, y + (dy * i) / 4]]);
    await p.waitForTimeout(10);
  }
  await p.waitForTimeout(ms);
  await touch('touchEnd', []);
}
/** Page coordinates of the centre of the tile at (dx,dy) from Murphy. */
async function tileNextToMurphy(dx, dy) {
  return p.evaluate(([dx, dy]) => {
    const [mx, my] = window.__murphy();
    const r = document.getElementById('game').getBoundingClientRect();
    const s = window.__scroll();
    const sx = (mx + dx) * 16 - 8 - s.x + 8, sy = (my + dy) * 16 - 8 - s.y + 8;
    return [r.left + (sx / 320) * r.width, r.top + (sy / 200) * r.height];
  }, [dx, dy]);
}

const cx = vp.width / 2, cy = vp.height * 0.75;
console.log('start', await pos());
await drag(cx, cy, -50, 0, 1000); // hold: walks several tiles
await settle();
console.log('hold left 1 s (walks)', await pos());
await drag(cx, cy, 0, 40, 100); // short drag: exactly one step
await settle();
console.log('short drag down (1 step)', await pos());
for (let i = 0; i < 3; i++) await drag(cx, cy, 40, 0, 20); // 3 quick flicks
await p.waitForTimeout(1200);
console.log('3 quick flicks right (3 steps)', await pos());
const [tx, ty] = await tileNextToMurphy(0, -1);
await touch('touchStart', [[tx, ty]]);
await p.waitForTimeout(60);
await touch('touchEnd', []);
await settle();
console.log('tap tile above (1 step up)', await pos());
// Snap: hold still (space), then drag left: Murphy eats the tile but stays.
await touch('touchStart', [[cx, cy]]);
await p.waitForTimeout(500);
for (let i = 1; i <= 4; i++) {
  await touch('touchMove', [[cx - i * 12, cy]]);
  await p.waitForTimeout(10);
}
await p.waitForTimeout(150);
await p.screenshot({ path: `${out}/phone-${mode}.png` });
await touch('touchEnd', []);
await settle();
console.log('hold still + drag left (snap, stays)', await pos());
await b.close();
