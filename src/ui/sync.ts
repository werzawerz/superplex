// Moving progress between devices:
// - cloud sync: a player gets a secret sync code; its progress is stored online under that code
//   (Supabase functions supaplex_load/supaplex_save, see supabase/migrations) and merged on
//   every device that linked the code;
// - save code: all players as one text to copy to another device by hand (works offline).
import { LevelState, NUMBER_OF_LEVELS, type Player, type HallOfFameEntry } from './players';

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** What is stored online for one player. */
export interface SavedPlayer {
  v: 1;
  name: string;
  hours: number;
  minutes: number;
  seconds: number;
  /** One digit per level: 0 not completed, 1 completed, 2 skipped. */
  levels: string;
  completedAllLevels: boolean;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I lookalikes

/** A new random sync code, XXXX-XXXX-XXXX (60 random bits). */
export function newSyncCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const c = Array.from(bytes, (b) => ALPHABET[b & 31]).join('');
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;
}

/** Tidies a typed code ("abcd efgh-jklm" → "ABCD-EFGH-JKLM"); null if it can't be one. */
export function normalizeCode(input: string): string | null {
  const c = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.length !== 12) return null;
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;
}

export function toSaved(p: Player): SavedPlayer {
  return {
    v: 1,
    name: p.name,
    hours: p.hours,
    minutes: p.minutes,
    seconds: p.seconds,
    levels: p.levelState.join(''),
    completedAllLevels: p.completedAllLevels,
  };
}

const seconds = (p: { hours: number; minutes: number; seconds: number }) => p.hours * 3600 + p.minutes * 60 + p.seconds;

/**
 * Merges progress from another device into `p` (keeps p's name and sync code):
 * a level completed anywhere is completed, skipped beats not completed; the play time is the
 * larger of the two (both only grow). Returns true if `p` changed.
 */
export function mergeInto(p: Player, s: SavedPlayer): boolean {
  let changed = false;
  for (let i = 0; i < NUMBER_OF_LEVELS; i++) {
    const theirs = Number(s.levels[i] ?? 0);
    const mine = p.levelState[i] ?? LevelState.NotCompleted;
    const rank = (v: number) => (v === LevelState.Completed ? 2 : v === LevelState.Skipped ? 1 : 0);
    if (rank(theirs) > rank(mine)) {
      p.levelState[i] = theirs;
      changed = true;
    }
  }
  if (seconds(s) > seconds(p)) {
    p.hours = s.hours;
    p.minutes = s.minutes;
    p.seconds = s.seconds;
    changed = true;
  }
  if (s.completedAllLevels && !p.completedAllLevels) {
    p.completedAllLevels = true;
    changed = true;
  }
  return changed;
}

export function isSavedPlayer(x: unknown): x is SavedPlayer {
  const s = x as SavedPlayer;
  return !!s && typeof s === 'object' && typeof s.name === 'string' && typeof s.levels === 'string' && /^[012]*$/.test(s.levels) &&
    [s.hours, s.minutes, s.seconds].every((n) => Number.isInteger(n) && n >= 0 && n < 1000);
}

// ------------------------------------------------------------------ cloud

export const cloudAvailable = (): boolean => !!URL && !!KEY;

async function rpc<T>(fn: string, body: unknown): Promise<T> {
  if (!URL || !KEY) throw new Error('Cloud saves are not set up');
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(res.status === 404 ? 'Cloud saves are not set up yet' : `Cloud error ${res.status}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

/** The player saved under `code`, or null if nothing is saved there. */
export async function cloudLoad(code: string): Promise<SavedPlayer | null> {
  const data = await rpc<unknown>('supaplex_load', { code });
  return isSavedPlayer(data) ? data : null;
}

export async function cloudSave(code: string, p: Player): Promise<void> {
  await rpc('supaplex_save', { code, payload: toSaved(p) });
}

// ------------------------------------------------------------------ save code (offline)

/** All named players (+ hall of fame) as one copyable text. */
export function exportSaveCode(players: Player[], hallOfFame: HallOfFameEntry[]): string {
  const json = JSON.stringify({ v: 1, players: players.filter((p) => p.name !== '--------').map(toSaved), hallOfFame });
  return 'SUPAPLEX:' + btoa(unescape(encodeURIComponent(json)));
}

export function parseSaveCode(text: string): { players: SavedPlayer[]; hallOfFame: HallOfFameEntry[] } | null {
  const m = text.trim().match(/^SUPAPLEX:([A-Za-z0-9+/=\s]+)$/);
  if (!m) return null;
  try {
    const d = JSON.parse(decodeURIComponent(escape(atob(m[1]!.replace(/\s/g, ''))))) as { players: unknown[]; hallOfFame: HallOfFameEntry[] };
    const players = (d.players ?? []).filter(isSavedPlayer);
    return { players, hallOfFame: Array.isArray(d.hallOfFame) ? d.hallOfFame.slice(0, 3) : [] };
  } catch {
    return null;
  }
}
