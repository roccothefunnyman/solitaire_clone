# Solitaire

Klondike solitaire for the browser — plays like the Windows version, looks like it was built
this decade. No frameworks, no image assets, no audio files; every card, sound and effect is
generated at runtime.

```bash
npm install
npm run dev      # http://localhost:5183
npm run build    # static bundle in dist/
```

## The game

Standard Klondike. Seven tableau columns, four foundations, build down in alternating colours,
only a king starts an empty column, aces go home first.

- **Draw one or draw three**, switchable in Options.
- **Scoring** — Standard (Windows rules: +10 to a foundation, +5 waste→tableau, +5 for turning
  a card, −15 back off a foundation, deck-recycling penalties after the third pass), Vegas
  (−52 stake, +5 a card, limited passes), or none.
- **Timed play** — a small penalty as the clock runs and a bonus for finishing fast.
- **Undo** the whole game, back to the deal.
- **Auto-finish** appears once no card is face down.
- **Hint** highlights the most useful move it can find.
- Games, options and statistics persist; an unfinished game is waiting when you come back.

## Controls

| | |
| --- | --- |
| Drag | Move a card or a run |
| Double-click / right-click | Send a card home, or to the best column |
| Tap (touch) | Same as double-click |
| Click the stock | Draw; click the empty stock to redeal the waste |
| `Space` / `Enter` | Draw |
| `N` · `R` · `U` · `H` · `A` | New game · restart this deal · undo · hint · auto-finish |
| `Ctrl`/`⌘` + `Z` | Undo |

## Looks

Five table themes, four card backs, a light mode, and a left-handed layout that moves the stock
to the right. Reduced-motion is respected — and can be forced on in Options, which also skips
the bouncing-cards finale.
