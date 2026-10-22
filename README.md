# Supaplex Web

A faithful browser remake of **Supaplex** (DOS, 1991), playable with keyboard or touch.

- The game logic is a TypeScript port of the original's game loop as reverse-engineered by
  [OpenSupaplex](https://github.com/sergiou87/open-supaplex) (GPL-3.0, © Sergio Padrino), so
  timings, random numbers and quirks match the DOS game. Because of that port, this project is
  GPL-3.0 as well.
- Graphics, levels and fonts are read at runtime from the original's data files
  (`original_game/`, not in git).

## Run

```
npm install
npm run dev      # http://localhost:5173/?level=1
npm test         # includes replaying the original DEMO*.BIN files (needs original_game/)
```

Live: https://werzawerz.github.io/superplex/ — GitHub Actions builds every push to main. The data
files the game reads are published in `public/original/` (Supaplex is freeware); refresh them with
`node tools/copy-original.mjs`.

Controls: arrows, Space (eat without moving / hold to drop a red disk), Esc (give up), P (pause).
Touch: drag anywhere = held direction (floating stick), quick flick = one step, hold still or
second finger = Space.
