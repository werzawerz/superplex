// Player input → the original's per-tick input code (Input.*), from the keyboard or touch.
//
// Touch (no on-screen buttons):
// - Drag anywhere (a floating stick): each drag or flick is exactly one step; keep holding the
//   direction past the repeat delay and Murphy walks on, like a key's auto-repeat.
// - Steps made while Murphy is still moving are queued (up to 3), so quick flicks aren't lost.
// - Tap one of the four tiles next to Murphy: one step there.
// - Hold still for a moment (or keep a second finger down) to hold "space": then drag/tap to
//   eat or pick up next to Murphy without moving, or keep holding to drop a red disk.
import { Input } from './sim/tiles';

export type Dir = 0 | 1 | 2 | 3 | 4; // none, up, left, down, right (Input codes)

const DEAD_ZONE = 14; // CSS px before a drag counts as a direction
const FOLLOW = 44; // the stick origin trails the finger beyond this distance
const HOLD_MS = 380; // holding still this long turns on "space"
const QUEUE = 3; // steps remembered while Murphy is busy

/** Delay before a held drag walks continuously (pause menu setting). */
export const REPEAT_DELAYS = { short: 150, normal: 300, long: 450 } as const;
export type RepeatDelay = keyof typeof REPEAT_DELAYS;

interface Step {
  dir: number;
  space: boolean;
}

export interface StickView {
  active: boolean;
  ox: number;
  oy: number;
  x: number;
  y: number;
  dir: Dir;
  action: boolean;
}

export class Controls {
  private keys = new Set<string>();
  /** Keys pressed since the last tick, so a tap shorter than a tick still counts. */
  private tapped = new Set<string>();
  // Touch state.
  private movePointer = -1;
  private actionPointers = new Set<number>();
  private ox = 0;
  private oy = 0;
  private x = 0;
  private y = 0;
  private touchDir: Dir = 0;
  private holdAction = false;
  private holdTimer = 0;
  private steps: Step[] = [];
  /** The step Murphy is doing now: its direction stays pressed until he stands still again
   *  (pushing a zonk needs the direction held while he leans on it). */
  private current: Step | null = null;
  /** When the current drag direction started (for the repeat delay). */
  private dirSince = 0;
  private downAt = 0;
  private moved = false;
  repeatDelay: RepeatDelay = 'normal';
  /** Direction from Murphy to the tile under a screen point, or 0 if it isn't next to him. */
  adjacentDir: (clientX: number, clientY: number) => number = () => 0;
  onEscape: () => void = () => {};
  onPause: () => void = () => {};

  constructor(touchTarget: HTMLElement) {
    addEventListener('keydown', (e) => {
      if ((e.target as Element | null)?.closest?.('input, textarea')) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Space'].includes(e.key) || e.code === 'Space') e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.tapped.add(e.code);
      if (e.code === 'Escape') this.onEscape();
      if (e.code === 'KeyP') this.onPause();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    touchTarget.addEventListener('pointerdown', (e) => this.down(e));
    touchTarget.addEventListener('pointermove', (e) => this.move(e));
    touchTarget.addEventListener('pointerup', (e) => this.up(e));
    touchTarget.addEventListener('pointercancel', (e) => this.up(e));
  }

  private down(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    this.downAt = performance.now();
    if (this.movePointer < 0) {
      this.movePointer = e.pointerId;
      this.moved = false;
      this.ox = this.x = e.clientX;
      this.oy = this.y = e.clientY;
      this.touchDir = 0;
      this.holdAction = false;
      clearTimeout(this.holdTimer);
      this.holdTimer = window.setTimeout(() => {
        if (this.touchDir === 0) this.holdAction = true;
      }, HOLD_MS);
    } else {
      this.actionPointers.add(e.pointerId);
    }
    e.preventDefault();
  }

  private move(e: PointerEvent): void {
    if (e.pointerId !== this.movePointer) return;
    this.x = e.clientX;
    this.y = e.clientY;
    let dx = this.x - this.ox, dy = this.y - this.oy;
    const dist = Math.hypot(dx, dy);
    if (dist > FOLLOW) {
      // Floating stick: drag the origin along so a direction change is immediate.
      const k = (dist - FOLLOW) / dist;
      this.ox += dx * k;
      this.oy += dy * k;
      dx = this.x - this.ox;
      dy = this.y - this.oy;
    }
    let dir: Dir = 0;
    if (Math.hypot(dx, dy) > DEAD_ZONE) {
      dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? Input.Left : Input.Right) : dy < 0 ? Input.Up : Input.Down;
    }
    if (dir !== this.touchDir) {
      this.touchDir = dir;
      this.dirSince = performance.now();
      if (dir !== 0) this.push(dir, false);
    }
    if (dir !== 0) {
      this.moved = true;
      clearTimeout(this.holdTimer);
    }
  }

  private push(dir: number, space: boolean): void {
    if (this.steps.length < QUEUE) this.steps.push({ dir, space: space || this.spaceHeld() });
  }

  private spaceHeld(): boolean {
    return this.holdAction || this.actionPointers.size > 0;
  }

  private up(e: PointerEvent): void {
    // A quick tap (no drag) on a tile next to Murphy is a step there; with another finger held
    // (or a tap made as the second finger) it is a space step.
    const isTap = performance.now() - this.downAt < HOLD_MS && !(e.pointerId === this.movePointer && this.moved);
    if (isTap) {
      const dir = this.adjacentDir(e.clientX, e.clientY);
      if (dir) this.push(dir, e.pointerId !== this.movePointer);
    }
    if (e.pointerId === this.movePointer) {
      this.movePointer = -1;
      this.touchDir = 0;
      this.holdAction = false;
      clearTimeout(this.holdTimer);
    }
    this.actionPointers.delete(e.pointerId);
  }

  /** Forget queued touch steps (a new level starts). */
  reset(): void {
    this.steps = [];
    this.current = null;
    this.tapped.clear();
  }

  get stick(): StickView {
    return {
      active: this.movePointer >= 0 && (this.moved || this.holdAction),
      ox: this.ox,
      oy: this.oy,
      x: this.x,
      y: this.y,
      dir: this.touchDir,
      action: this.holdAction || this.actionPointers.size > 0,
    };
  }

  /**
   * The input for the next game tick, like the original's updateUserInput: the last pressed of
   * up/left/down/right wins in that order; with space it becomes a space+direction code.
   * `murphyIdle`: Murphy reads input this tick (so a queued step is used up).
   */
  next(murphyIdle: boolean): number {
    const k = (code: string) => this.keys.has(code) || this.tapped.has(code);
    let dir: number = Input.None;
    if (k('ArrowUp')) dir = Input.Up;
    if (k('ArrowLeft')) dir = Input.Left;
    if (k('ArrowDown')) dir = Input.Down;
    if (k('ArrowRight')) dir = Input.Right;
    let space = k('Space');
    this.tapped.clear();

    const walking = this.touchDir !== 0 && performance.now() - this.dirSince >= REPEAT_DELAYS[this.repeatDelay];
    if (walking) {
      // Held past the repeat delay: walk on; queued steps are part of this walk.
      dir = this.touchDir;
      this.steps = [];
      this.current = null;
    } else {
      if (murphyIdle) this.current = this.steps.shift() ?? null;
      if (this.current) {
        dir = this.current.dir;
        if (this.current.space) space = true;
      }
    }
    if (this.spaceHeld()) space = true;

    if (space) return dir === Input.None ? Input.SpaceOnly : dir + 4;
    return dir;
  }

  /** The input code right now, without using up taps or flicks (for display). */
  peek(): number {
    const k = (code: string) => this.keys.has(code);
    let dir: number = Input.None;
    if (k('ArrowUp')) dir = Input.Up;
    if (k('ArrowLeft')) dir = Input.Left;
    if (k('ArrowDown')) dir = Input.Down;
    if (k('ArrowRight')) dir = Input.Right;
    if (k('Space')) return dir === Input.None ? Input.SpaceOnly : dir + 4;
    return dir;
  }

  held(code: string): boolean {
    return this.keys.has(code);
  }
}
