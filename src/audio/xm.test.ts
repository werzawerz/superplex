// Renders a few seconds of the original music modules offline and checks the output is sound.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseXm, XmPlayer } from './xm';

const files = ['adlib', 'roland', 'beep'].map((n) => `original_game/audio/music-${n}.xm`);

describe.skipIf(!files.every(existsSync))('XM player', () => {
  for (const f of files) {
    it(`renders ${f}`, () => {
      const buf = readFileSync(f);
      const mod = parseXm(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
      const fakeCtx = { sampleRate: 44100, createGain: () => ({ gain: { value: 1 }, connect() {} }) } as unknown as AudioContext;
      const player = new XmPlayer(fakeCtx, mod, {} as AudioNode);
      const n = 44100 * 8;
      const l = new Float32Array(n), r = new Float32Array(n);
      (player as unknown as { render: (a: Float32Array, b: Float32Array) => void }).render(l, r);
      let sum = 0, peak = 0;
      for (let i = 0; i < n; i++) {
        expect(Number.isFinite(l[i]!)).toBe(true);
        sum += l[i]! * l[i]!;
        peak = Math.max(peak, Math.abs(l[i]!), Math.abs(r[i]!));
      }
      const rms = Math.sqrt(sum / n);
      expect(rms).toBeGreaterThan(0.01);
      expect(peak).toBeLessThan(4);
    });
  }
});
