// Supaplex in the browser: runs the original's game logic at its 35 iterations per second and
// shows it like the DOS game (320×200, bottom panel), with keyboard or touch controls.
import { loadAssets, type Assets } from './assets';
import { decodeLevel, levelCount, PALETTE_GAME } from './data/formats';
import { Screen, SCREEN_H, PANEL_H } from './screen';
import { Controls, type StickView } from './input';
import { setSpriteSheets } from './sim/draw';
import { startLevel, tick, scrollOffset, isMurphyIdle, status, type GameStatus } from './sim/logic';
import { Input } from './sim/tiles';

const TICK_MS = 1000 / 35;
const params = new URLSearchParams(location.search);

const canvas = document.getElementById('game') as HTMLCanvasElement;
const overlay = document.getElementById('touch') as HTMLCanvasElement;
const menu = document.getElementById('menu') as HTMLDivElement;
const message = document.getElementById('message') as HTMLDivElement;
const screen = new Screen(canvas);
const controls = new Controls(document.getElementById('play')!);

let assets: Assets;
let levelIndex = Math.max(0, Number(params.get('level') ?? 1) - 1);
let levelName = '';
let paused = false;
let last = 0;
let acc = 0;
let st: GameStatus;
/** After a level ends: frames to wait before the next/same level starts. */
let between = 0;

function begin(index: number): void {
  levelIndex = index;
  const level = decodeLevel(assets.levels, index);
  levelName = level.name;
  // The original seeds its random numbers from the clock when a level starts.
  startLevel(level, (Date.now() * 18.2 / 1000) & 0xffff);
  st = status();
  between = 0;
  message.hidden = true;
}

function pad(n: number, digits: number): string {
  return String(n).padStart(digits, '0').slice(-digits);
}

/** The bottom panel as the original draws it (drawGamePanelText, drawGameTime, infotron count). */
function drawPanel(): void {
  const y0 = SCREEN_H - PANEL_H;
  screen.blit(assets.panel, 0, y0);
  const f = assets.chars8;
  screen.text(f, 72, y0 + 3, 6, 'MURPHY  ');
  screen.text(f, 16, y0 + 14, 8, pad(levelIndex + 1, 3));
  screen.text(f, 64, y0 + 14, 8, levelName.padEnd(23).slice(0, 23));
  const seconds = Math.floor(st.frame / 35);
  screen.text(f, 160, y0 + 3, 6, pad(Math.floor(seconds / 3600), 2));
  screen.text(f, 184, y0 + 3, 6, pad(Math.floor(seconds / 60) % 60, 2));
  screen.text(f, 208, y0 + 3, 6, pad(seconds % 60, 2));
  screen.text(f, 272, y0 + 14, st.infotronsLeft === 0 ? 6 : 8, pad(st.infotronsLeft, 3));
  if (st.redDisks > 0) screen.text(f, 304, y0 + 14, 6, pad(st.redDisks, 2));
}

function render(): void {
  const s = scrollOffset();
  screen.drawLevel(s.x, s.y, SCREEN_H - PANEL_H);
  drawPanel();
  screen.present();
  drawStick(controls.stick);
}

function step(): void {
  if (between > 0) {
    if (--between === 0) begin(st.result === 'won' ? (levelIndex + 1) % levelCount(assets.levels) : levelIndex);
    return;
  }
  st = tick(controls.next(isMurphyIdle()));
  if (st.result !== 'playing') {
    message.textContent = st.result === 'won' ? `Level ${levelIndex + 1} completed!` : 'Try again';
    message.hidden = false;
    between = 70;
  }
}

function frame(now: number): void {
  if (!last) last = now;
  acc += Math.min(250, now - last);
  last = now;
  if (paused) acc = 0;
  while (acc >= TICK_MS) {
    step();
    acc -= TICK_MS;
  }
  render();
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ touch stick overlay

const octx = overlay.getContext('2d')!;
function drawStick(s: StickView): void {
  const dpr = devicePixelRatio || 1;
  const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  if (overlay.width !== w || overlay.height !== h) {
    overlay.width = w;
    overlay.height = h;
  }
  octx.clearRect(0, 0, w, h);
  if (!s.active) return;
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

// ------------------------------------------------------------------ menu (pause, quit level)

function setPaused(p: boolean): void {
  paused = p;
  menu.hidden = !p;
}
controls.onPause = () => setPaused(!paused);
controls.onEscape = () => {
  if (paused) setPaused(false);
  else if (st?.result === 'playing') tick(Input.None, true); // the original: Esc blows Murphy up
};
document.getElementById('pause')!.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  setPaused(!paused);
});
menu.addEventListener('pointerdown', (e) => e.stopPropagation());
document.getElementById('resume')!.addEventListener('click', () => setPaused(false));
document.getElementById('restart')!.addEventListener('click', () => {
  setPaused(false);
  if (st.result === 'playing') tick(Input.None, true);
});
document.getElementById('skip')!.addEventListener('click', () => {
  setPaused(false);
  begin((levelIndex + 1) % levelCount(assets.levels));
});

document.getElementById('play')!.addEventListener('pointerdown', () => document.getElementById('hint')!.remove(), { once: true });
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());

// ------------------------------------------------------------------ start

loadAssets()
  .then((a) => {
    assets = a;
    setSpriteSheets(a.moving, a.fixed);
    screen.setPalette(a.palettes[PALETTE_GAME]!);
    begin(levelIndex);
    requestAnimationFrame(frame);
  })
  .catch((e: Error) => {
    message.textContent = e.message;
    message.hidden = false;
  });

// Test hook for tools/phone.mjs: Murphy's tile.
(window as unknown as { __murphy: () => number[] }).__murphy = () => [status().murphy % 60, Math.floor(status().murphy / 60)];
