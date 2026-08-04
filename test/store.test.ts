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

/* ------------------------------------------------ the mode you see is the mode you play */

/** Two tabs over one localStorage: the second tab's game is later overwritten by the first. */
function makeDesync(): InstanceType<typeof Store> {
  const tabA = new Store();
  tabA.setPrefs({ scoring: 'vegas', draw: 1 });
  const tabB = new Store();
  tabB.setPrefs({ scoring: 'standard', draw: 3 });
  tabA.draw(); // re-persists tab A's Vegas game over the save tab B wrote
  return new Store();
}

test('the settings dialog can never advertise a mode the game is not playing', () => {
  const store = makeDesync();
  assert.equal(store.prefs.draw, store.state.options.draw, 'draw count desynced from the live game');
  assert.equal(store.prefs.scoring, store.state.options.scoring, 'scoring desynced from the live game');
});

test('choosing an option always re-deals when the live game disagrees', () => {
  const store = new Store();
  // Force the live game into Vegas draw-one while prefs still say standard draw-three,
  // which is the state a second tab used to leave behind.
  store.state.options = { draw: 1, scoring: 'vegas', timed: true };
  store.prefs = { ...store.prefs, draw: 3, scoring: 'standard' };

  store.setPrefs({ scoring: 'standard' });
  assert.equal(store.state.options.scoring, 'standard', 'clicking Standard must escape Vegas');

  store.state.options = { draw: 1, scoring: 'standard', timed: true };
  store.setPrefs({ draw: 3 });
  assert.equal(store.state.options.draw, 3, 'clicking Draw three must escape draw-one');
});

test('toggling timed play keeps the deal instead of scrapping it', () => {
  const store = new Store();
  store.draw();
  const seed = store.state.seed;
  const moves = store.state.moves;
  const played = store.stats.played;

  store.setPrefs({ timed: !store.prefs.timed });

  assert.equal(store.state.seed, seed, 'the deal must survive a timed-play toggle');
  assert.equal(store.state.moves, moves, 'progress must survive a timed-play toggle');
  assert.equal(store.stats.played, played, 'toggling the clock must not bank a loss');
  assert.equal(store.state.options.timed, store.prefs.timed, 'the setting must apply live');
  assert.ok(store.canUndo(), 'undo history must survive a timed-play toggle');
});

test('a corrupt or incomplete save is discarded rather than played', () => {
  const cases: Array<[string, unknown]> = [
    ['missing options', { state: { piles: { stock: [] } }, elapsedMs: 0, countedPlayed: false }],
    ['bogus draw count', { state: { options: { draw: 7, scoring: 'standard', timed: true }, piles: {} } }],
    ['unknown scoring', { state: { options: { draw: 3, scoring: 'roulette', timed: true }, piles: {} } }],
    ['not 52 cards', { state: { options: { draw: 3, scoring: 'standard', timed: true }, piles: { stock: [{ id: 'hearts-1' }] } } }],
  ];
  for (const [label, file] of cases) {
    clock.reset();
    localStorage.setItem('solitaire.save.v1', JSON.stringify(file));
    const store = new Store();
    const cards = ALL_PILES.flatMap((id) => store.state.piles[id]);
    assert.equal(cards.length, 52, `${label}: should have dealt a fresh game`);
    assert.ok([1, 3].includes(store.state.options.draw), `${label}: draw count`);
    assert.ok(
      ['standard', 'vegas', 'none'].includes(store.state.options.scoring),
      `${label}: scoring mode`,
    );
  }
});

test('nonsense in stored prefs never reaches the engine', () => {
  localStorage.setItem(
    'solitaire.prefs.v1',
    JSON.stringify({ draw: 99, scoring: 'roulette', timed: 'yes' }),
  );
  const store = new Store();
  assert.ok([1, 3].includes(store.prefs.draw));
  assert.ok(['standard', 'vegas', 'none'].includes(store.prefs.scoring));
  assert.equal(typeof store.prefs.timed, 'boolean');
  assert.ok([1, 3].includes(store.state.options.draw));
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
