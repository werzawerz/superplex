// Players, level progress, rankings and hall of fame — the original's PLAYER.LST and
// HALLFAME.LST logic (prepareLevelDataForCurrentPlayer, changePlayerCurrentLevelState, ...),
// stored in the browser.
import { mergeInto, type SavedPlayer } from './sync';

export const NUMBER_OF_LEVELS = 111;
export const NUMBER_OF_PLAYERS = 20;
/** Selected level index that means "all done" (kLastLevelIndex). */
export const LAST_LEVEL_INDEX = 113;
export const NO_NAME = '--------';

export const enum LevelState {
  NotCompleted = 0,
  Completed = 1,
  Skipped = 2,
}

// Level list colours (palette indices) of the original.
export const NOT_COMPLETED_COLOR = 2;
export const COMPLETED_COLOR = 4;
export const BLOCKED_COLOR = 6;
export const SKIPPED_COLOR = 8;

export interface Player {
  name: string; // 8 chars, right-aligned with spaces; NO_NAME = empty slot
  hours: number;
  minutes: number;
  seconds: number;
  levelState: number[];
  nextLevelToPlay: number;
  completedAllLevels: boolean;
  /** Secret code of this player's cloud save, once sync is on (see sync.ts). */
  syncCode?: string;
}

export interface HallOfFameEntry {
  name: string;
  hours: number;
  minutes: number;
  seconds: number;
}

const emptyPlayer = (): Player => ({
  name: NO_NAME,
  hours: 0,
  minutes: 0,
  seconds: 0,
  levelState: new Array<number>(NUMBER_OF_LEVELS).fill(LevelState.NotCompleted),
  nextLevelToPlay: 0,
  completedAllLevels: false,
});

const KEY = 'supaplex.players.v1';

export class Players {
  list: Player[] = Array.from({ length: NUMBER_OF_PLAYERS }, emptyPlayer);
  hallOfFame: HallOfFameEntry[] = Array.from({ length: 3 }, () => ({ name: '', hours: 0, minutes: 0, seconds: 0 }));
  current = 0;
  /** 1-based selected level in the level list (gCurrentSelectedLevelIndex). */
  selectedLevel = 1;
  /** Level list colours, index 0..115 = "level" -1..114 (padded like the original). */
  private colors = new Array<number>(NUMBER_OF_LEVELS + 5).fill(SKIPPED_COLOR);

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw) as { list: Player[]; hallOfFame: HallOfFameEntry[]; current: number };
        if (d.list?.length === NUMBER_OF_PLAYERS) this.list = d.list;
        if (d.hallOfFame?.length === 3) this.hallOfFame = d.hallOfFame;
        this.current = Math.max(0, Math.min(NUMBER_OF_PLAYERS - 1, d.current ?? 0));
      }
    } catch {
      /* fresh start */
    }
    this.prepareLevelData(true);
  }

  save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify({ list: this.list, hallOfFame: this.hallOfFame, current: this.current }));
    } catch {
      /* private mode: progress lasts for this visit only */
    }
  }

  get player(): Player {
    return this.list[this.current]!;
  }

  get hasPlayer(): boolean {
    return this.player.name !== NO_NAME;
  }

  /** Colour of level `n` (1-based) in the list; works for the padding entries around it too. */
  levelColor(n: number): number {
    return this.colors[n + 1] ?? SKIPPED_COLOR;
  }

  /** prepareLevelDataForCurrentPlayer */
  prepareLevelData(autoselect: boolean): void {
    const p = this.player;
    this.colors.fill(SKIPPED_COLOR);
    let firstUncompleted = true;
    for (let i = 0; i < NUMBER_OF_LEVELS; i++) {
      const s = p.levelState[i];
      let c = BLOCKED_COLOR;
      if (s === LevelState.Skipped) c = SKIPPED_COLOR;
      else if (s === LevelState.Completed) c = COMPLETED_COLOR;
      else {
        c = firstUncompleted ? NOT_COMPLETED_COLOR : BLOCKED_COLOR;
        firstUncompleted = false;
      }
      this.colors[i + 2] = c;
    }
    let next = 1;
    let all = true;
    for (let i = 0; i < NUMBER_OF_LEVELS; i++, next++) {
      if (p.levelState[i] === LevelState.NotCompleted) {
        all = false;
        break;
      }
    }
    if (all) {
      next = 1;
      for (let i = 0; i < NUMBER_OF_LEVELS; i++, next++) {
        if (p.levelState[i] === LevelState.Skipped) {
          all = false;
          break;
        }
      }
    }
    if (all) {
      if (autoselect) this.selectedLevel = LAST_LEVEL_INDEX;
      p.nextLevelToPlay = LAST_LEVEL_INDEX;
      return;
    }
    if (autoselect) this.selectedLevel = next;
    if (next === 1 && p.name === NO_NAME) next = 0;
    p.nextLevelToPlay = next;
  }

  /** changePlayerCurrentLevelState: mark the selected level and move to the next one. */
  setSelectedLevelState(state: LevelState): void {
    this.player.levelState[this.selectedLevel - 1] = state;
    this.selectedLevel++;
    this.updateHallOfFame();
    this.save();
  }

  /** addCurrentGameTimeToPlayer */
  addTime(totalSeconds: number): void {
    const p = this.player;
    let s = p.seconds + (totalSeconds % 60);
    let m = p.minutes + Math.floor(totalSeconds / 60) % 60;
    let h = p.hours + Math.floor(totalSeconds / 3600);
    if (s >= 60) { s -= 60; m++; }
    if (m >= 60) { m -= 60; h++; }
    p.seconds = s;
    p.minutes = m;
    p.hours = Math.min(255, h);
    this.save();
  }

  private updateHallOfFame(): void {
    const p = this.player;
    if (p.completedAllLevels) return;
    if (p.levelState.some((s) => s !== LevelState.Completed)) return;
    p.completedAllLevels = true;
    const t = (e: { hours: number; minutes: number; seconds: number }) => e.hours * 3600 + e.minutes * 60 + e.seconds;
    let at = this.hallOfFame.findIndex((e) => t(e) === 0 || t(p) < t(e));
    if (at < 0) return;
    this.hallOfFame.splice(at, 0, { name: p.name, hours: p.hours, minutes: p.minutes, seconds: p.seconds });
    this.hallOfFame.length = 3;
  }

  /**
   * Brings in a player from another device: merged into the local player of the same name, or
   * put in a free slot. Returns the slot, or -1 if the list is full.
   */
  importPlayer(s: SavedPlayer, syncCode?: string): number {
    const name = s.name.slice(0, 8).padStart(8, ' ');
    let slot = this.list.findIndex((p) => p.name === name);
    if (slot < 0) {
      slot = this.list.findIndex((p) => p.name === NO_NAME);
      if (slot < 0) return -1;
      this.list[slot] = { ...emptyPlayer(), name };
    }
    const p = this.list[slot]!;
    mergeInto(p, s);
    if (syncCode) p.syncCode = syncCode;
    if (slot === this.current) this.prepareLevelData(true);
    this.save();
    return slot;
  }

  /** New player name: up to 8 of 0-9 A-Z space '-', right-aligned. Returns an error text or null. */
  addPlayer(input: string): string | null {
    const slot = this.list.findIndex((p) => p.name === NO_NAME);
    if (slot < 0) return 'PLAYER LIST FULL       ';
    const clean = input.toUpperCase().replace(/[^0-9A-Z -]/g, '-').slice(0, 8).trimEnd();
    if (clean.trim() === '') return '';
    const name = clean.padStart(8, ' ');
    if (name === NO_NAME) return 'INVALID NAME           ';
    if (this.list.some((p) => p.name === name)) return 'PLAYER EXISTS          ';
    this.list[slot] = { ...emptyPlayer(), name };
    this.current = slot;
    this.prepareLevelData(true);
    this.save();
    return null;
  }

  deleteCurrent(): void {
    this.list[this.current] = emptyPlayer();
    this.prepareLevelData(true);
    this.save();
  }

  /** prepareRankingTextEntries: players sorted by level, then time. Returns 24 lines (2 padding each side). */
  rankingLines(): { lines: string[]; currentRank: number } {
    const entries = this.list.map((p, i) => ({ i, next: p.nextLevelToPlay << 24 >> 24, h: p.hours << 24 >> 24, m: p.minutes << 24 >> 24, s: p.seconds << 24 >> 24 }));
    // Bubble sort exactly like the original (keeps its order for equal entries).
    let changes;
    do {
      changes = 0;
      for (let k = 0; k < entries.length - 1; k++) {
        const a = entries[k]!, b = entries[k + 1]!;
        let swap;
        if (b.next !== a.next) swap = b.next > a.next;
        else if (b.h !== a.h) swap = b.h < a.h;
        else if (b.m !== a.m) swap = b.m < a.m;
        else swap = b.s < a.s;
        if (swap) {
          entries[k] = b;
          entries[k + 1] = a;
          changes++;
        }
      }
    } while (changes > 0);
    const pad = (n: number, w: number) => String(n).padStart(w, '0').slice(-w);
    const lines = ['                      ', '                      '];
    let currentRank = 0;
    entries.forEach((e, rank) => {
      if (e.i === this.current) currentRank = rank;
      const p = this.list[e.i]!;
      const lvl = e.next === 113 ? '999' : pad(e.next & 0xff, 3);
      lines.push(`${lvl} ${p.name} ${pad(p.hours, 3)}:${pad(p.minutes, 2)}:${pad(p.seconds, 2)}`);
    });
    lines.push('                      ', '                      ');
    return { lines, currentRank };
  }
}
