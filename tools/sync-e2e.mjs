// Two devices (iPhone + PC) syncing a player through a fake cloud (page.route), no real database.
// node tools/sync-e2e.mjs [url]
import { chromium, devices } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5181/?skipintro';
const store = new Map(); // code -> payload (the real server keys by sha256(code))
const calls = [];
async function fakeCloud(page) {
  await page.route('**/rest/v1/rpc/supaplex_*', async (route) => {
    const fn = route.request().url().split('/').pop();
    const body = JSON.parse(route.request().postData() ?? '{}');
    calls.push(`${fn} ${body.code}`);
    if (fn === 'supaplex_save') {
      if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(body.code)) return route.fulfill({ status: 400, body: '{}' });
      store.set(body.code, body.payload);
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(store.get(body.code) ?? null) });
  });
}
const b = await chromium.launch();

// Phone: a player PETI who finished levels 1-3.
const phoneCtx = await b.newContext({ ...devices['iPhone 13 landscape'] });
const phone = await phoneCtx.newPage();
phone.on('pageerror', (e) => console.log('[phone pageerror]', e.message));
await fakeCloud(phone);
await phone.addInitScript(() => {
  const lv = new Array(111).fill(0);
  lv[0] = lv[1] = lv[2] = 1;
  const empty = { name: '--------', hours: 0, minutes: 0, seconds: 0, levelState: new Array(111).fill(0), nextLevelToPlay: 0, completedAllLevels: false };
  const list = Array.from({ length: 20 }, () => ({ ...empty }));
  list[0] = { name: '    PETI', hours: 0, minutes: 12, seconds: 34, levelState: lv, nextLevelToPlay: 4, completedAllLevels: false };
  if (!localStorage.getItem('supaplex.players.v1')) localStorage.setItem('supaplex.players.v1', JSON.stringify({ list, hallOfFame: [{ name: '', hours: 0, minutes: 0, seconds: 0 }, { name: '', hours: 0, minutes: 0, seconds: 0 }, { name: '', hours: 0, minutes: 0, seconds: 0 }], current: 0 }));
});
await phone.goto(url);
await phone.waitForTimeout(2500);
await phone.tap('#cloudBtn');
await phone.tap('#cloudMake');
await phone.waitForTimeout(500);
const code = await phone.textContent('#cloudCode');
console.log('phone sync code:', code, '| status:', await phone.textContent('#cloudStatus'));
await phone.screenshot({ path: 'screenshots/flow/sync-phone.png' });

// PC: fresh browser, link with the code.
const pc = await b.newPage({ viewport: { width: 960, height: 600 } });
pc.on('pageerror', (e) => console.log('[pc pageerror]', e.message));
await fakeCloud(pc);
await pc.goto(url);
await pc.waitForTimeout(2500);
await pc.click('#cloudBtn');
await pc.fill('#cloudInput', code.toLowerCase());
await pc.click('#cloudLink');
await pc.waitForTimeout(800);
console.log('pc status:', await pc.textContent('#cloudStatus'));
await pc.click('#cloudClose');
await pc.waitForTimeout(400);
await pc.screenshot({ path: 'screenshots/flow/sync-pc.png' });
const pcPlayer = await pc.evaluate(() => JSON.parse(localStorage.getItem('supaplex.players.v1')).list.find((p) => p.name.trim() === 'PETI'));
console.log('pc has PETI:', pcPlayer?.levelState.slice(0, 5).join(''), `${pcPlayer?.minutes}:${pcPlayer?.seconds}`, 'code', pcPlayer?.syncCode);

// PC finishes level 4 (simulated), menu sync uploads; phone reloads its menu and gets it.
await pc.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('supaplex.players.v1'));
  const p = d.list.find((x) => x.name.trim() === 'PETI');
  p.levelState[3] = 1;
  p.minutes = 20;
  localStorage.setItem('supaplex.players.v1', JSON.stringify(d));
});
await pc.reload();
await pc.waitForTimeout(2500);
await phone.reload();
await phone.waitForTimeout(3000);
const phonePlayer = await phone.evaluate(() => JSON.parse(localStorage.getItem('supaplex.players.v1')).list[0]);
console.log('phone after PC played:', phonePlayer.levelState.slice(0, 5).join(''), `${phonePlayer.minutes}:${phonePlayer.seconds}`);
console.log('cloud calls:', calls.length, [...new Set(calls.map((c) => c.split(' ')[0]))]);
await b.close();
