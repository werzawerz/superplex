// Sound effects and music. One effect at a time with the original's priorities and durations
// (playExplosionSound etc.: a lower-priority sound can't interrupt a higher one until it ends).
import { parseXm, XmPlayer } from './xm';
import type { SoundId } from '../sim/logic';

const BASE = import.meta.env.DEV ? '/original_game/audio/' : `${import.meta.env.BASE_URL}original/audio/`;

// Priority and duration (in the original's 20 ms clock units) of each sound.
const RULES: Record<SoundId, { priority: number; duration: number; blockedFrom: number }> = {
  explosion: { priority: 5, duration: 15, blockedFrom: 5 },
  infotron: { priority: 4, duration: 15, blockedFrom: 5 },
  bug: { priority: 3, duration: 3, blockedFrom: 3 },
  push: { priority: 2, duration: 7, blockedFrom: 2 },
  fall: { priority: 2, duration: 7, blockedFrom: 2 },
  base: { priority: 1, duration: 3, blockedFrom: 1 },
  exit: { priority: 10, duration: 250, blockedFrom: 99 },
};

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode */
  }
}

/** The original's sound card choices (Controls screen): which music and which effects. */
export type SoundType = 'adlib' | 'blaster' | 'roland' | 'combined' | 'standard' | 'samples';
const SOUND_FILES: Record<SoundType, { music: string; fx: string }> = {
  adlib: { music: 'adlib', fx: 'adlib' },
  blaster: { music: 'adlib', fx: 'blaster' },
  roland: { music: 'roland', fx: 'roland' },
  combined: { music: 'roland', fx: 'blaster' },
  standard: { music: 'beep', fx: 'beep' },
  samples: { music: 'beep', fx: 'sample' },
};

export class Audio {
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Set<string>();
  private musicName = '';
  private current: AudioBufferSourceNode | null = null;
  private priority = 0;
  private until = 0;
  private music: XmPlayer | null = null;
  private musicWanted = false;
  fxOn = load('supaplex.fx', true);
  // No config file in the original = Combined (Roland music, Sound Blaster effects).
  soundType: SoundType = load<SoundType>('supaplex.soundType', 'combined');
  musicOn = load('supaplex.music', true);

  constructor() {
    // Browsers (and iOS) only start audio from a user gesture.
    const unlock = () => this.unlock();
    for (const ev of ['pointerdown', 'touchend', 'keydown', 'click']) addEventListener(ev, unlock, { capture: true });
    // iOS: play even with the silent switch on.
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = 'playback';
  }

  private unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      void this.loadAll();
    }
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  private async loadAll(): Promise<void> {
    await Promise.all([this.loadFx(), this.loadMusic()]);
  }

  private async fetchBuffer(name: string): Promise<void> {
    const ctx = this.ctx!;
    if (this.buffers.has(name) || this.loading.has(name)) return;
    this.loading.add(name);
    try {
      const res = await fetch(`${BASE}${name}.wav`);
      if (res.ok) this.buffers.set(name, await ctx.decodeAudioData(await res.arrayBuffer()));
    } catch {
      /* no sound for this one */
    }
    this.loading.delete(name);
  }

  private async loadFx(): Promise<void> {
    const fx = SOUND_FILES[this.soundType].fx;
    await Promise.all((Object.keys(RULES) as SoundId[]).map((id) => this.fetchBuffer(`${id}-${fx}`)));
  }

  private async loadMusic(): Promise<void> {
    const ctx = this.ctx!;
    const name = SOUND_FILES[this.soundType].music;
    if (this.musicName === name) return;
    this.musicName = name;
    try {
      const res = await fetch(`${BASE}music-${name}.xm`);
      if (!res.ok || this.musicName !== name) return;
      const player = new XmPlayer(ctx, parseXm(await res.arrayBuffer()), ctx.destination);
      if (this.musicName !== name) return;
      this.music?.stop();
      this.music = player;
      if (this.musicWanted && this.musicOn) this.music.start();
    } catch {
      /* no music */
    }
  }

  /** Switches sound card emulation like the original's Controls screen (restarts the music). */
  setSoundType(t: SoundType): void {
    this.soundType = t;
    save('supaplex.soundType', t);
    this.priority = 0;
    this.until = 0;
    if (!this.ctx) return;
    void this.loadFx();
    void this.loadMusic();
  }

  play(id: SoundId): void {
    if (!this.fxOn || !this.ctx) return;
    const now = performance.now();
    if (now >= this.until) this.priority = 0;
    const r = RULES[id];
    if (this.priority >= r.blockedFrom) return;
    this.priority = r.priority;
    this.until = now + r.duration * 20;
    if (id === 'exit') this.stopMusic();
    const buf = this.buffers.get(`${id}-${SOUND_FILES[this.soundType].fx}`);
    if (!buf) return;
    this.current?.stop();
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    src.start();
    this.current = src;
  }

  startMusic(): void {
    this.musicWanted = true;
    if (this.musicOn) this.music?.start();
  }

  stopMusic(): void {
    this.musicWanted = false;
    this.music?.stop();
    this.music?.rewind();
  }

  setFx(on: boolean): void {
    this.fxOn = on;
    save('supaplex.fx', on);
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    save('supaplex.music', on);
    if (on && this.musicWanted) this.music?.start();
    else this.music?.stop();
  }
}
