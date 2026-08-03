import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type Card, type Suit, SUITS, makeDeck, makeRng, shuffle } from '../src/game/deck';
import {
  ALL_PILES,
  FOUNDATIONS,
  type GameState,
  type Options,
  type PileId,
  TABLEAUS,
  autoMove,
  canAutoFinish,
  deal,
  drawFromStock,
  findFoundationFor,
  moveCards,
  nextAutoFinishMove,
  topOf,
} from '../src/game/rules';

const STANDARD: Options = { draw: 3, scoring: 'standard', timed: false };

function card(suit: Suit, rank: number, faceUp = true): Card {
  return { id: `${suit}-${rank}`, suit, rank, faceUp };
}

function emptyState(options: Options = STANDARD): GameState {
  const piles: Record<PileId, Card[]> = {};
  for (const id of ALL_PILES) piles[id] = [];
  return { piles, options, seed: 1, score: 0, moves: 0, passes: 0, won: false };
}

function allCards(state: GameState): Card[] {
  return ALL_PILES.flatMap((id) => state.piles[id]);
}

/** Runs auto-finish to a standstill. `halted: false` means it ran away. */
function driveAutoFinish(state: GameState, cap = 5000): { halted: boolean; steps: number } {
  for (let steps = 0; steps < cap; steps++) {
    const next = nextAutoFinishMove(state);
    if (!next) return { halted: true, steps };
    const ok =
      next.from === 'stock'
        ? drawFromStock(state) !== null
        : moveCards(state, next.from, next.index, next.to) !== null;
    if (!ok || state.won) return { halted: true, steps };
  }
  return { halted: false, steps: cap };
}

/* ------------------------------------------------------------------ the deck */

test('every deal is a complete, well-formed 52-card Klondike layout', () => {
  for (let seed = 0; seed < 2000; seed++) {
    const state = deal(seed, STANDARD);
    const cards = allCards(state);

    assert.equal(cards.length, 52, `seed ${seed}: card count`);
    assert.equal(new Set(cards.map((c) => c.id)).size, 52, `seed ${seed}: duplicate cards`);

    for (const suit of SUITS) {
      assert.equal(cards.filter((c) => c.suit === suit).length, 13, `seed ${seed}: ${suit} count`);
    }
    for (let rank = 1; rank <= 13; rank++) {
      assert.equal(cards.filter((c) => c.rank === rank).length, 4, `seed ${seed}: rank ${rank}`);
    }

    TABLEAUS.forEach((id, col) => {
      const pile = state.piles[id];
      assert.equal(pile.length, col + 1, `seed ${seed}: column ${col} length`);
      pile.forEach((c, i) => {
        assert.equal(c.faceUp, i === pile.length - 1, `seed ${seed}: column ${col} card ${i} faceUp`);
      });
    });

    assert.equal(state.piles['stock'].length, 24, `seed ${seed}: stock size`);
    assert.ok(state.piles['stock'].every((c) => !c.faceUp), `seed ${seed}: stock all face down`);
    assert.equal(state.piles['waste'].length, 0);
    for (const f of FOUNDATIONS) assert.equal(state.piles[f].length, 0);
  }
});

test('the same seed always reproduces the same deal', () => {
  for (const seed of [0, 1, 7, 4294967294]) {
    const a = allCards(deal(seed, STANDARD)).map((c) => c.id);
    const b = allCards(deal(seed, STANDARD)).map((c) => c.id);
    assert.deepEqual(a, b);
  }
});

test('shuffle is a permutation and never drops or clones a card', () => {
  for (let seed = 0; seed < 500; seed++) {
    const out = shuffle(makeDeck(), makeRng(seed));
    assert.equal(out.length, 52);
    assert.equal(new Set(out.map((c) => c.id)).size, 52);
  }
});

/* ------------------------------------------------------- stock / waste cycle */

test('recycling restores the stock order, so each pass deals the same sequence', () => {
  const state = deal(42, STANDARD);
  const original = state.piles['stock'].map((c) => c.id);

  const firstPass: string[] = [];
  while (state.piles['stock'].length) {
    drawFromStock(state);
    firstPass.push(topOf(state.piles['waste'])!.id);
  }

  drawFromStock(state); // recycle
  assert.deepEqual(state.piles['stock'].map((c) => c.id), original, 'stock order after recycle');

  const secondPass: string[] = [];
  while (state.piles['stock'].length) {
    drawFromStock(state);
    secondPass.push(topOf(state.piles['waste'])!.id);
  }
  assert.deepEqual(secondPass, firstPass, 'playable sequence is stable across passes');
});

test('playing a card off the waste shifts which cards are playable next pass', () => {
  // This is what makes every stock card reachable in draw-3: a shorter stock
  // re-packets on the next pass, exposing cards the first pass buried.
  const secondPassTops = (removeOne: boolean): string[] => {
    const state = deal(42, STANDARD);
    let removed = false;
    while (state.piles['stock'].length) {
      drawFromStock(state);
      if (removeOne && !removed) {
        state.piles['waste'].pop(); // as if played to a tableau or foundation
        removed = true;
      }
    }
    drawFromStock(state); // recycle

    const tops: string[] = [];
    while (state.piles['stock'].length) {
      drawFromStock(state);
      tops.push(topOf(state.piles['waste'])!.id);
    }
    return tops;
  };
  assert.notDeepEqual(secondPassTops(true), secondPassTops(false), 'draw-3 phase must shift');
});

/* -------------------------------------------------------- autoMove: send home */

test('autoMove never takes a card back off a foundation', () => {
  const state = emptyState();
  state.piles['f0'] = [1, 2, 3, 4, 5].map((r) => card('hearts', r));
  state.piles['t0'] = [card('spades', 6)];

  assert.equal(autoMove(state, 'f0', 4), null);
  assert.equal(state.piles['f0'].length, 5, 'foundation untouched');
});

test('an ace already home does not hop to another empty foundation', () => {
  const state = emptyState();
  const ace = card('spades', 1);
  state.piles['f0'] = [ace];

  assert.equal(findFoundationFor(state, ace), null);
  assert.equal(autoMove(state, 'f0', 0), null);
  assert.equal(state.score, 0, 'no points from a phantom move');
});

test('autoMove only ever moves the top card, never a run', () => {
  const state = emptyState();
  state.piles['t0'] = [card('clubs', 10, false), card('hearts', 9), card('spades', 8), card('diamonds', 7)];
  state.piles['t1'] = [card('clubs', 10)];

  assert.equal(autoMove(state, 't0', 1), null, 'mid-run index must be inert');
  assert.equal(state.piles['t0'].length, 4, 'run stays put');
  assert.equal(state.piles['t1'].length, 1);
});

test('autoMove does not relocate a card inside the tableau', () => {
  const state = emptyState();
  state.piles['t0'] = [card('hearts', 9)];
  state.piles['t1'] = [card('spades', 10)];

  // Legal as a drag (red 9 onto black 10) but not a send-home, so a click does nothing.
  assert.equal(autoMove(state, 't0', 0), null);
  assert.equal(state.piles['t0'].length, 1);
  assert.equal(state.piles['t1'].length, 1);
});

test('autoMove sends a card home when a foundation accepts it', () => {
  const state = emptyState();
  state.piles['f0'] = [card('hearts', 1)];
  state.piles['t0'] = [card('hearts', 2)];

  const result = autoMove(state, 't0', 0);
  assert.ok(result, 'expected the two of hearts to go home');
  assert.equal(result.toFoundation, true);
  assert.deepEqual(state.piles['f0'].map((c) => c.id), ['hearts-1', 'hearts-2']);
  assert.equal(state.piles['t0'].length, 0);
});

test('autoMove ignores face-down cards', () => {
  const state = emptyState();
  state.piles['t0'] = [card('hearts', 1, false)];
  assert.equal(autoMove(state, 't0', 0), null);
});

/* ------------------------------------------------------ auto-finish terminates */

test('auto-finish halts on a stuck board instead of cycling the stock forever', () => {
  const state = emptyState();
  // Every ace is buried under a king, so nothing can go home and no draw will help.
  const buried: Array<[Suit, Suit]> = [
    ['spades', 'hearts'],
    ['hearts', 'spades'],
    ['diamonds', 'clubs'],
    ['clubs', 'diamonds'],
  ];
  buried.forEach(([aceSuit, kingSuit], i) => {
    state.piles[TABLEAUS[i]] = [card(aceSuit, 1), card(kingSuit, 13)];
  });
  const placed = new Set(allCards(state).map((c) => c.id));
  state.piles['stock'] = makeDeck().filter((c) => !placed.has(c.id));
  assert.equal(allCards(state).length, 52, 'test fixture is a full deck');

  assert.equal(canAutoFinish(state), true, 'the Auto button would be offered here');
  assert.equal(nextAutoFinishMove(state), null, 'must not offer an endless draw');

  const { halted, steps } = driveAutoFinish(state);
  assert.ok(halted, 'auto-finish ran away');
  assert.equal(steps, 0);
});

test('auto-finish always halts, across many all-face-up layouts', () => {
  for (let seed = 0; seed < 300; seed++) {
    for (const draw of [1, 3] as const) {
      const rng = makeRng(seed * 2 + draw);
      const deck = shuffle(makeDeck(), rng);
      const state = emptyState({ draw, scoring: 'standard', timed: false });

      const stockSize = Math.floor(rng() * 25);
      state.piles['stock'] = deck.slice(0, stockSize).map((c) => ({ ...c, faceUp: false }));
      deck.slice(stockSize).forEach((c, i) => {
        state.piles[TABLEAUS[i % 7]].push({ ...c, faceUp: true });
      });

      const { halted } = driveAutoFinish(state);
      assert.ok(halted, `auto-finish ran away: seed ${seed}, draw ${draw}`);
      assert.equal(allCards(state).length, 52, `cards lost: seed ${seed}, draw ${draw}`);
    }
  }
});

test('auto-finish still finishes a solved-but-unstacked board', () => {
  const state = emptyState({ draw: 1, scoring: 'standard', timed: false });
  // All 52 face up in the tableau, descending so each rank becomes reachable in turn.
  for (let rank = 13; rank >= 1; rank--) {
    SUITS.forEach((suit, i) => state.piles[TABLEAUS[i]].push(card(suit, rank)));
  }
  const { halted } = driveAutoFinish(state);
  assert.ok(halted);
  assert.equal(state.won, true, 'every card should have gone home');
});
