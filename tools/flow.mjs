// Headless walk through the screens: node tools/flow.mjs <url> <outDir> "<steps>"
// steps: comma list of  wait:ms | key:Code | click:x:y (320x200 screen coords) | shot:name
import { chromium } from 'playwright';
const [url = 'http://localhost:5181/', out = 'screenshots/flow', steps = ''] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 960, height: 600 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
p.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log('[console]', m.text()));
await p.goto(url);
for (const s of steps.split(',').filter(Boolean)) {
  const [cmd, a, c] = s.split(':');
  if (cmd === 'wait') await p.waitForTimeout(Number(a));
  else if (cmd === 'key') await p.keyboard.press(a);
  else if (cmd === 'hold') { await p.keyboard.down(a); await p.waitForTimeout(Number(c)); await p.keyboard.up(a); }
  else if (cmd === 'click') {
    const r = await p.evaluate(() => { const q = document.getElementById('game').getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height }; });
    await p.mouse.click(r.x + ((Number(a) + 0.5) / 320) * r.w, r.y + ((Number(c) + 0.5) / 200) * r.h);
  } else if (cmd === 'shot') await p.screenshot({ path: `${out}/${a}.png` });
}
await b.close();
