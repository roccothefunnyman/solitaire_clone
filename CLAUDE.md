# solitaire_clone

A browser-based Klondike solitaire — the same game the Windows versions have shipped for
decades, rebuilt with a modern visual treatment.

## What this repo is for

Two goals, held together:

1. **Play exactly like Windows Klondike.** Standard/Vegas/no scoring, draw-one and draw-three,
   optional timed play with the classic bonus and penalties, unlimited redeals (limited in
   Vegas), undo, double-click to send a card home, auto-finish once nothing is face down.
   If a rule here differs from the Windows default, that's a bug.
2. **Look like it was made in 2026.** OKLCH colour, glass chrome, springy card motion, real
   pip-and-court card artwork drawn in SVG, a synthesised sound bed, and the bouncing-cards
   finale — all with no runtime dependencies.

## Stack

Vite + TypeScript, no framework. `npm run dev` to play, `npm run build` to ship a static
`dist/`. Everything is drawn from code — there are no image or audio assets.

## Layout

| Path | What lives there |
| --- | --- |
| `src/game/deck.ts` | Card model, seeded shuffle |
| `src/game/rules.ts` | Pure Klondike state machine: legality, moves, scoring, hints |
| `src/game/store.ts` | Undo stack, timer, localStorage save/prefs/stats, event bus |
| `src/ui/board.ts` | Slot geometry, card positioning, drag & drop, hit testing |
| `src/ui/cardArt.ts` | SVG card faces — pip layouts and court ornaments |
| `src/ui/winCascade.ts` | The bouncing-cards finale |
| `src/ui/sound.ts` | WebAudio synthesis, no files |
| `src/styles/` | `theme.css` (tokens + table themes), `cards.css`, `app.css` |
| `gallery.html` | Dev proof sheet of all 52 faces and 4 backs — `/gallery.html?w=150` |

## Working on it

- **Rules changes go in `rules.ts`, which is pure** — it takes a `GameState` and mutates it,
  with no DOM or storage access. Keep it that way; `store.ts` is where side effects belong.
- **The board never rebuilds its DOM mid-game.** One element per card lives for the whole deal
  and is repositioned with `transform`, so CSS transitions animate every move for free. If you
  find yourself re-rendering card HTML on a move, that's the wrong layer.
- **Card art is checked visually, not by tests.** After touching `cardArt.ts`, open
  `/gallery.html` and look at all 52.
- In dev, `window.__solitaire` exposes `{ store, board }` for poking at state from the console.
