// Loads the original game's data files (dev: original_game/, production: <base>/original/).
import { decodePlanar, decodePalettes, type IndexedBitmap, type Palette } from './data/formats';

export interface Assets {
  moving: IndexedBitmap;
  fixed: IndexedBitmap;
  panel: IndexedBitmap;
  palettes: Palette[];
  chars8: Uint8Array;
  chars6: Uint8Array;
  levels: Uint8Array;
}

const BASE = import.meta.env.DEV ? '/original_game/' : `${import.meta.env.BASE_URL}original/`;

async function file(name: string): Promise<Uint8Array> {
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`Missing original file ${name} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function loadAssets(): Promise<Assets> {
  const [moving, fixed, panel, palettes, chars8, chars6, levels] = await Promise.all(
    ['MOVING.DAT', 'FIXED.DAT', 'PANEL.DAT', 'PALETTES.DAT', 'CHARS8.DAT', 'CHARS6.DAT', 'LEVELS.DAT'].map(file),
  );
  return {
    moving: decodePlanar(moving!, 320, 462),
    fixed: decodePlanar(fixed!, 640, 16),
    panel: decodePlanar(panel!, 320, 24),
    palettes: decodePalettes(palettes!),
    chars8: chars8!,
    chars6: chars6!,
    levels: levels!,
  };
}
