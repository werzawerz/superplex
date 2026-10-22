# Roadmap

Done
- Original data decoders (FIXED/MOVING/PANEL/PALETTES/CHARS6/CHARS8/LEVELS.DAT, full screens, demos).
- Game logic ported from OpenSupaplex; verified by replaying the original demos (`src/sim/demo.test.ts`).
- Level picture drawn like the original, camera with the original's scroll and shake, bottom panel
  (Enter toggles it, Right Shift shows red disks), panel slide-down at the end of a level.
- Intro (TITLE → TITLE1 → credits block → TITLE2), main menu from MENU.DAT with all its parts and
  buttons, players/progress/rankings/hall of fame stored in the browser, statistics, credits,
  congratulations, HARD LUCK screen, GFX-tutor, Controls (sound card, music, FX), demos (button,
  F1..F10, after a minute idle).
- Sound effects (OpenSupaplex recordings of each sound card) with the original priorities; XM music.
- Keyboard + touch (floating drag stick, flick = one step, hold/2nd finger = space), pause menu.
- GitHub Pages workflow; `node tools/copy-original.mjs` puts the data files in public/original/.

Next
- Owner decisions: publish the original data files + public repo → deploy.
- Check on a real iPhone (Safari): audio unlock, touch stick feel, name entry prompt.
- Level sets (floppy button: LEVELS.D01..), Escape options menu of SpeedFix versions (not in 1991 game).
- Compare timings/looks with the DOS game in an emulator (intro pacing, fades).
