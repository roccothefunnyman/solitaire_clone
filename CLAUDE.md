# solitaire_clone

A browser-based Klondike solitaire — the same game the Windows versions have shipped for
decades, rebuilt with a modern visual treatment.

## What this repo is for

Two goals, held together:

1. **Play exactly like Windows Klondike.** Standard/Vegas/no scoring, draw-one and draw-three,
   optional timed play with the classic bonus and penalties, unlimited redeals (limited in
   Vegas), undo, double-click to send a card home, auto-finish once nothing is face down.
   If a rule here differs from the Windows default, that's a bug. "Send home" means the
   foundations and nothing else — a click never relocates a card within the tableau and
   never takes one back off a foundation. Those are drag-only, so a stray or repeated
   click can't quietly dismantle a winnable position.
2. **Look like it was made in 2026.** OKLCH colour, glass chrome, springy card motion, real
   pip-and-court card artwork drawn in SVG, a synthesised sound bed, and the bouncing-cards
   finale — all with no runtime dependencies.

## Stack

Vite + TypeScript, no framework. `npm run dev` to play, `npm run build` to ship a static
`dist/`, `npm test` for the rules/store regression suite. Everything is drawn from code —
there are no image or audio assets.

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
- **`npm test` covers the rules and the store**, running Node's test runner straight against
  the TypeScript sources (`test/resolve-ts.mjs` supplies the extensionless imports Vite would
  otherwise resolve). Every test in there was written against a real bug and verified to fail
  before its fix — if you add one, check it fails first, or it isn't guarding anything.
- **Auto-finish must provably halt.** `nextAutoFinishMove` only offers a draw once it has
  simulated the stock/waste cycle and found a card that can actually go home; standard scoring
  has unlimited redeals, so anything less spins forever.
- **One gesture, one handler.** The double-click path lives solely in `onPointerUp` via
  `tapDecision`. A second `dblclick` listener used to fire the same gesture twice.
- In dev, `window.__solitaire` exposes `{ store, board }` for poking at state from the console.
