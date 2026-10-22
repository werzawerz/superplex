// Replays the original's demos (DEMO0..9.BIN) with our port of the game logic. The original
// recorded each demo until its level ended: Murphy reaching the exit (demo 0) or exploding, after
// which the game runs 64 more frames. So in an exact replay the ending must start within the
// last 64 frames of the recorded input — any desync (timing, random numbers) breaks that.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { decodeLevel } from '../data/formats';
import { parseDemo, DemoPlayer } from './demo';
import { startLevel, tick, isQuitting } from './logic';

const dir = 'original_game';
const has = existsSync(`${dir}/LEVELS.DAT`) && existsSync(`${dir}/DEMO0.BIN`);

function replay(i: number) {
  const levels = new Uint8Array(readFileSync(`${dir}/LEVELS.DAT`));
  const demo = parseDemo(new Uint8Array(readFileSync(`${dir}/DEMO${i}.BIN`)));
  const level = decodeLevel(levels, demo.level - 1);
  startLevel(level, level.randomSeed);
  const player = new DemoPlayer(demo);
  let frames = 0;
  let endingAt = -1;
  let result = 'playing';
  for (;;) {
    const input = player.step();
    if (player.ended) break;
    result = tick(input).result;
    frames++;
    if (endingAt < 0 && isQuitting()) endingAt = frames;
  }
  for (let k = 0; k < 100 && result === 'playing'; k++) result = tick(0).result;
  return { frames, endingAt, result };
}

describe.skipIf(!has)('original demos', () => {
  it('DEMO0.BIN (level 1) reaches the exit', () => {
    const r = replay(0);
    expect(r.result).toBe('won');
    expect(r.frames - r.endingAt).toBeLessThanOrEqual(64);
  });
  // Demos 2 and 6 stop while Murphy is still alive (no ending to check).
  for (const i of [1, 3, 4, 5, 7, 8, 9]) {
    it(`DEMO${i}.BIN ends when its level ends`, () => {
      const r = replay(i);
      expect(r.endingAt).toBeGreaterThan(0);
      expect(r.frames - r.endingAt).toBeLessThanOrEqual(64);
    });
  }
});
