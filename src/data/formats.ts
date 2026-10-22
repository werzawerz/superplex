// Decoders for the original Supaplex data files. Pure functions over bytes (no DOM), so the
// game, the tests and the tools/ scripts share them. Format notes: .claude/skills/supaplex-formats.

/** A decoded 4-bit picture: one palette index (0..15) per pixel. */
export interface IndexedBitmap {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/**
 * Planar EGA-style bitmap: each row is 4 planes of width/8 bytes (plane 0 = bit 0 of the colour
 * index ... plane 3 = bit 3), most significant bit = leftmost pixel.
 * FIXED.DAT 640×16, MOVING.DAT 320×462, PANEL.DAT 320×24.
 */
export function decodePlanar(data: Uint8Array, width: number, height: number): IndexedBitmap {
  const rowBytes = width / 8;
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * rowBytes * 4;
    for (let x = 0; x < width; x++) {
      const byte = row + (x >> 3);
      const bit = 7 - (x & 7);
      let c = 0;
      for (let p = 0; p < 4; p++) c |= ((data[byte + p * rowBytes]! >> bit) & 1) << p;
      pixels[y * width + x] = c;
    }
  }
  return { width, height, pixels };
}

/**
 * Full-screen 320×200 pictures (MENU.DAT, BACK.DAT, CONTROLS.DAT, GFX.DAT, TITLE*.DAT) use the
 * same planar row layout.
 */
export function decodeScreen(data: Uint8Array): IndexedBitmap {
  return decodePlanar(data, 320, 200);
}

export type Rgb = [number, number, number];
export type Palette = Rgb[];

/** PALETTES.DAT: 4 palettes × 16 colours × (r, g, b, unused), each 0..15. */
export function decodePalettes(data: Uint8Array): Palette[] {
  const out: Palette[] = [];
  for (let p = 0; p < 4; p++) {
    const pal: Palette = [];
    for (let i = 0; i < 16; i++) {
      const o = (p * 16 + i) * 4;
      pal.push([data[o]! * 17, data[o + 1]! * 17, data[o + 2]! * 17]);
    }
    out.push(pal);
  }
  return out;
}

/** Which palette in PALETTES.DAT is used where. */
export const PALETTE_INFO = 0;
export const PALETTE_GAME = 1;
export const PALETTE_CONTROLS = 2;
export const PALETTE_GAME_DIMMED = 3;

/**
 * CHARS6.DAT / CHARS8.DAT: 64 glyphs from ' ', 7 rows used. Stored row by row: byte
 * (row * 64 + glyph), MSB = leftmost pixel. Returns the 7 row bytes of a character.
 */
export function glyphRows(font: Uint8Array, ch: string): number[] {
  let code = ch.toUpperCase().charCodeAt(0) - 0x20;
  if (code < 0 || code >= 64) code = 0;
  const rows: number[] = [];
  for (let y = 0; y < 7; y++) rows.push(font[y * 64 + code] ?? 0);
  return rows;
}

// ---------------------------------------------------------------- levels

export const LEVEL_W = 60;
export const LEVEL_H = 24;
export const LEVEL_SIZE = 1536;

/** Raw bytes as the game uses them: gravity 1 = on, freezeZonks 2 = on, freezeEnemies 1 = on. */
export interface SpecialPort {
  position: number; // tile index y*60+x
  gravity: number;
  freezeZonks: number;
  freezeEnemies: number;
}

export interface LevelData {
  tiles: Uint8Array; // LEVEL_W × LEVEL_H tile ids (see Tile in sim/tiles.ts)
  gravity: number; // 1 = on
  name: string;
  freezeZonks: number; // 2 = on
  infotronsNeeded: number; // 0 = all infotrons in the level
  specialPorts: SpecialPort[];
  /** Random seed the original uses when replaying a demo of this level. */
  randomSeed: number;
  /** All 1536 bytes: the original loads them all as tiles (border glitches can reach them). */
  raw: Uint8Array;
}

/**
 * LEVELS.DAT: 111 levels × 1536 bytes. Per level: 1440 tile bytes (60×24, row-major), 4 unused,
 * gravity (1444), version (1445), name 23 chars (1446), freeze zonks (1469, 2 = on),
 * infotrons needed (1470), special port count (1471), 10 × 6-byte special ports (1472):
 * big-endian word = (y*60+x)*2, gravity, freeze zonks (2 = on), freeze enemies, unused.
 */
export function decodeLevel(file: Uint8Array, index: number): LevelData {
  const d = file.subarray(index * LEVEL_SIZE, (index + 1) * LEVEL_SIZE);
  const tiles = d.slice(0, LEVEL_W * LEVEL_H);
  let name = '';
  for (let i = 0; i < 23; i++) name += String.fromCharCode(d[1446 + i]!);
  const ports: SpecialPort[] = [];
  const count = Math.min(10, d[1471]!);
  for (let i = 0; i < count; i++) {
    const o = 1472 + i * 6;
    const pos = ((d[o]! << 8) | d[o + 1]!) / 2;
    ports.push({ position: pos, gravity: d[o + 2]!, freezeZonks: d[o + 3]!, freezeEnemies: d[o + 4]! });
  }
  return {
    tiles,
    gravity: d[1444]!,
    name: name.trim(),
    freezeZonks: d[1469]!,
    infotronsNeeded: d[1470]!,
    specialPorts: ports,
    randomSeed: d[1534]! | (d[1535]! << 8),
    raw: d.slice(),
  };
}

export function levelCount(file: Uint8Array): number {
  return Math.floor(file.length / LEVEL_SIZE);
}
