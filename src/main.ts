// Supaplex in the browser, in the order of the original: title pictures, main menu, levels.
import { loadAssets } from './assets';
import { decodeScreen, type Palette } from './data/formats';
import { Screen, SCREEN_W } from './screen';
import { Controls, type StickView } from './input';
import { setSpriteSheets } from './sim/draw';
import { Input } from './sim/tiles';
import { parseDemo } from './sim/demo';
import { status } from './sim/logic';
import { Audio } from './audio/audio';
import { Players, LevelState } from './ui/players';
import { Runtime, BLACK } from './app/runtime';
import { Menu, type LevelResult, type MenuChoice } from './app/menu';
import { Game } from './app/game';

const BASE = import.meta.env.DEV ? '/original_game/' : `${import.meta.env.BASE_URL}original/`;
const params = new URLSearchParams(location.search);

const canvas = document.getElementById('game') as HTMLCanvasElement;
const overlay = document.getElementById('touch') as HTMLCanvasElement;
const pauseMenu = document.getElementById('menu') as HTMLDivElement;
const pauseButton = document.getElementById('pause') as HTMLButtonElement;
const message = document.getElementById('message') as HTMLDivElement;

// Title palettes (graphics.c gTitle*PaletteData), 0..15 per channel.
const titlePalette = (a: number[]): Palette => Array.from({ length: 16 }, (_, i) => [a[i * 4]! * 17, a[i * 4 + 1]! * 17, a[i * 4 + 2]! * 17]);
const TITLE = titlePalette([2, 3, 5, 0, 13, 10, 4, 12, 2, 6, 6, 2, 3, 9, 9, 3, 11, 8, 3, 6, 2, 7, 7, 10, 8, 6, 13, 9, 6, 4, 11, 1, 9, 1, 0, 4, 11, 1, 0, 4, 13, 1, 0, 12, 15, 1, 0, 12, 15, 6, 4, 12, 2, 5, 6, 8, 15, 12, 6, 14, 12, 12, 13, 14]);
const TITLE1 = titlePalette([0, 0, 0, 0, 15, 15, 15, 15, 8, 8, 8, 8, 10, 10, 10, 7, 10, 10, 10, 7, 11, 11, 11, 7, 14, 1, 1, 4, 9, 9, 9, 7, 8, 8, 8, 8, 8, 8, 8, 8, 9, 0, 0, 4, 11, 0, 0, 12, 8, 8, 8, 8, 5, 5, 5, 8, 6, 6, 6, 8, 8, 8, 8, 8]);
const TITLE2 = titlePalette([0, 0, 0, 0, 15, 15, 15, 15, 6, 6, 6, 8, 10, 10, 10, 7, 10, 10, 10, 7, 11, 11, 11, 7, 14, 1, 1, 4, 9, 9, 9, 7, 1, 3, 7, 0, 8, 8, 8, 8, 9, 0, 0, 4, 11, 0, 0, 12, 0, 2, 10, 1, 5, 5, 5, 8, 6, 6, 6, 8, 8, 8, 8, 7]);

async function file(name: string): Promise<Uint8Array> {
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`Missing original file ${name}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** TITLE.DAT fades in; TITLE1.DAT; the credits block opens to TITLE2.DAT; wait for a key. */
async function intro(rt: Runtime, title: Uint8Array, title1: Uint8Array, title2: Uint8Array): Promise<void> {
  const px = rt.screen.pixels;
  rt.screen.setPalette(BLACK);
  px.set(title);
  await rt.fade(TITLE);
  // The original loads its data here; show the picture for a moment.
  for (let t = 0; t < 1500 && rt.taps.length + rt.keys.length === 0; ) t += await rt.frame();
  rt.clearInput();
  px.set(title1);
  rt.screen.setPalette(TITLE1);
  await rt.frame();
  // openCreditsBlock: the two halves of the middle bar slide apart over ~429 ms, revealing TITLE2.
  const EDGE_W = 13, EDGE_H = 148, TOP = 26, FRAMES = 60;
  const distanceMax = (4 * FRAMES) / 2 + 1;
  const left0 = 147, right0 = left0 + EDGE_W + 1;
  const ms = (FRAMES * 1000) / 70;
  let t = 0;
  while (t < ms) {
    t = Math.min(ms, t + (await rt.frame()));
    const d = Math.ceil(distanceMax * (t / ms));
    const left = left0 - d, right = right0 + d;
    for (let y = TOP; y < TOP + EDGE_H; y++) {
      const row = y * SCREEN_W;
      for (let x = 0; x < SCREEN_W; x++) {
        let c: number;
        if (x >= left && x < left + EDGE_W) c = title1[row + left0 + (x - left)]!;
        else if (x >= right && x < right + EDGE_W) c = title1[row + right0 + (x - right)]!;
        else if (x >= left + EDGE_W && x < right) c = title2[row + x]!;
        else c = title1[row + x]!;
        px[row + x] = c;
      }
    }
  }
  px.set(title2);
  await rt.fade(TITLE2);
  await rt.waitAny();
  await rt.fade(BLACK);
}

let inGame = false;

async function main(): Promise<void> {
  const assets = await loadAssets();
  setSpriteSheets(assets.moving, assets.fixed);
  const screen = new Screen(canvas);
  screen.setPalette(BLACK);
  const controls = new Controls(document.getElementById('play')!);
  const rt = new Runtime(screen, assets, new Audio(), new Players(), controls);
  const [title, title1, title2, menuDat, back, gfx, controlsDat] = await Promise.all(
    ['TITLE.DAT', 'TITLE1.DAT', 'TITLE2.DAT', 'MENU.DAT', 'BACK.DAT', 'GFX.DAT', 'CONTROLS.DAT'].map(file),
  );
  const demos = await Promise.all(Array.from({ length: 10 }, (_, i) => file(`DEMO${i}.BIN`).then(parseDemo).catch(() => null)));
  const menu = new Menu(rt, { menu: menuDat!, back: back!, gfx: gfx!, controls: controlsDat! });
  const game = new Game(rt);
  setupTouchUi(rt, game);

  if (!params.has('skipintro') && !params.has('level')) {
    await intro(rt, decodeScreen(title!).pixels, decodeScreen(title1!).pixels, decodeScreen(title2!).pixels);
  }

  // ?level=N: straight into a level (testing); otherwise the menu.
  let result: LevelResult = null;
  let fadeIn = true;
  let direct = params.has('level') ? Number(params.get('level')) : 0;
  for (;;) {
    const choice: MenuChoice = direct ? { kind: 'play', level: direct, countTime: false } : await menu.run(result, fadeIn);
    direct = 0;
    const demo = choice.kind === 'demo' ? demos[choice.index] ?? null : null;
    if (choice.kind === 'demo' && !demo) continue;
    const levelNumber = choice.kind === 'play' ? choice.level : demo!.level;
    if (!rt.audio.musicOn) rt.audio.stopMusic();
    inGame = true;
    const r = await game.play(levelNumber, demo, rt.players.player.name);
    inGame = false;
    if (choice.kind === 'play') {
      if (r.won) rt.players.setSelectedLevelState(LevelState.Completed);
      if (choice.countTime) rt.players.addTime(r.seconds);
      rt.players.prepareLevelData(false);
    }
    result = { won: r.won, demo: choice.kind === 'demo' };
    if (!r.won && choice.kind === 'play') {
      await menu.hardLuck(r.infotronsLeft, r.infotronsTotal);
      fadeIn = true;
    } else {
      await menu.scrollInFromLeft(result);
      fadeIn = false;
    }
  }
}

// ------------------------------------------------------------------ touch: stick overlay, pause

function setupTouchUi(rt: Runtime, game: Game): void {
  const octx = overlay.getContext('2d')!;
  rt.afterPresent = () => {
    pauseButton.hidden = !inGame;
    drawStick(octx, inGame && !game.paused ? rt.controls.stick : null);
  };
  const toggles = {
    music: document.getElementById('music') as HTMLButtonElement,
    fx: document.getElementById('fx') as HTMLButtonElement,
  };
  const updateToggles = () => {
    toggles.music.textContent = `Music: ${rt.audio.musicOn ? 'on' : 'off'}`;
    toggles.fx.textContent = `Sound effects: ${rt.audio.fxOn ? 'on' : 'off'}`;
  };
  const setPaused = (p: boolean) => {
    game.paused = p;
    pauseMenu.hidden = !p;
    updateToggles();
  };
  pauseButton.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    setPaused(!game.paused);
  });
  pauseMenu.addEventListener('pointerdown', (e) => e.stopPropagation());
  document.getElementById('resume')!.addEventListener('click', () => setPaused(false));
  document.getElementById('restart')!.addEventListener('click', () => {
    setPaused(false);
    game.quit();
  });
  toggles.music.addEventListener('click', () => {
    rt.audio.setMusic(!rt.audio.musicOn);
    updateToggles();
  });
  toggles.fx.addEventListener('click', () => {
    rt.audio.setFx(!rt.audio.fxOn);
    updateToggles();
  });
  document.getElementById('play')!.addEventListener('pointerdown', () => document.getElementById('hint')?.remove(), { once: true });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('contextmenu', (e) => e.preventDefault());
}

function drawStick(octx: CanvasRenderingContext2D, s: StickView | null): void {
  const dpr = devicePixelRatio || 1;
  const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  if (overlay.width !== w || overlay.height !== h) {
    overlay.width = w;
    overlay.height = h;
  }
  octx.clearRect(0, 0, w, h);
  if (!s?.active) return;
  octx.save();
  octx.scale(dpr, dpr);
  octx.lineWidth = 3;
  octx.strokeStyle = s.action ? 'rgba(255,220,80,0.8)' : 'rgba(255,255,255,0.45)';
  octx.fillStyle = s.action ? 'rgba(255,220,80,0.25)' : 'rgba(255,255,255,0.08)';
  octx.beginPath();
  octx.arc(s.ox, s.oy, 44, 0, Math.PI * 2);
  octx.fill();
  octx.stroke();
  octx.fillStyle = s.action ? 'rgba(255,220,80,0.7)' : 'rgba(255,255,255,0.5)';
  octx.beginPath();
  octx.arc(s.x, s.y, 16, 0, Math.PI * 2);
  octx.fill();
  if (s.dir) {
    const a = { [Input.Up]: -Math.PI / 2, [Input.Left]: Math.PI, [Input.Down]: Math.PI / 2, [Input.Right]: 0 }[s.dir]!;
    octx.translate(s.ox, s.oy);
    octx.rotate(a);
    octx.beginPath();
    octx.moveTo(60, 0);
    octx.lineTo(48, -10);
    octx.lineTo(48, 10);
    octx.closePath();
    octx.fill();
  }
  octx.restore();
}

// Test hook for tools/phone.mjs: Murphy's tile.
(window as unknown as { __murphy: () => number[] }).__murphy = () => [status().murphy % 60, Math.floor(status().murphy / 60)];

main().catch((e: Error) => {
  message.textContent = e.message;
  message.hidden = false;
});
