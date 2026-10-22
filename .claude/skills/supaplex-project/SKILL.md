---
name: supaplex-project
description: Conventions and facts for the Supaplex web remake (architecture, original file formats, the OpenSupaplex logic port, demo verification, mobile controls, commands). Read before working on this repo.
---

# Supaplex web remake

Faithful to the DOS original beats modern. Same method as the Stunts remake (see the
`dos-game-remake` skill).

## Layout
- `src/data/formats.ts` — decoders. Planar 4-bit bitmaps: each row = 4 planes × width/8 bytes
  (plane p = bit p), MSB leftmost. FIXED.DAT 640×16 (40 tiles), MOVING.DAT 320×462 (all sprites),
  PANEL.DAT 320×24, full screens 320×200. PALETTES.DAT 4×16×(r,g,b,x) 0..15 (×17); palette 1 =
  game. CHARS8/CHARS6: byte (row*64 + glyph), 7 rows, glyph = ascii-32. LEVELS.DAT 111×1536:
  1440 tiles, gravity @1444, name @1446 (23), freeze zonks @1469 (2=on), infotrons @1470,
  special ports @1471/1472 (6 bytes: BE pos*2, gravity, freezeZonks, freezeEnemies), seed @1534 LE.
- `src/sim/logic.ts` — port of OpenSupaplex supaplex.c game logic (tile T[] + state S[] per
  cell, 35 ticks/s). Keep it close to the C: demos depend on exact behaviour. Generated tables:
  `tools/gen-tables.mjs` → `src/sim/tables.generated.ts` (do not edit). `draw.ts` = level bitmap
  (944×368, 8-px frame; tile (x,y) at x*16-8, y*16-8).
- `src/sim/demo.ts` + `demo.test.ts` — DEMO*.BIN: byte0 level, then (count-1)<<4 | input, 0xFF end.
  Input is read before every tick. The test checks each demo's level ends in its last 64 frames.
- `src/input.ts` — keyboard + touch → Input code (original updateUserInput priority).
- `src/main.ts` — flow: intro → menu → game. `?level=N` starts level N directly, `?skipintro`.
- `src/app/runtime.ts` — screens are async loops (`await rt.frame()` = one videoLoop), fades,
  slides, taps/keys in 320×200 coords, the animated mouse cursor (MOVING.DAT y=445).
- `src/app/menu.ts` — main menu + info screens + Controls, recreated from supaplex.c (positions,
  colours, texts). Button areas/border lines generated: `tools/gen-ui-tables.mjs` →
  `src/ui/tables.generated.ts`. `src/ui/players.ts` — PLAYER.LST/HALLFAME.LST logic (localStorage).
- `src/app/game.ts` — runLevel: fade, ticks at 35/s, panel, slide-down; demo playback.
- `src/audio/` — effects with the original priorities; `xm.ts` small XM player for the music.
  Sound types (Controls screen) pick OpenSupaplex's per-card recordings (`audio/<sound>-<card>.wav`).
- Palettes: 0 info screens (BACK.DAT), 1 game + menu + GFX, 2 Controls, 3 dimmed; title palettes are
  constants in main.ts (graphics.c gTitle*PaletteData).

## Reference
- `reference/open-supaplex/` (git-ignored): OpenSupaplex sources for facts.
- `original_game/` (git-ignored): data files from OpenSupaplex's `resources/` (Supaplex freeware).

## Tools
- `node tools/dump.ts` — original pictures → PNG in screenshots/dump.
- `node tools/shot.mjs out.png url keys wait` — headless screenshot.
- `node tools/phone.mjs url outDir portrait|landscape` — emulated iPhone touch test (use `?level=1`).
- `node tools/flow.mjs url outDir "wait:ms,key:Code,hold:Code:ms,click:x:y,shot:name"` — walk the screens.
- Deploy: `node tools/copy-original.mjs` then `MSYS_NO_PATHCONV=1 npx vite build --base=/<repo>/`.
- `src/_debug2.test.ts` (ignored) — render demo frames: `DEMO=1 FROM=0 EVERY=100 npx vitest run src/_debug2.test.ts`.
