// Player input → the original's per-tick input code (Input.*), from the keyboard or touch.
//
// Touch (no on-screen buttons): put a finger down anywhere and drag — the direction you drag
// is the arrow key held (a floating stick). A quick flick moves one step. Hold still for a
// moment (or put a second finger down) to hold "space": then drag to eat/pick up next to Murphy
// without moving, or keep holding to drop a red disk.
import { Input } from './sim/tiles';

export type Dir = 0 | 1 | 2 | 3 | 4; // none, up, left, down, right (Input codes)

const DEAD_ZONE = 14; // CSS px before a drag counts as a direction
const FOLLOW = 44; // the stick origin trails the finger beyond this distance
const HOLD_MS = 380; // holding still this long turns on "space"

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
  private flick: Dir = 0;
  private dirConsumed = false;
  onEscape: () => void = () => {};
  onPause: () => void = () => {};

  constructor(touchTarget: HTMLElement) {
    addEventListener('keydown', (e) => {
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
    if (this.movePointer < 0) {
      this.movePointer = e.pointerId;
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
      this.dirConsumed = false;
    }
    if (dir !== 0) clearTimeout(this.holdTimer);
  }

  private up(e: PointerEvent): void {
    if (e.pointerId === this.movePointer) {
      // A flick released before Murphy took the step still makes that one step.
      if (this.touchDir !== 0 && !this.dirConsumed) this.flick = this.touchDir;
      this.movePointer = -1;
      this.touchDir = 0;
      this.holdAction = false;
      clearTimeout(this.holdTimer);
    }
    this.actionPointers.delete(e.pointerId);
  }

  get stick(): StickView {
    return {
      active: this.movePointer >= 0,
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
   * `murphyIdle`: Murphy reads input this tick (so a flick is used up).
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

    if (this.touchDir !== 0) {
      dir = this.touchDir;
      if (murphyIdle) this.dirConsumed = true;
    } else if (this.flick !== 0) {
      dir = this.flick;
      if (murphyIdle) this.flick = 0;
    }
    if (this.holdAction || this.actionPointers.size > 0) space = true;

    if (space) return dir === Input.None ? Input.SpaceOnly : dir + 4;
    return dir;
  }

  held(code: string): boolean {
    return this.keys.has(code);
  }
}
