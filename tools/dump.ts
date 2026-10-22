// Dump the original's pictures to PNG (scaled ×2) for checking decoders and finding sprites.
// node tools/dump.ts [outDir]   (reads original_game/)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { decodePlanar, decodeScreen, decodePalettes, decodeLevel, type IndexedBitmap, type Palette } from '../src/data/formats.ts';

const out = process.argv[2] ?? 'screenshots/dump';
mkdirSync(out, { recursive: true });
const read = (f: string) => new Uint8Array(readFileSync(`original_game/${f}`));

function crcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
const CRC = crcTable();
function crc(buf: Buffer) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
function png(bm: IndexedBitmap, pal: Palette, scale = 2): Buffer {
  const w = bm.width * scale, h = bm.height * scale;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pal[bm.pixels[Math.floor(y / scale) * bm.width + Math.floor(x / scale)]!]!;
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const pals = decodePalettes(read('PALETTES.DAT'));
const game = pals[1]!;
writeFileSync(`${out}/fixed.png`, png(decodePlanar(read('FIXED.DAT'), 640, 16), game, 2));
writeFileSync(`${out}/moving.png`, png(decodePlanar(read('MOVING.DAT'), 320, 462), game, 3));
writeFileSync(`${out}/panel.png`, png(decodePlanar(read('PANEL.DAT'), 320, 24), game, 3));
const titlePal = (a: number[]) => Array.from({ length: 16 }, (_, i) => [a[i * 4]! * 17, a[i * 4 + 1]! * 17, a[i * 4 + 2]! * 17] as [number, number, number]);
const TITLE = [2,3,5,0,13,10,4,12,2,6,6,2,3,9,9,3,11,8,3,6,2,7,7,10,8,6,13,9,6,4,11,1,9,1,0,4,11,1,0,4,13,1,0,12,15,1,0,12,15,6,4,12,2,5,6,8,15,12,6,14,12,12,13,14];
const TITLE1 = [0,0,0,0,15,15,15,15,8,8,8,8,10,10,10,7,10,10,10,7,11,11,11,7,14,1,1,4,9,9,9,7,8,8,8,8,8,8,8,8,9,0,0,4,11,0,0,12,8,8,8,8,5,5,5,8,6,6,6,8,8,8,8,8];
const TITLE2 = [0,0,0,0,15,15,15,15,6,6,6,8,10,10,10,7,10,10,10,7,11,11,11,7,14,1,1,4,9,9,9,7,1,3,7,0,8,8,8,8,9,0,0,4,11,0,0,12,0,2,10,1,5,5,5,8,6,6,6,8,8,8,8,7];
writeFileSync(out + '/title.png', png(decodeScreen(read('TITLE.DAT')), titlePal(TITLE), 2));
writeFileSync(out + '/title1.png', png(decodeScreen(read('TITLE1.DAT')), titlePal(TITLE1), 2));
writeFileSync(out + '/title2.png', png(decodeScreen(read('TITLE2.DAT')), titlePal(TITLE2), 2));
for (const f of ['MENU', 'BACK', 'CONTROLS', 'GFX']) {
  writeFileSync(`${out}/${f.toLowerCase()}.png`, png(decodeScreen(read(`${f}.DAT`)), pals[f === 'CONTROLS' ? 2 : f === 'MENU' || f === 'GFX' ? 1 : 0]!, 2));
}
const lv = read('LEVELS.DAT');
for (let i = 0; i < 3; i++) {
  const l = decodeLevel(lv, i);
  console.log(i + 1, JSON.stringify(l.name), 'grav', l.gravity, 'need', l.infotronsNeeded, 'ports', l.specialPorts.length);
}
const l1 = decodeLevel(lv, 0);
for (let y = 0; y < 24; y++) console.log(Array.from(l1.tiles.subarray(y * 60, y * 60 + 60), (t) => ' 0123456789abcdefghijklmnopqrstuvwxyzABCDEF'[t + 1] ?? '?').join(''));
console.log('written to', out);
