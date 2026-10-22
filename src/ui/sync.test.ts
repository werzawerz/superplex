import { describe, it, expect } from 'vitest';
import { mergeInto, normalizeCode, newSyncCode, toSaved, exportSaveCode, parseSaveCode } from './sync';
import { LevelState, NUMBER_OF_LEVELS, type Player } from './players';

const player = (name: string, done: number[], skipped: number[], secs: number): Player => {
  const levelState = new Array<number>(NUMBER_OF_LEVELS).fill(LevelState.NotCompleted);
  for (const i of done) levelState[i] = LevelState.Completed;
  for (const i of skipped) levelState[i] = LevelState.Skipped;
  return { name, hours: Math.floor(secs / 3600), minutes: Math.floor(secs / 60) % 60, seconds: secs % 60, levelState, nextLevelToPlay: 0, completedAllLevels: false };
};

describe('sync', () => {
  it('makes and reads codes', () => {
    const c = newSyncCode();
    expect(c).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(normalizeCode(c.toLowerCase().replace(/-/g, ' '))).toBe(c);
    expect(normalizeCode('ABC')).toBeNull();
  });

  it('merges: completed anywhere wins, skipped beats not done, larger time', () => {
    const phone = player('    PETI', [0, 1, 2], [3], 600);
    const pc = player('    PETI', [0, 3], [], 900);
    expect(mergeInto(pc, toSaved(phone))).toBe(true);
    expect(pc.levelState.slice(0, 5)).toEqual([1, 1, 1, 1, 0]);
    expect(pc.hours * 3600 + pc.minutes * 60 + pc.seconds).toBe(900);
    expect(mergeInto(pc, toSaved(phone))).toBe(false); // nothing new the second time
  });

  it('round-trips the save code', () => {
    const p = player('  MURPHY', [0, 5], [7], 75);
    const d = parseSaveCode(exportSaveCode([p], [{ name: 'X', hours: 1, minutes: 2, seconds: 3 }, { name: '', hours: 0, minutes: 0, seconds: 0 }, { name: '', hours: 0, minutes: 0, seconds: 0 }]));
    expect(d?.players[0]).toEqual(toSaved(p));
    expect(d?.hallOfFame[0]?.name).toBe('X');
    expect(parseSaveCode('hello')).toBeNull();
  });
});
