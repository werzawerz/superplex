// The 320×200 VGA screen: a buffer of palette indices turned into canvas pixels each frame.
import { glyphRows, type IndexedBitmap, type Palette } from './data/formats';
import { levelBitmap, LEVEL_BITMAP_W, LEVEL_BITMAP_H } from './sim/draw';

export const SCREEN_W = 320;
export const SCREEN_H = 200;
export const PANEL_H = 24;

export class Screen {
  readonly pixels = new Uint8Array(SCREEN_W * SCREEN_H);
  private readonly ctx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly rgba: Uint32Array;
  private lut = new Uint32Array(16);

  constructor(readonly canvas: HTMLCanvasElement) {
    canvas.width = SCREEN_W;
    canvas.height = SCREEN_H;
    this.ctx = canvas.getContext('2d')!;
    this.image = this.ctx.createImageData(SCREEN_W, SCREEN_H);
    this.rgba = new Uint32Array(this.image.data.buffer);
  }

  setPalette(p: Palette): void {
    // ImageData is RGBA in memory: little-endian 0xAABBGGRR.
    this.lut = Uint32Array.from(p, ([r, g, b]) => (0xff000000 | (b << 16) | (g << 8) | r) >>> 0);
  }

  /** The visible part of the level (original: drawLevelViewport, clamped). */
  drawLevel(scrollX: number, scrollY: number, height: number): void {
    const x0 = Math.max(0, Math.min(scrollX, LEVEL_BITMAP_W - SCREEN_W));
    const y0 = Math.max(0, Math.min(scrollY, LEVEL_BITMAP_H - height));
    for (let y = 0; y < height; y++) {
      const src = (y0 + y) * LEVEL_BITMAP_W + x0;
      this.pixels.set(levelBitmap.subarray(src, src + SCREEN_W), y * SCREEN_W);
    }
  }

  blit(src: IndexedBitmap, dx: number, dy: number): void {
    for (let y = 0; y < src.height; y++) {
      this.pixels.set(src.pixels.subarray(y * src.width, (y + 1) * src.width), (dy + y) * SCREEN_W + dx);
    }
  }

  /** CHARS8 text, opaque: background pixels become colour 0 (as the original). */
  text(font: Uint8Array, x: number, y: number, color: number, s: string): void {
    for (let i = 0; i < s.length; i++) {
      const rows = glyphRows(font, s[i]!);
      for (let r = 0; r < 7; r++) {
        for (let b = 0; b < 8; b++) {
          const px = x + i * 8 + b;
          if (px < SCREEN_W) this.pixels[(y + r) * SCREEN_W + px] = (rows[r]! >> (7 - b)) & 1 ? color : 0;
        }
      }
    }
  }

  present(): void {
    const lut = this.lut, px = this.pixels, out = this.rgba;
    for (let i = 0; i < px.length; i++) out[i] = lut[px[i]!]!;
    this.ctx.putImageData(this.image, 0, 0);
  }
}
