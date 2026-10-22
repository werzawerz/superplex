# Roadmap

Done
- Original data decoders (FIXED/MOVING/PANEL/PALETTES/CHARS8/LEVELS.DAT, demos).
- Game logic ported from OpenSupaplex; verified by replaying the original demos (`src/sim/demo.test.ts`).
- Level picture drawn like the original (sprites copied into a 944×368 level bitmap), camera with
  the original's scroll and end-of-level shake, bottom panel.
- Keyboard + touch (floating drag stick, flick = one step, hold/2nd finger = space), pause menu.
- Level flow: win → next level, death → retry.

Next
- Sound effects and music (original samples).
- Title, main menu, player list, level list (MENU.DAT, CHARS6), level-complete flow as the original.
- Fade in/out with the original palettes; Enter toggles the panel; Right Shift shows red disks.
- Deploy to GitHub Pages (owner decides on publishing the original files).
- Check on a real iPhone (Safari).
