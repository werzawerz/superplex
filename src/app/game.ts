// Playing a level (or a demo) like the original's runLevel: fade in, 35 game iterations per
// second, the bottom panel, Enter = panel on/off, Right Shift = red disk count, Esc = give up,
// P = pause; at the end the panel slides down.
import { decodeLevel, PALETTE_GAME, type LevelData } from '../data/formats';
import { SCREEN_W, SCREEN_H, PANEL_H } from '../screen';
import { LEVEL_BITMAP_W, LEVEL_BITMAP_H } from '../sim/draw';
import { startLevel, tick, scrollOffset, isMurphyIdle, status, setPanelVisible, showRedDiskCount, type GameStatus } from '../sim/logic';
import { DemoPlayer, type Demo } from '../sim/demo';
import { Input } from '../sim/tiles';
import { BLACK, type Runtime } from './runtime';

const TICK_MS = 1000 / 35;

export interface GameResult {
  won: boolean;
  /** Seconds of game time (35 iterations = 1 s). */
  seconds: number;
  infotronsLeft: number;
  infotronsTotal: number;
}

const pad = (n: number, d: number) => String(n).padStart(d, '0').slice(-d);

export class Game {
  paused = false;
  private quitRequested = false;
  private panelVisible = true;

  constructor(private readonly rt: Runtime) {}

  /** The level tile index under a point of the 320×200 screen, or -1 (panel, outside). */
  tileAt(sx: number, sy: number): number {
    const viewH = this.panelVisible ? SCREEN_H - PANEL_H : SCREEN_H;
    if (sx < 0 || sy < 0 || sx >= SCREEN_W || sy >= viewH) return -1;
    const s = scrollOffset();
    const x0 = Math.max(0, Math.min(s.x, LEVEL_BITMAP_W - SCREEN_W));
    const y0 = Math.max(0, Math.min(s.y, LEVEL_BITMAP_H - viewH));
    // Tile (x, y) is drawn at x*16-8, y*16-8 in the level picture.
    const tx = Math.floor((sx + x0 + 8) / 16), ty = Math.floor((sy + y0 + 8) / 16);
    return ty * 60 + tx;
  }

  /** Esc / the menu's "give up": Murphy explodes like in the original. */
  quit(): void {
    this.quitRequested = true;
  }

  async play(levelNumber: number, demo: Demo | null, playerName: string): Promise<GameResult> {
    const rt = this.rt;
    const level = decodeLevel(rt.assets.levels, levelNumber - 1);
    await rt.fade(BLACK);
    // Demos replay with the level's stored random seed; games seed from the clock.
    startLevel(level, demo ? level.randomSeed : (Date.now() * 18.2 / 1000) & 0xffff);
    const player = demo ? new DemoPlayer(demo) : null;
    this.quitRequested = false;
    this.paused = false;
    rt.controls.reset();
    this.panelVisible = true;
    setPanelVisible(true);
    let st = status();
    const draw = () => this.draw(level, levelNumber, st, demo !== null, playerName);
    draw();
    await rt.fade(rt.assets.palettes[PALETTE_GAME]!);
    rt.clearInput();
    let acc = 0;
    let panelKeyRepeat = 0;
    while (st.result === 'playing') {
      const dt = await rt.frame();
      for (const k of rt.keys.splice(0)) {
        if (k.code === 'Escape') this.quitRequested = true;
        if (k.code === 'KeyP') this.paused = !this.paused;
        if (k.code === 'ShiftRight') showRedDiskCount();
        if (k.code === 'Enter' && panelKeyRepeat === 0) {
          this.panelVisible = !this.panelVisible;
          setPanelVisible(this.panelVisible);
          panelKeyRepeat = 0x20;
        }
      }
      // During a demo a tap is the way out (the original: Esc).
      if (demo && rt.taps.length) this.quitRequested = true;
      rt.taps = [];
      if (this.paused) {
        acc = 0;
        continue;
      }
      acc += dt;
      while (acc >= TICK_MS && st.result === 'playing') {
        acc -= TICK_MS;
        if (panelKeyRepeat > 0) panelKeyRepeat--;
        const input = player ? player.step() : rt.controls.next(isMurphyIdle());
        if (player?.ended) {
          this.quitRequested = false;
          // The original ends the level when the demo's input runs out.
          st = { ...status(), result: status().exitReached ? 'won' : 'lost' };
          break;
        }
        st = tick(input, this.quitRequested);
        this.quitRequested = false;
        for (const s of st.sounds) rt.audio.play(s);
      }
      draw();
    }
    await this.slideDownPanel(level, levelNumber, st, demo !== null, playerName);
    return { won: st.result === 'won', seconds: Math.floor(st.frame / 35), infotronsLeft: st.infotronsLeft, infotronsTotal: st.infotronsTotal };
  }

  private draw(level: LevelData, levelNumber: number, st: GameStatus, isDemo: boolean, playerName: string, panelHeight = PANEL_H): void {
    const rt = this.rt;
    const s = scrollOffset();
    const viewH = this.panelVisible ? SCREEN_H - panelHeight : SCREEN_H;
    rt.screen.drawLevel(s.x, s.y, viewH);
    if (this.panelVisible && panelHeight > 0) this.drawPanel(level, levelNumber, st, isDemo, playerName, SCREEN_H - panelHeight);
  }

  /** The bottom panel (drawGamePanelText, drawGameTime, infotrons, red disks). */
  private drawPanel(level: LevelData, levelNumber: number, st: GameStatus, isDemo: boolean, playerName: string, y0: number): void {
    const rt = this.rt;
    const scr = rt.screen;
    scr.blit(rt.assets.panel, 0, y0);
    const f = rt.assets.chars8;
    if (isDemo) {
      scr.text(f, 72, y0 + 3, 8, '  DEMO  ');
      scr.text(f, 16, y0 + 14, 8, 'BIN');
    } else {
      scr.text(f, 72, y0 + 3, 6, playerName);
      scr.text(f, 16, y0 + 14, 8, pad(levelNumber, 3));
    }
    scr.text(f, 64, y0 + 14, 8, level.name.padEnd(23).slice(0, 23));
    const seconds = Math.floor(st.frame / 35);
    scr.text(f, 160, y0 + 3, 6, pad(Math.floor(seconds / 3600), 2));
    scr.text(f, 184, y0 + 3, 6, pad(Math.floor(seconds / 60) % 60, 2));
    scr.text(f, 208, y0 + 3, 6, pad(seconds % 60, 2));
    scr.text(f, 272, y0 + 14, st.infotronsLeft === 0 ? 6 : 8, pad(st.infotronsLeft, 3));
    if (st.showRedDisks) scr.text(f, 304, y0 + 14, st.redDisks !== 0 ? 6 : 8, pad(st.redDisks, 2));
  }

  /** slideDownGameDash: the panel moves down one line per frame while the level shows more. */
  private async slideDownPanel(level: LevelData, levelNumber: number, st: GameStatus, isDemo: boolean, playerName: string): Promise<void> {
    if (!this.panelVisible) return;
    for (let h = PANEL_H; h > 0; h--) {
      this.draw(level, levelNumber, st, isDemo, playerName, h);
      await this.rt.frame();
    }
  }
}

export { Input };
