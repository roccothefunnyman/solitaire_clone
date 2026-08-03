import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { installBrowserStubs } from './browser-stub.mjs';

const clock = installBrowserStubs();

// Imported after the stubs exist so the module is loaded against them.
const { Store } = await import('../src/game/store');
const { ALL_PILES, FOUNDATIONS } = await import('../src/game/rules');
type StoreType = InstanceType<typeof Store>;

const SUIT_OF = ['spades', 'hearts', 'diamonds', 'clubs'] as const;

/** Rebuilds the board with 51 cards home and the king of spades one move away. */
function nearlyWon(store: StoreType): void {
  const piles = store.state.piles;
  for (const id of ALL_PILES) piles[id] = [];
  FOUNDATIONS.forEach((f, i) => {
    const suit = SUIT_OF[i];
    const top = f === 'f0' ? 12 : 13;
    for (let rank = 1; rank <= top; rank++) {
      piles[f].push({ id: `${suit}-${rank}`, suit, rank, faceUp: true });
    }
  });
  piles['t0'] = [{ id: 'spades-13', suit: 'spades', rank: 13, faceUp: true }];
  store.state.won = false;
}

function winIt(store: StoreType): void {
  nearlyWon(store);
  assert.equal(store.move('t0', 0, 'f0'), true, 'the king should have gone home');
  assert.equal(store.state.won, true);
}

beforeEach(() => clock.reset());

test('winning records exactly one win', () => {
  const store = new Store();
  winIt(store);
  assert.equal(store.stats.won, 1);
  assert.equal(store.stats.played, 1);
  assert.equal(store.stats.streak, 1);
});

test('undoing the winning move and replaying it does not bank the win twice', () => {
  const store = new Store();
  winIt(store);

  for (let i = 0; i < 3; i++) {
    store.undo();
    assert.equal(store.state.won, false, 'undo should return to a live game');
    assert.equal(store.move('t0', 0, 'f0'), true);
  }

  assert.equal(store.stats.won, 1, 'win counted more than once');
  assert.equal(store.stats.played, 1);
  assert.ok(store.stats.won <= store.stats.played, 'win rate must not exceed 100%');
});

test('replaying a won deal counts as a new game, not a free extra win', () => {
  const store = new Store();
  winIt(store);
  store.restartDeal();
  winIt(store);

  assert.equal(store.stats.won, 2);
  assert.equal(store.stats.played, 2, 'the replayed deal must count as played');
  assert.ok(store.stats.won <= store.stats.played);
});

test('undoing a win restarts the clock', () => {
  const store = new Store();
  clock.advance(4000);
  winIt(store);

  const atWin = store.elapsed();
  clock.advance(5000);
  assert.equal(store.elapsed(), atWin, 'the clock should stop once the game is won');

  store.undo();
  const resumed = store.elapsed();
  clock.advance(5000);
  assert.ok(
    store.elapsed() >= resumed + 5000,
    'the clock must run again after undoing back into a live game',
  );
});

test('resetting statistics actually clears them on a fresh profile', () => {
  const store = new Store();
  winIt(store);
  assert.equal(store.stats.won, 1);

  store.resetStats();
  assert.equal(store.stats.played, 0);
  assert.equal(store.stats.won, 0);
  assert.equal(store.stats.streak, 0);
  assert.equal(store.stats.bestStreak, 0);
  assert.equal(store.stats.bestTimeMs, null);
  assert.equal(store.stats.bestScore, null);

  const saved = JSON.parse(clock.raw('solitaire.stats.v1') ?? '{}');
  assert.equal(saved.won, 0, 'cleared stats must be persisted, not just held in memory');
});

test('a fresh profile starts at zero after another game recorded a win', () => {
  const first = new Store();
  winIt(first);
  assert.equal(first.stats.won, 1);

  clock.reset();
  const second = new Store();
  assert.equal(second.stats.won, 0, 'the defaults were mutated in place');
  assert.equal(second.stats.played, 0);
  assert.equal(second.stats.bestStreak, 0);
});

test('undo restores the full board, including face-down cards and pass count', () => {
  const store = new Store();
  const before = JSON.stringify(store.state);

  store.draw();
  store.draw();
  assert.notEqual(JSON.stringify(store.state), before);

  store.undo();
  store.undo();
  assert.equal(JSON.stringify(store.state), before, 'undo must restore state exactly');
});
