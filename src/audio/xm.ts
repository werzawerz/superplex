// A small FastTracker 2 (.xm) player, enough for Supaplex's music modules: linear frequencies,
// 8/16-bit looping samples, volume envelopes + fadeout, panning, effects A (volume slide),
// B (jump), C (volume), D (pattern break), F (speed/tempo). Renders on the main thread in blocks
// that are queued back to back on the AudioContext.

interface Sample {
  data: Float32Array;
  loopStart: number;
  loopLen: number; // 0 = no loop
  pingPong: boolean;
  volume: number;
  finetune: number;
  relNote: number;
  panning: number;
}

interface Envelope {
  points: [number, number][];
  sustain: number;
  loopStart: number;
  loopEnd: number;
  on: boolean;
  sustainOn: boolean;
  loopOn: boolean;
}

interface Instrument {
  sampleFor: Uint8Array; // note (0..95) → sample index
  samples: Sample[];
  volEnv: Envelope;
  fadeout: number;
}

interface Cell {
  note: number;
  ins: number;
  vol: number;
  fx: number;
  param: number;
}

export interface XmModule {
  channels: number;
  order: number[];
  restart: number;
  patterns: Cell[][][]; // [pattern][row][channel]
  instruments: Instrument[];
  speed: number;
  bpm: number;
}

export function parseXm(buf: ArrayBuffer): XmModule {
  const d = new Uint8Array(buf);
  const dv = new DataView(buf);
  const headerSize = dv.getUint32(60, true);
  const len = dv.getUint16(64, true);
  const restart = dv.getUint16(66, true);
  const channels = dv.getUint16(68, true);
  const np = dv.getUint16(70, true);
  const ni = dv.getUint16(72, true);
  const speed = dv.getUint16(76, true);
  const bpm = dv.getUint16(78, true);
  const order = Array.from(d.subarray(80, 80 + len));
  let p = 60 + headerSize;
  const patterns: Cell[][][] = [];
  for (let i = 0; i < np; i++) {
    const hl = dv.getUint32(p, true);
    const rows = dv.getUint16(p + 5, true);
    const size = dv.getUint16(p + 7, true);
    p += hl;
    const pat: Cell[][] = [];
    let q = p;
    for (let r = 0; r < rows; r++) {
      const row: Cell[] = [];
      for (let c = 0; c < channels; c++) {
        const cell: Cell = { note: 0, ins: 0, vol: 0, fx: 0, param: 0 };
        if (size > 0) {
          const b = d[q++]!;
          if (b & 0x80) {
            if (b & 1) cell.note = d[q++]!;
            if (b & 2) cell.ins = d[q++]!;
            if (b & 4) cell.vol = d[q++]!;
            if (b & 8) cell.fx = d[q++]!;
            if (b & 16) cell.param = d[q++]!;
          } else {
            cell.note = b;
            cell.ins = d[q++]!;
            cell.vol = d[q++]!;
            cell.fx = d[q++]!;
            cell.param = d[q++]!;
          }
        }
        row.push(cell);
      }
      pat.push(row);
    }
    patterns.push(pat);
    p += size;
  }
  const instruments: Instrument[] = [];
  for (let i = 0; i < ni; i++) {
    const size = dv.getUint32(p, true);
    const ns = dv.getUint16(p + 27, true);
    const ins: Instrument = {
      sampleFor: new Uint8Array(96),
      samples: [],
      volEnv: { points: [], sustain: 0, loopStart: 0, loopEnd: 0, on: false, sustainOn: false, loopOn: false },
      fadeout: 0,
    };
    let shs = 0;
    if (ns > 0) {
      shs = dv.getUint32(p + 29, true);
      ins.sampleFor.set(d.subarray(p + 33, p + 33 + 96));
      const n = d[p + 225]!;
      for (let k = 0; k < n; k++) ins.volEnv.points.push([dv.getUint16(p + 129 + k * 4, true), dv.getUint16(p + 131 + k * 4, true)]);
      ins.volEnv.sustain = d[p + 227]!;
      ins.volEnv.loopStart = d[p + 228]!;
      ins.volEnv.loopEnd = d[p + 229]!;
      const t = d[p + 233]!;
      ins.volEnv.on = (t & 1) !== 0;
      ins.volEnv.sustainOn = (t & 2) !== 0;
      ins.volEnv.loopOn = (t & 4) !== 0;
      ins.fadeout = dv.getUint16(p + 239, true);
    }
    p += size;
    const heads: { len: number; ls: number; ll: number; vol: number; fine: number; type: number; pan: number; rel: number }[] = [];
    for (let s = 0; s < ns; s++) {
      heads.push({
        len: dv.getUint32(p, true),
        ls: dv.getUint32(p + 4, true),
        ll: dv.getUint32(p + 8, true),
        vol: d[p + 12]!,
        fine: dv.getInt8(p + 13),
        type: d[p + 14]!,
        pan: d[p + 15]!,
        rel: dv.getInt8(p + 16),
      });
      p += shs;
    }
    for (const h of heads) {
      const is16 = (h.type & 16) !== 0;
      const n = is16 ? h.len >> 1 : h.len;
      const data = new Float32Array(n);
      let acc = 0;
      for (let k = 0; k < n; k++) {
        // Delta-encoded samples.
        if (is16) {
          acc = (acc + dv.getInt16(p + k * 2, true)) << 16 >> 16;
          data[k] = acc / 32768;
        } else {
          acc = (acc + dv.getInt8(p + k)) << 24 >> 24;
          data[k] = acc / 128;
        }
      }
      p += h.len;
      const div = is16 ? 2 : 1;
      ins.samples.push({
        data,
        loopStart: h.ls / div,
        loopLen: (h.type & 3) ? h.ll / div : 0,
        pingPong: (h.type & 3) === 2,
        volume: h.vol,
        finetune: h.fine,
        relNote: h.rel,
        panning: h.pan,
      });
    }
    instruments.push(ins);
  }
  return { channels, order, restart, patterns, instruments, speed, bpm };
}

interface Voice {
  ins: Instrument | null;
  sample: Sample | null;
  pos: number;
  step: number;
  dir: 1 | -1;
  period: number;
  volume: number;
  panning: number;
  keyOn: boolean;
  envTick: number;
  fade: number;
  slide: number;
}

/** Streams an XM module into an AudioContext. */
export class XmPlayer {
  private voices: Voice[];
  private orderIndex = 0;
  private row = 0;
  private tickInRow = 0;
  private speed: number;
  private bpm: number;
  private samplesLeftInTick = 0;
  private timer = 0;
  private nextTime = 0;
  private readonly gain: GainNode;
  private sources: AudioBufferSourceNode[] = [];

  constructor(private readonly ctx: AudioContext, private readonly mod: XmModule, destination: AudioNode) {
    this.speed = mod.speed;
    this.bpm = mod.bpm;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0.5;
    this.gain.connect(destination);
    this.voices = Array.from({ length: mod.channels }, () => ({
      ins: null, sample: null, pos: 0, step: 0, dir: 1 as const, period: 0, volume: 0, panning: 128, keyOn: false, envTick: 0, fade: 65536, slide: 0,
    }));
  }

  start(): void {
    if (this.timer) return;
    this.nextTime = this.ctx.currentTime + 0.05;
    this.pump();
    this.timer = window.setInterval(() => this.pump(), 200);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = 0;
    for (const s of this.sources) s.stop();
    this.sources = [];
  }

  /** Back to the start of the song (the original restarts the music in some places). */
  rewind(): void {
    this.orderIndex = 0;
    this.row = 0;
    this.tickInRow = 0;
    this.samplesLeftInTick = 0;
    this.speed = this.mod.speed;
    this.bpm = this.mod.bpm;
    for (const v of this.voices) v.sample = null;
  }

  private pump(): void {
    // Keep ~0.6 s queued.
    while (this.nextTime < this.ctx.currentTime + 0.6) {
      const n = Math.floor(this.ctx.sampleRate * 0.25);
      const buf = this.ctx.createBuffer(2, n, this.ctx.sampleRate);
      this.render(buf.getChannelData(0), buf.getChannelData(1));
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.gain);
      if (this.nextTime < this.ctx.currentTime) this.nextTime = this.ctx.currentTime + 0.02;
      src.start(this.nextTime);
      this.nextTime += n / this.ctx.sampleRate;
      this.sources.push(src);
      src.onended = () => (this.sources = this.sources.filter((s) => s !== src));
    }
  }

  private render(left: Float32Array, right: Float32Array): void {
    const rate = this.ctx.sampleRate;
    let i = 0;
    while (i < left.length) {
      if (this.samplesLeftInTick <= 0) {
        this.tick();
        this.samplesLeftInTick = Math.round((rate * 2.5) / this.bpm);
      }
      const n = Math.min(this.samplesLeftInTick, left.length - i);
      for (const v of this.voices) this.mix(v, left, right, i, n);
      i += n;
      this.samplesLeftInTick -= n;
    }
  }

  private mix(v: Voice, left: Float32Array, right: Float32Array, at: number, n: number): void {
    const s = v.sample;
    if (!s || v.step === 0) return;
    const amp = (v.volume / 64) * (this.envelope(v) / 64) * (v.fade / 65536) * (s.volume >= 0 ? 1 : 0);
    if (amp <= 0) return;
    const pr = v.panning / 255;
    const la = amp * Math.sqrt(1 - pr), ra = amp * Math.sqrt(pr);
    const data = s.data;
    const loopEnd = s.loopStart + s.loopLen;
    for (let k = 0; k < n; k++) {
      const ip = Math.floor(v.pos);
      if (ip >= data.length || ip < 0) {
        v.sample = null;
        return;
      }
      const x = data[ip]!;
      left[at + k]! += x * la;
      right[at + k]! += x * ra;
      v.pos += v.step * v.dir;
      if (s.loopLen > 0) {
        if (v.dir > 0 && v.pos >= loopEnd) {
          if (s.pingPong) {
            v.dir = -1;
            v.pos = loopEnd - (v.pos - loopEnd) - 1;
          } else {
            v.pos -= s.loopLen;
          }
        } else if (v.dir < 0 && v.pos < s.loopStart) {
          v.dir = 1;
          v.pos = s.loopStart + (s.loopStart - v.pos);
        }
      }
    }
  }

  private envelope(v: Voice): number {
    const env = v.ins?.volEnv;
    if (!env || !env.on || env.points.length === 0) return 64;
    const pts = env.points;
    const t = v.envTick;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i]!, [x1, y1] = pts[i + 1]!;
      if (t >= x0 && t < x1) return y0 + ((y1 - y0) * (t - x0)) / (x1 - x0);
    }
    return pts[pts.length - 1]![1];
  }

  private advanceEnvelope(v: Voice): void {
    const env = v.ins?.volEnv;
    if (!env || !env.on || env.points.length === 0) return;
    const pts = env.points;
    if (env.sustainOn && v.keyOn && v.envTick === pts[env.sustain]?.[0]) return;
    v.envTick++;
    if (env.loopOn && v.envTick >= (pts[env.loopEnd]?.[0] ?? 0)) v.envTick = pts[env.loopStart]?.[0] ?? 0;
    if (!v.keyOn && v.ins) v.fade = Math.max(0, v.fade - v.ins.fadeout);
  }

  private setFrequency(v: Voice): void {
    // Linear frequency table: period = 7680 - note*64 - finetune/2.
    const freq = 8363 * Math.pow(2, (4608 - v.period) / 768);
    v.step = freq / this.ctx.sampleRate;
  }

  private tick(): void {
    if (this.tickInRow === 0) this.playRow();
    else {
      for (const v of this.voices) if (v.slide) v.volume = Math.max(0, Math.min(64, v.volume + v.slide));
    }
    for (const v of this.voices) this.advanceEnvelope(v);
    if (++this.tickInRow >= this.speed) {
      this.tickInRow = 0;
      this.row++;
      const pat = this.mod.patterns[this.mod.order[this.orderIndex]!]!;
      if (this.row >= pat.length) this.nextOrder(0);
    }
  }

  private nextOrder(row: number): void {
    this.orderIndex++;
    if (this.orderIndex >= this.mod.order.length) this.orderIndex = this.mod.restart;
    this.row = row;
  }

  private playRow(): void {
    const pat = this.mod.patterns[this.mod.order[this.orderIndex]!]!;
    const cells = pat[this.row]!;
    let jump = -1, brk = -1;
    cells.forEach((c, ch) => {
      const v = this.voices[ch]!;
      v.slide = 0;
      if (c.ins > 0 && c.ins <= this.mod.instruments.length) {
        v.ins = this.mod.instruments[c.ins - 1]!;
      }
      if (c.note === 97) {
        v.keyOn = false;
        if (!v.ins?.volEnv.on) v.sample = null;
      } else if (c.note > 0 && v.ins) {
        const s = v.ins.samples[v.ins.sampleFor[c.note - 1] ?? 0];
        if (s) {
          v.sample = s;
          v.pos = 0;
          v.dir = 1;
          v.period = 7680 - (c.note - 1 + s.relNote) * 64 - s.finetune / 2;
          v.keyOn = true;
          v.envTick = 0;
          v.fade = 65536;
          this.setFrequency(v);
        }
      }
      if (c.ins > 0 && v.sample) {
        v.volume = v.sample.volume;
        v.panning = v.sample.panning;
      }
      if (c.vol >= 0x10 && c.vol <= 0x50) v.volume = c.vol - 0x10;
      switch (c.fx) {
        case 0xa: {
          const up = c.param >> 4, down = c.param & 15;
          v.slide = up ? up : -down;
          break;
        }
        case 0xb:
          jump = c.param;
          break;
        case 0xc:
          v.volume = Math.min(64, c.param);
          break;
        case 0xd:
          brk = (c.param >> 4) * 10 + (c.param & 15);
          break;
        case 0xf:
          if (c.param > 0 && c.param < 32) this.speed = c.param;
          else if (c.param >= 32) this.bpm = c.param;
          break;
      }
    });
    if (jump >= 0 || brk >= 0) {
      // Takes effect after this row: emulate by moving to the row before the target.
      if (jump >= 0) this.orderIndex = jump - 1;
      this.nextOrder(Math.max(0, brk));
      this.row--; // tick() increments after the row
    }
  }
}
