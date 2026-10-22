// Shared runtime for the screens: frames, palette fades, input queues in 320×200 coordinates,
// the original's animated mouse cursor. Screens are written as async loops like the original's
// blocking loops (`await rt.frame()` = one videoLoop).
import type { Assets } from '../assets';
import type { Palette } from '../data/formats';
import { Screen, SCREEN_W, SCREEN_H } from '../screen';
import type { Audio } from '../audio/audio';
import type { Players } from '../ui/players';
import type { Controls } from '../input';

export const BLACK: Palette = Array.from({ length: 16 }, () => [0, 0, 0]);

export interface Tap {
  x: number;
  y: number;
  mouse: boolean;
  button: number;
}

export class Runtime {
  /** Pointer in screen coordinates (may be outside 0..319/0..199). */
  pointer = { x: -100, y: -100, down: false, mouse: false, button: 0 };
  /** Presses since the screen last read them. */
  taps: Tap[] = [];
  keys: KeyboardEvent[] = [];
  /** Advances at 70 per second like the original's menu frame counter. */
  frameCounter = 0;
  /** Draw the stick overlay etc. after presenting (set by the game screen). */
  afterPresent: (() => void) | null = null;
  showCursor = false;
  private lastTime = 0;
  private acc70 = 0;

  constructor(
    readonly screen: Screen,
    readonly assets: Assets,
    readonly audio: Audio,
    readonly players: Players,
    readonly controls: Controls,
  ) {
    const canvas = screen.canvas;
    const toScreen = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: Math.floor(((e.clientX - r.left) / r.width) * SCREEN_W), y: Math.floor(((e.clientY - r.top) / r.height) * SCREEN_H) };
    };
    addEventListener('pointerdown', (e) => {
      if ((e.target as Element).closest?.('button, #menu')) return;
      const p = toScreen(e);
      Object.assign(this.pointer, p, { down: true, mouse: e.pointerType === 'mouse', button: e.button });
      this.showCursor = e.pointerType === 'mouse';
      this.taps.push({ ...p, mouse: e.pointerType === 'mouse', button: e.button });
    });
    addEventListener('pointermove', (e) => {
      Object.assign(this.pointer, toScreen(e), { mouse: e.pointerType === 'mouse' });
      if (e.pointerType === 'mouse') this.showCursor = true;
    });
    addEventListener('pointerup', () => (this.pointer.down = false));
    addEventListener('pointercancel', () => (this.pointer.down = false));
    addEventListener('keydown', (e) => {
      if (!e.repeat) this.keys.push(e);
    });
  }

  clearInput(): void {
    this.taps = [];
    this.keys = [];
  }

  /** Presents the screen and waits for the next display frame. Returns elapsed ms. */
  async frame(): Promise<number> {
    this.present();
    const now = await new Promise<number>((r) => requestAnimationFrame(r));
    const dt = this.lastTime ? Math.min(100, now - this.lastTime) : 1000 / 60;
    this.lastTime = now;
    this.acc70 += dt;
    while (this.acc70 >= 1000 / 70) {
      this.frameCounter = (this.frameCounter + 1) & 0xffff;
      this.acc70 -= 1000 / 70;
    }
    return dt;
  }

  private present(): void {
    const s = this.screen;
    const { x, y } = this.pointer;
    if (this.showCursor && x >= 0 && y >= 0 && x < SCREEN_W && y < SCREEN_H) {
      // drawMouseCursor: 8 animated frames at MOVING.DAT (0..24, 445..), 0 = transparent.
      const saved = new Uint8Array(64);
      const f = (this.frameCounter >> 2) & 7;
      const sx = (f & 3) * 8, sy = 445 + (f >> 2) * 9;
      const m = this.assets.moving;
      for (let j = 0; j < 8; j++) {
        for (let i = 0; i < 8; i++) {
          const px = x + i, py = y + j;
          if (px >= SCREEN_W || py >= SCREEN_H) continue;
          saved[j * 8 + i] = s.pixels[py * SCREEN_W + px]!;
          const c = m.pixels[(sy + j) * m.width + sx + i]!;
          if (c) s.pixels[py * SCREEN_W + px] = c;
        }
      }
      s.present();
      for (let j = 0; j < 8; j++) {
        for (let i = 0; i < 8; i++) {
          const px = x + i, py = y + j;
          if (px < SCREEN_W && py < SCREEN_H) s.pixels[py * SCREEN_W + px] = saved[j * 8 + i]!;
        }
      }
    } else {
      s.present();
    }
    this.afterPresent?.();
  }

  /** fadeToPalette: ~914 ms from the current palette. */
  async fade(to: Palette, ms = (64 * 1000) / 70): Promise<void> {
    const from = this.screen.palette.map((c) => [...c] as [number, number, number]);
    let t = 0;
    while (t < ms) {
      t = Math.min(ms, t + (await this.frame()));
      const k = t / ms;
      this.screen.setPalette(from.map((c, i) => c.map((v, j) => Math.round(to[i]![j]! * k + v * (1 - k))) as [number, number, number]));
    }
    this.screen.setPalette(to);
  }

  /** waitForKeyMouseOrJoystick */
  async waitAny(): Promise<void> {
    this.clearInput();
    while (this.taps.length === 0 && this.keys.length === 0) await this.frame();
    this.clearInput();
    while (this.pointer.down) await this.frame();
  }

  /**
   * Slides `to` in over the current picture: from the right (scrollRightToNewScreen) or from the
   * left (scrollLeftToMainMenu), 80 steps at 70 per second.
   */
  async slide(to: Uint8Array, fromRight: boolean): Promise<void> {
    const before = this.screen.pixels.slice();
    const px = this.screen.pixels;
    const ms = (80 * 1000) / 70;
    let t = 0;
    while (t < ms) {
      t = Math.min(ms, t + (await this.frame()));
      const k = Math.floor((t / ms) * SCREEN_W);
      for (let y = 0; y < SCREEN_H; y++) {
        const row = y * SCREEN_W;
        for (let x = 0; x < SCREEN_W; x++) {
          if (fromRight) px[row + x] = x < SCREEN_W - k ? before[row + x + k]! : to[row + x - (SCREEN_W - k)]!;
          else px[row + x] = x < k ? to[row + x + (SCREEN_W - k)]! : before[row + x - k]!;
        }
      }
    }
    px.set(to);
  }

  /** Six-pixel CHARS6 text (opaque by default), as the menus use. */
  text6(x: number, y: number, color: number, s: string, opaque = true): void {
    this.screen.text(this.assets.chars6, x, y, color, s, 6, opaque);
  }
}
