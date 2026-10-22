// The level picture, drawn the way the original does: the fixed tiles once at level start,
// then the game logic copies sprite frames from MOVING.DAT over it as things move.
import { LEVEL_W, LEVEL_H, type IndexedBitmap } from '../data/formats';

export const kLevelEdgeSize = 8;
const kTileSize = 16;
export const LEVEL_BITMAP_W = kTileSize * (LEVEL_W - 2) + 2 * kLevelEdgeSize; // 944
export const LEVEL_BITMAP_H = kTileSize * (LEVEL_H - 2) + 2 * kLevelEdgeSize; // 368

/** 4-bit palette indices of the level picture. */
export const levelBitmap = new Uint8Array(LEVEL_BITMAP_W * LEVEL_BITMAP_H);
let moving: IndexedBitmap = { width: 320, height: 462, pixels: new Uint8Array(320 * 462) };
let fixed: IndexedBitmap = { width: 640, height: 16, pixels: new Uint8Array(640 * 16) };

export function setSpriteSheets(movingDat: IndexedBitmap, fixedDat: IndexedBitmap): void {
  moving = movingDat;
  fixed = fixedDat;
}

/** Copies a w×h block of MOVING.DAT to level coordinates (tile (x,y) is at x*16, y*16 here). */
export function drawMovingSpriteFrameInLevel(srcX: number, srcY: number, width: number, height: number, dstX: number, dstY: number): void {
  for (let y = 0; y < height; y++) {
    const fy = dstY + y - kLevelEdgeSize;
    if (fy < 0 || fy >= LEVEL_BITMAP_H) continue;
    const fx = dstX - kLevelEdgeSize;
    const w = Math.min(width, LEVEL_BITMAP_W - fx);
    const src = (srcY + y) * moving.width + srcX;
    const dst = fy * LEVEL_BITMAP_W + fx;
    for (let x = 0; x < w; x++) if (fx + x >= 0) levelBitmap[dst + x] = moving.pixels[src + x]!;
  }
}

export function drawMovingFrame(srcX: number, srcY: number, position: number): void {
  drawMovingSpriteFrameInLevel(srcX, srcY, kTileSize, kTileSize, (position % LEVEL_W) * kTileSize, Math.trunc(position / LEVEL_W) * kTileSize);
}

/** The terminal's screen scroll: rows 3..11 move up one, row 2 goes to row 10. */
export function scrollTerminalScreen(position: number): void {
  const x = kLevelEdgeSize + ((position % LEVEL_W) - 1) * kTileSize;
  const y = kLevelEdgeSize + (Math.trunc(position / LEVEL_W) - 1) * kTileSize;
  const row = (r: number) => (y + r) * LEVEL_BITMAP_W + x;
  levelBitmap.copyWithin(row(10), row(2), row(2) + kTileSize);
  for (let i = 0; i < 9; i++) levelBitmap.copyWithin(row(2 + i), row(3 + i), row(3 + i) + kTileSize);
}

function blit(src: IndexedBitmap, sx: number, sy: number, w: number, h: number, dx: number, dy: number): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      levelBitmap[(dy + y) * LEVEL_BITMAP_W + dx + x] = src.pixels[(sy + y) * src.width + sx + x]!;
    }
  }
}

/** Draws the 8-px frame and every inner tile from FIXED.DAT (original: drawFixedLevel). */
export function drawFixedLevel(tiles: Uint8Array): void {
  const E = kLevelEdgeSize, W = LEVEL_BITMAP_W, H = LEVEL_BITMAP_H;
  const px = (x: number, y: number, sx: number, sy: number) => {
    levelBitmap[y * W + x] = moving.pixels[sy * moving.width + sx]!;
  };
  // Same order and ranges as the original (the edges overwrite one row/column of two corners).
  for (let y = 0; y < E; y++) for (let x = 0; x < E; x++) px(x, y, 288 + x, 388 + y); // top-left
  for (let y = 0; y < E; y++) for (let x = E - 1; x < W - E; x++) px(x, y, 304 + (x % E), 396 + y); // top
  for (let y = 0; y < E; y++) for (let x = W - E; x < W; x++) px(x, y, 296 + x - W + E, 388 + y); // top-right
  for (let y = E - 1; y < H - E; y++) for (let x = W - E; x < W; x++) px(x, y, 304 + x - W + E, 388 + (y % E)); // right
  for (let y = H - E; y < H; y++) for (let x = W - E; x < W; x++) px(x, y, 296 + x - W + E, 396 + y - H + E); // bottom-right
  for (let y = H - E; y < H; y++) for (let x = E - 1; x < W - E; x++) px(x, y, 304 + (x % E), 396 + y - H + E); // bottom
  for (let y = E - 1; y < H - E; y++) for (let x = 0; x < E; x++) px(x, y, 312 + x, 388 + (y % E)); // left
  for (let y = H - E; y < H; y++) for (let x = 0; x < E; x++) px(x, y, 288 + x, 396 + y - H + E); // bottom-left
  for (let ty = 1; ty < LEVEL_H - 1; ty++) {
    for (let tx = 1; tx < LEVEL_W - 1; tx++) {
      let t = tiles[ty * LEVEL_W + tx]!;
      if (t >= 40) t = 0;
      blit(fixed, t * kTileSize, 0, kTileSize, kTileSize, E + (tx - 1) * kTileSize, E + (ty - 1) * kTileSize);
    }
  }
}
