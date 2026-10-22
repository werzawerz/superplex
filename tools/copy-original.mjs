// Copies the original data files the game reads from original_game/ to public/original/
// (served at <base>/original/ in production). Only do this if you may publish them.
import { cpSync, mkdirSync, existsSync } from 'node:fs';

const files = [
  'MOVING.DAT', 'FIXED.DAT', 'PANEL.DAT', 'PALETTES.DAT', 'CHARS6.DAT', 'CHARS8.DAT', 'LEVELS.DAT',
  'TITLE.DAT', 'TITLE1.DAT', 'TITLE2.DAT', 'MENU.DAT', 'BACK.DAT', 'GFX.DAT', 'CONTROLS.DAT',
  ...Array.from({ length: 10 }, (_, i) => `DEMO${i}.BIN`),
];
mkdirSync('public/original/audio', { recursive: true });
for (const f of files) cpSync(`original_game/${f}`, `public/original/${f}`);
for (const s of ['base', 'bug', 'exit', 'explosion', 'fall', 'infotron', 'push']) {
  for (const t of ['adlib', 'beep', 'blaster', 'roland', 'sample']) {
    const f = `audio/${s}-${t}.wav`;
    if (existsSync(`original_game/${f}`)) cpSync(`original_game/${f}`, `public/original/${f}`);
  }
}
for (const t of ['adlib', 'beep', 'roland']) cpSync(`original_game/audio/music-${t}.xm`, `public/original/audio/music-${t}.xm`);
console.log('copied to public/original/');
