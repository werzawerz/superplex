// The original's main menu (MENU.DAT): player list, level list, rankings, hall of fame, message
// line and the option buttons, with the original's texts, colours, positions and button flashes.
import { decodeLevel, decodeScreen, levelCount, PALETTE_GAME, PALETTE_INFO, PALETTE_CONTROLS } from '../data/formats';
import { SCREEN_W, SCREEN_H } from '../screen';
import { MAIN_MENU_BORDERS, MAIN_MENU_BUTTONS, OPTIONS_MENU_BORDERS, OPTIONS_MENU_BUTTONS, type BorderLine } from '../ui/tables.generated';
import { BLACK, type Runtime } from './runtime';
import {
  LevelState, LAST_LEVEL_INDEX, NUMBER_OF_LEVELS, NUMBER_OF_PLAYERS, NO_NAME,
  BLOCKED_COLOR, COMPLETED_COLOR, NOT_COMPLETED_COLOR,
} from '../ui/players';
import type { SoundType } from '../audio/audio';

export type MenuChoice = { kind: 'play'; level: number; countTime: boolean } | { kind: 'demo'; index: number };

/** What the message line says when coming back from a level (drawMenuTitleAndDemoLevelResult). */
export type LevelResult = { won: boolean; demo: boolean } | null;

const pad = (n: number, w: number) => String(n).padStart(w, '0').slice(-w);

export class Menu {
  private rankingTop = 0; // byte_58D46
  private levelNames: string[] = [];
  // Button press state for the border flashes (drawMainMenuButtonBorders).
  private flags = { player: [false, false, false], ranking: [false, false, false], level: [false, false, false] };
  private throttle = { player: [16, 0], ranking: [16, 0], level: [16, 0] };
  private idle = 0;
  private menuPixels: Uint8Array;
  private backPixels: Uint8Array;
  private gfxPixels: Uint8Array;
  private controlsPixels: Uint8Array;

  constructor(private readonly rt: Runtime, files: { menu: Uint8Array; back: Uint8Array; gfx: Uint8Array; controls: Uint8Array }) {
    this.menuPixels = decodeScreen(files.menu).pixels;
    this.backPixels = decodeScreen(files.back).pixels;
    this.gfxPixels = decodeScreen(files.gfx).pixels;
    this.controlsPixels = decodeScreen(files.controls).pixels;
    // The level list entries: "001 ------- WARM UP -------", padded like the original.
    const levels = rt.assets.levels;
    const n = levelCount(levels);
    const blank = ' '.repeat(27);
    this.levelNames = [blank, blank];
    for (let i = 0; i < NUMBER_OF_LEVELS; i++) {
      this.levelNames.push(i < n ? `${pad(i + 1, 3)} ${rawName(decodeLevel(levels, i).raw)}` : blank);
    }
    this.levelNames.push('- REPLAY SKIPPED LEVELS!! -', '---- UNBELIEVEABLE!!!! ----', blank, blank);
  }

  private get p() {
    return this.rt.players;
  }

  private message(color: number, text: string): void {
    this.rt.text6(168, 127, color, text.padEnd(23).slice(0, 23));
  }

  // ------------------------------------------------------------------ drawing

  /** drawMenuBackground + drawMenuTitleAndDemoLevelResult */
  drawAll(result: LevelResult): void {
    this.rt.screen.pixels.set(this.menuPixels);
    this.message(4, '  WELCOME TO SUPAPLEX  ');
    this.drawPlayerList();
    this.drawLevelList();
    this.drawHallOfFame();
    this.drawRankings();
    if (result) {
      const t = result.won ? (result.demo ? '    DEMO SUCCESSFUL    ' : '   LEVEL SUCCESSFUL    ') : result.demo ? '      DEMO FAILED      ' : '     LEVEL FAILED      ';
      this.message(4, t);
    }
  }

  private drawPlayerList(): void {
    const { list, current } = this.p;
    this.rt.text6(16, 164, 6, list[current]!.name);
    this.rt.text6(16, 155, 8, current > 0 ? list[current - 1]!.name : '        ');
    this.rt.text6(16, 173, 8, current < NUMBER_OF_PLAYERS - 1 ? list[current + 1]!.name : '        ');
    // drawCurrentPlayerRanking
    const pl = this.p.player;
    this.rt.text6(168, 93, 8, pl.name);
    this.rt.text6(224, 93, 8, `${pad(pl.hours, 3)}:${pad(pl.minutes, 2)}:${pad(pl.seconds, 2)}`);
    this.rt.text6(288, 93, 8, pad(pl.nextLevelToPlay, 3));
  }

  private drawLevelList(): void {
    const sel = this.p.selectedLevel;
    this.rt.text6(144, 155, this.p.levelColor(sel - 1), this.levelNames[sel]!);
    this.rt.text6(144, 164, this.p.levelColor(sel), this.levelNames[sel + 1]!);
    this.rt.text6(144, 173, this.p.levelColor(sel + 1), this.levelNames[sel + 2]!);
  }

  private drawHallOfFame(): void {
    this.p.hallOfFame.forEach((e, i) => {
      const name = e.name.slice(0, 8).padEnd(9);
      this.rt.text6(184, 28 + i * 9, 8, `${name}${String(e.hours).padStart(3, ' ')}:${pad(e.minutes, 2)}:${pad(e.seconds, 2)}`);
    });
  }

  private drawRankings(): void {
    const { lines } = this.p.rankingLines();
    for (let i = 0; i < 5; i++) this.rt.text6(8, 110 + 9 * (i - 2), i === 2 ? 6 : 8, lines[this.rankingTop + i]!);
    this.rt.text6(144, 110, 6, pad(this.rankingTop + 1, 2));
  }

  private drawBorder(lines: readonly BorderLine[], color: number): void {
    const px = this.rt.screen.pixels;
    for (const [type, x, y, len] of lines) {
      for (let j = 0; j < len; j++) {
        const [dx, dy] = type === 0 ? [x + j, y] : type === 1 ? [x, y - j] : type === 2 ? [x + j, y - j] : [x + j, y + j];
        if (dx >= 0 && dy >= 0 && dx < SCREEN_W && dy < SCREEN_H) px[dy * SCREEN_W + dx] = color;
      }
    }
  }

  /** drawMainMenuButtonBorders: pressed arrows show light/dark edges swapped. */
  private drawButtonBorders(): void {
    const groups = [['player', 0], ['ranking', 4], ['level', 8]] as const;
    for (const [name, first] of groups) {
      const f = this.flags[name];
      if (!f[0]) continue;
      const up = f[1], down = f[2];
      this.drawBorder(MAIN_MENU_BORDERS[first]!, up ? 13 : 7);
      this.drawBorder(MAIN_MENU_BORDERS[first + 1]!, up ? 7 : 13);
      this.drawBorder(MAIN_MENU_BORDERS[first + 2]!, down ? 13 : 7);
      this.drawBorder(MAIN_MENU_BORDERS[first + 3]!, down ? 7 : 13);
      f[0] = false;
    }
  }

  /** Throttled repeat for held arrow buttons: starts slow, speeds up (original counters). */
  private throttled(name: 'player' | 'ranking' | 'level', up: boolean): boolean {
    const f = this.flags[name];
    f[1] = up;
    f[2] = !up;
    const t = this.throttle[name];
    if (((this.rt.frameCounter - t[0]!) & 0xffff) < t[1]!) return false;
    t[1] = this.rt.frameCounter;
    if (t[0]! > 1) t[0]!--;
    return true;
  }

  // ------------------------------------------------------------------ the loop

  /** runMainMenu: returns when a level or demo should start. */
  async run(result: LevelResult, fadeIn: boolean): Promise<MenuChoice> {
    const rt = this.rt;
    if (fadeIn) {
      this.drawAll(result);
      await rt.fade(rt.assets.palettes[PALETTE_GAME]!);
    }
    rt.audio.startMusic();
    rt.clearInput();
    this.idle = 0;
    let lastPointer = `${rt.pointer.x},${rt.pointer.y}`;
    for (;;) {
      const dt = await rt.frame();
      this.idle += dt;
      const where = `${rt.pointer.x},${rt.pointer.y}`;
      if (where !== lastPointer || rt.pointer.down || rt.keys.length) this.idle = 0;
      lastPointer = where;
      if (this.idle > 60000) return this.demoChoice(); // 4200 frames without input: a demo

      this.drawButtonBorders();
      for (const name of ['player', 'ranking', 'level'] as const) {
        const f = this.flags[name];
        if (f[1] || f[2]) f[0] = true;
        f[1] = f[2] = false;
      }

      // Keys: Space/Enter = OK (original: space+direction or start), F1..F10 = demos, Esc = options.
      const key = rt.keys.shift();
      if (key) {
        if (key.code === 'Enter' || key.code === 'Space') {
          const c = await this.ok();
          if (c) return c;
        } else if (/^F([1-9]|10)$/.test(key.code)) {
          key.preventDefault();
          return { kind: 'demo', index: Number(key.code.slice(1)) - 1 };
        } else if (key.code === 'ArrowUp' || key.code === 'ArrowDown') {
          // Convenience: arrows move through the level list.
          this.moveLevel(key.code === 'ArrowDown' ? 1 : -1);
        }
      }

      const tap = rt.taps.shift();
      rt.taps = [];
      if (rt.pointer.down || tap) {
        const x = tap?.x ?? rt.pointer.x, y = tap?.y ?? rt.pointer.y;
        const btn = MAIN_MENU_BUTTONS.find(([x1, y1, x2, y2]) => x >= x1 && y >= y1 && x <= x2 && y <= y2);
        if (!btn) continue;
        const h = btn[4];
        // Held arrows repeat; everything else acts on the press.
        if (h === 'handlePlayerListScrollUp' || h === 'handlePlayerListScrollDown') {
          if (this.throttled('player', h.endsWith('Up'))) this.movePlayer(h.endsWith('Up') ? -1 : 1);
        } else if (h === 'handleRankingListScrollUp' || h === 'handleRankingListScrollDown') {
          if (this.throttled('ranking', h.endsWith('Up'))) {
            this.rankingTop = Math.max(0, Math.min(NUMBER_OF_PLAYERS - 1, this.rankingTop + (h.endsWith('Up') ? -1 : 1)));
            this.drawRankings();
          }
        } else if (h === 'handleLevelListScrollUp' || h === 'handleLevelListScrollDown') {
          if (this.throttled('level', h.endsWith('Up'))) this.moveLevel(h.endsWith('Up') ? -1 : 1);
        } else if (tap) {
          const c = await this.press(h);
          if (c) return c;
        }
      } else {
        this.throttle = { player: [16, 0], ranking: [16, 0], level: [16, 0] };
      }
    }
  }

  private movePlayer(d: number): void {
    const p = this.p;
    p.current = Math.max(0, Math.min(NUMBER_OF_PLAYERS - 1, p.current + d));
    p.prepareLevelData(true);
    p.save();
    this.drawPlayerList();
    this.drawLevelList();
  }

  private moveLevel(d: number): void {
    const p = this.p;
    p.selectedLevel = Math.max(1, Math.min(LAST_LEVEL_INDEX, p.selectedLevel + d));
    this.drawLevelList();
  }

  private async press(handler: string): Promise<MenuChoice | null> {
    switch (handler) {
      case 'handleOkButtonClick':
        return this.ok();
      case 'handleNewPlayerOptionClick':
        await this.newPlayer();
        return null;
      case 'handleDeletePlayerOptionClick':
        await this.deletePlayer();
        return null;
      case 'handleSkipLevelOptionClick':
        await this.skipLevel();
        return null;
      case 'handleStatisticsOptionClick':
        await this.statistics();
        return null;
      case 'handleGfxTutorOptionClick':
        await this.gfxTutor();
        return null;
      case 'handleDemoOptionClick':
        return this.demoChoice();
      case 'handleControlsOptionClick':
        await this.controls();
        return null;
      case 'handlePlayerListClick':
        this.rankingTop = this.p.rankingLines().currentRank;
        this.drawRankings();
        return null;
      case 'handleLevelCreditsClick':
        await this.credits();
        return null;
      default:
        return null; // handleFloppyDiskButtonClick: level sets (not in the 1991 game)
    }
  }

  private demoChoice(): MenuChoice {
    return { kind: 'demo', index: Math.floor(Math.random() * 10) };
  }

  /** handleOkButtonClick */
  private async ok(): Promise<MenuChoice | null> {
    const p = this.p;
    if (!p.hasPlayer) {
      this.message(8, 'NO PLAYER SELECTED     ');
      return null;
    }
    const sel = p.selectedLevel;
    if (sel === LAST_LEVEL_INDEX) {
      if (p.player.levelState.every((s) => s === LevelState.Completed)) await this.congratulations();
      else this.message(2, 'COLORBLIND I GUESS     ');
      return null;
    }
    if (sel > NUMBER_OF_LEVELS) return null;
    const color = p.levelColor(sel);
    if (color === BLOCKED_COLOR) {
      this.message(8, 'COLORBLIND I GUESS     ');
      return null;
    }
    return { kind: 'play', level: sel, countTime: color !== COMPLETED_COLOR };
  }

  /** Waits for the next press; true if it was on the OK button (the original's confirmations). */
  private async confirmWithOk(): Promise<boolean> {
    const rt = this.rt;
    while (rt.pointer.down) await rt.frame();
    rt.clearInput();
    for (;;) {
      await rt.frame();
      const k = rt.keys.shift();
      if (k) return k.code === 'Enter';
      const t = rt.taps.shift();
      if (t) {
        const [x1, y1, x2, y2] = MAIN_MENU_BUTTONS.find((b) => b[4] === 'handleOkButtonClick')!;
        while (rt.pointer.down) await rt.frame();
        rt.clearInput();
        return t.x >= x1 && t.y >= y1 && t.x <= x2 && t.y <= y2;
      }
    }
  }

  /** handleNewPlayerOptionClick: type the name on the message line (or a prompt on phones). */
  private async newPlayer(): Promise<void> {
    const rt = this.rt;
    if (!this.p.list.some((pl) => pl.name === NO_NAME)) {
      this.message(6, 'PLAYER LIST FULL       ');
      return;
    }
    let name = '';
    const touchOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
    if (touchOnly) {
      while (rt.pointer.down) await rt.frame();
      name = (window.prompt('YOUR NAME (max 8 letters):') ?? '').toUpperCase().slice(0, 8);
      rt.clearInput();
    } else {
      this.message(4, 'YOUR NAME:             ');
      while (rt.pointer.down) await rt.frame();
      rt.clearInput();
      const allowed = /^[0-9A-Z -]$/;
      let typed = '';
      for (;;) {
        await rt.frame();
        if (rt.taps.length) break;
        const k = rt.keys.shift();
        if (!k) continue;
        if (k.code === 'Enter') break;
        if (k.code === 'Backspace') typed = typed.slice(0, -1);
        else if (typed.length < 8 && k.key.length === 1 && allowed.test(k.key.toUpperCase())) typed += k.key.toUpperCase();
        rt.text6(232, 127, 6, typed.padEnd(8));
      }
      while (rt.pointer.down) await rt.frame();
      rt.clearInput();
      name = typed;
    }
    const err = this.p.addPlayer(name);
    if (err) {
      this.message(6, err);
      return;
    }
    this.message(8, '');
    this.drawPlayerList();
    this.drawLevelList();
    this.drawRankings();
  }

  private async deletePlayer(): Promise<void> {
    if (!this.p.hasPlayer) {
      this.message(8, 'NO PLAYER SELECTED     ');
      return;
    }
    this.message(8, `DELETE '${this.p.player.name}' ???  `);
    if (await this.confirmWithOk()) this.p.deleteCurrent();
    this.message(8, '');
    this.drawPlayerList();
    this.drawLevelList();
    this.drawRankings();
  }

  private async skipLevel(): Promise<void> {
    const p = this.p;
    if (!p.hasPlayer) {
      this.message(8, 'NO PLAYER SELECTED     ');
      return;
    }
    if (p.player.levelState.filter((s) => s === LevelState.Skipped).length >= 3) {
      this.message(6, 'SKIP NOT POSSIBLE      ');
      return;
    }
    if (p.levelColor(p.selectedLevel) !== NOT_COMPLETED_COLOR) {
      this.message(4, 'COLORBLIND I GUESS     ');
      return;
    }
    this.message(8, `SKIP LEVEL ${pad(p.selectedLevel, 3)} ???     `);
    if (await this.confirmWithOk()) {
      p.setSelectedLevelState(LevelState.Skipped);
      p.prepareLevelData(false);
    }
    this.message(8, '');
    this.drawPlayerList();
    this.drawLevelList();
    this.drawRankings();
  }

  // ------------------------------------------------------------------ info screens (BACK.DAT)

  /** Fade out, show texts on BACK.DAT with the info palette, wait, fade back to the menu. */
  private async infoScreen(texts: [number, number, string][]): Promise<void> {
    const rt = this.rt;
    await rt.fade(BLACK);
    const menu = rt.screen.pixels.slice();
    rt.screen.pixels.set(this.backPixels);
    for (const [x, y, t] of texts) rt.text6(x, y, 15, t, false);
    await rt.fade(rt.assets.palettes[PALETTE_INFO]!);
    await rt.waitAny();
    await rt.fade(BLACK);
    rt.screen.pixels.set(menu);
    await rt.fade(rt.assets.palettes[PALETTE_GAME]!);
  }

  private async statistics(): Promise<void> {
    const pl = this.p.player;
    if (!this.p.hasPlayer) {
      this.message(8, 'NO PLAYER SELECTED     ');
      return;
    }
    const texts: [number, number, string][] = [
      [80, 20, 'SUPAPLEX  BY DREAM FACTORY'],
      [64, 50, '(C) DIGITAL INTEGRATION LTD 1991'],
      [16, 60, '________________________________________________'],
      [80, 80, 'SUPAPLEX PLAYER STATISTICS'],
      [80, 100, `CURRENT PLAYER :  ${pl.name}`],
      [80, 110, `CURRENT LEVEL  :       ${pad(pl.nextLevelToPlay, 3)}`],
      [80, 120, `USED TIME      : ${String(pl.hours).padStart(3, ' ')}:${pad(pl.minutes, 2)}:${pad(pl.seconds, 2)}`],
    ];
    let minutes = pl.hours * 60 + pl.minutes + (pl.seconds >= 30 ? 1 : 0);
    const per = Math.max(1, pl.nextLevelToPlay);
    const whole = Math.floor(minutes / per);
    const frac = Math.floor(((minutes % per) * 10) / per);
    if (pl.nextLevelToPlay === LAST_LEVEL_INDEX) texts.push([24, 140, "YOU'VE COMPLETED ALL LEVELS! CONGRATULATIONS!!!"]);
    else if (whole === 0) texts.push([40, 140, 'STILL UNDER ONE MINUTE (KEEP IT UP...)']);
    else texts.push([32, 140, `AVERAGE TIME USED PER LEVEL  ${String(whole).padStart(3, ' ')}.${frac} MINUTES`]);
    await this.infoScreen(texts);
  }

  private async credits(): Promise<void> {
    await this.infoScreen([
      [80, 10, 'SUPAPLEX  BY DREAM FACTORY'],
      [56, 40, 'ORIGINAL DESIGN BY PHILIP JESPERSEN'],
      [88, 50, 'AND MICHAEL STOPP'],
      [56, 90, 'NEARLY ALL LEVELS BY MICHEAL STOPP'],
      [64, 100, 'A FEW LEVELS BY PHILIP JESPERSEN'],
      [56, 110, 'HARDLY ANY LEVELS BY BARBARA STOPP'],
      [64, 170, 'NOTE: PRESS ENTER TO REMOVE PANEL'],
      [64, 190, '(C) DIGITAL INTEGRATION LTD 1991'],
    ]);
  }

  private async congratulations(): Promise<void> {
    await this.infoScreen([
      [120, 30, 'CONGRATULATIONS'],
      [24, 70, 'YOU HAVE COMPLETED ALL 111 LEVELS OF SUPAPLEX'],
      [64, 85, 'YOUR BRAIN IS IN FANTASTIC SHAPE'],
      [40, 100, 'NOT MANY PEOPLE ARE ABLE TO MANAGE THIS'],
    ]);
  }

  /** HARD LUCK! screen after a failed level (drawFailedLevelResultScreen). */
  async hardLuck(infotronsLeft: number, infotronsTotal: number): Promise<void> {
    const rt = this.rt;
    rt.screen.setPalette(BLACK);
    rt.screen.pixels.set(this.backPixels);
    rt.text6(128, 60, 15, 'HARD LUCK!', false);
    if (infotronsLeft === 0) {
      rt.text6(40, 80, 15, 'YOU COMPLETED ALL THE NECESSARY INFOTRONS', false);
      rt.text6(72, 100, 15, 'BUT FAILED TO REACH THE EXIT', false);
    } else {
      const n = (v: number) => String(v).padStart(3, ' ');
      rt.text6(40, 80, 15, `YOU HAVE COLLECTED ${n(infotronsTotal - infotronsLeft)} OUT OF THE ${n(infotronsTotal)}`, false);
      rt.text6(104, 100, 15, 'INFOTRONS NEEDED', false);
    }
    rt.text6(72, 120, 15, 'WHY NOT GIVE IT ANOTHER TRY?', false);
    rt.screen.setPalette(rt.assets.palettes[PALETTE_INFO]!);
    await rt.waitAny();
    rt.screen.setPalette(BLACK);
  }

  /** After a successful level / a demo: the menu slides in from the left. */
  async scrollInFromLeft(result: LevelResult): Promise<void> {
    const rt = this.rt;
    const current = rt.screen.pixels.slice();
    this.drawAll(result);
    const menu = rt.screen.pixels.slice();
    rt.screen.pixels.set(current);
    await rt.slide(menu, false);
  }

  private async gfxTutor(): Promise<void> {
    const rt = this.rt;
    const menu = rt.screen.pixels.slice();
    await rt.slide(this.gfxPixels, true);
    await rt.waitAny();
    await rt.slide(menu, false);
  }

  // ------------------------------------------------------------------ Controls (sound/input options)

  private async controls(): Promise<void> {
    const rt = this.rt;
    const menu = rt.screen.pixels.slice();
    const opts = this.controlsPixels.slice();
    rt.screen.setPalette(rt.assets.palettes[PALETTE_CONTROLS]!);
    // Draw the current selections into the picture before it slides in.
    rt.screen.pixels.set(opts);
    this.drawSoundOptions();
    this.drawInputOptions();
    const withOptions = rt.screen.pixels.slice();
    rt.screen.pixels.set(menu);
    await rt.slide(withOptions, true);
    while (rt.pointer.down) await rt.frame();
    rt.clearInput();
    let lastInput = -1;
    for (;;) {
      await rt.frame();
      lastInput = this.drawKeyboardState(lastInput);
      const k = rt.keys.shift();
      if (k?.code === 'Escape') break;
      const t = rt.taps.shift();
      if (!t) continue;
      if (t.button === 2) break;
      const b = OPTIONS_MENU_BUTTONS.find(([x1, y1, x2, y2]) => t.x >= x1 && t.y >= y1 && t.x <= x2 && t.y <= y2);
      if (!b) continue;
      const h = b[4];
      if (h === 'handleOptionsExitAreaClick') break;
      const types: Record<string, SoundType> = {
        handleOptionsAdlibClick: 'adlib',
        handleOptionsSoundBlasterClick: 'blaster',
        handleOptionsRolandClick: 'roland',
        handleOptionsCombinedClick: 'combined',
        handleOptionsInternalClick: 'standard',
        handleOptionsStandardClick: 'standard',
        handleOptionsSamplesClick: 'samples',
      };
      if (types[h]) {
        rt.audio.setSoundType(types[h]!);
        rt.audio.play('explosion');
        this.drawSoundOptions();
      } else if (h === 'handleOptionsMusicClick') {
        rt.audio.setMusic(!rt.audio.musicOn);
        this.drawSoundOptions();
      } else if (h === 'handleOptionsFXClick') {
        rt.audio.setFx(!rt.audio.fxOn);
        if (rt.audio.fxOn) rt.audio.play('explosion');
        this.drawSoundOptions();
      }
      while (rt.pointer.down) await rt.frame();
    }
    rt.screen.setPalette(rt.assets.palettes[PALETTE_GAME]!);
    await rt.slide(menu, false);
    rt.clearInput();
  }

  private highlight(x0: number, y0: number, w: number, h: number, on: boolean): void {
    const px = this.rt.screen.pixels;
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const i = y * SCREEN_W + x;
        if (on && px[i] === 1) px[i] = 15;
        else if (!on && px[i] === 15) px[i] = 1;
      }
    }
  }

  /** drawSoundTypeOptionsSelection + drawAudioOptionsSelection */
  private drawSoundOptions(): void {
    const B = OPTIONS_MENU_BORDERS;
    const line = (i: number, c: number) => this.drawBorder(B[i]!, c);
    const t = this.rt.audio.soundType;
    this.highlight(40, 21, 40, 8, false);
    line(0, 4); line(1, 4);
    this.highlight(24, 57, 72, 8, false);
    line(2, 4); line(3, 4);
    this.highlight(32, 93, 56, 8, false);
    line(4, 4); line(5, 4);
    this.highlight(24, 129, 64, 8, false);
    this.highlight(136, 18, 72, 8, false);
    line(7, 4);
    this.highlight(128, 46, 40, 5, false);
    line(8, 4);
    this.highlight(176, 46, 40, 5, false);
    line(9, 4);
    line(6, 4);
    if (t === 'adlib') {
      this.highlight(40, 21, 40, 8, true);
      line(0, 6); line(1, 6);
    } else if (t === 'blaster' || t === 'combined') {
      line(3, 6);
      if (t === 'blaster') {
        this.highlight(24, 57, 72, 8, true);
        line(2, 6);
      } else {
        this.highlight(24, 129, 64, 8, true);
        line(4, 6); line(6, 6);
      }
    } else if (t === 'roland') {
      this.highlight(32, 93, 56, 8, true);
      line(4, 6); line(5, 6);
    } else {
      this.highlight(136, 18, 72, 8, true);
      line(7, 6);
      if (t === 'standard') {
        this.highlight(128, 46, 40, 5, true);
        line(8, 6);
      } else {
        this.highlight(176, 46, 40, 5, true);
        line(9, 6);
      }
    }
    const a = this.rt.audio;
    this.highlight(134, 99, 40, 8, a.musicOn);
    line(10, a.musicOn ? 6 : 4);
    this.highlight(136, 138, 24, 8, a.fxOn);
    line(11, a.fxOn ? 6 : 4);
  }

  /** drawInputOptionsSelection: keyboard is the only input here. */
  private drawInputOptions(): void {
    this.highlight(208, 87, 8, 62, true);
    this.highlight(240, 88, 8, 58, false);
    this.drawBorder(OPTIONS_MENU_BORDERS[18]!, 4);
    this.drawBorder(OPTIONS_MENU_BORDERS[19]!, 6);
  }

  /** updateOptionsMenuState: the lines light up for the pressed arrow / space keys. */
  private drawKeyboardState(last: number): number {
    const c = this.rt.controls;
    const input = c.peek();
    if (input === last) return last;
    const B = OPTIONS_MENU_BORDERS;
    const line = (i: number, col: number) => this.drawBorder(B[i]!, col);
    let dir = input;
    if (input === 0) {
      line(12, 6);
      line(17, 4);
    } else if (input <= 4) {
      line(12, 4);
      line(17, 4);
    } else {
      line(17, 6);
      if (input !== 9) {
        dir = input - 4;
        line(12, 4);
      } else {
        dir = 0;
        line(12, 6);
      }
    }
    for (let i = 13; i <= 16; i++) line(i, 4);
    if (dir >= 1 && dir <= 4) line(12 + dir, 6);
    return input;
  }
}

/** The 23-character level name stored in the level (bytes 1446..1468). */
function rawName(raw: Uint8Array): string {
  let s = '';
  for (let i = 0; i < 23; i++) s += String.fromCharCode(raw[1446 + i]!);
  return s;
}
