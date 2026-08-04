import assert from 'node:assert/strict';
import { test } from 'node:test';

import { makeRng } from '../src/game/deck';
import { type Options, deal } from '../src/game/rules';
import { findWinnableSeed, looksWinnable } from '../src/game/solver';

/** Deterministic seed source so these tests do not flake. */
function seedSource(start: number): () => number {
  let a = start >>> 0;
  return () => {
    a = (a * 1103515245 + 12345) >>> 0;
    return a;
  };
}

for (const draw of [1, 3] as const) {
  const options: Options = { draw, scoring: 'standard', timed: false };

  test(`draw-${draw}: filtered deals are far more winnable than random ones`, () => {
    const nextSeed = seedSource(20260804 + draw);
    const chosen: number[] = [];
    let filtered = 0;
    for (let i = 0; i < 25; i++) {
      const r = findWinnableSeed(options, nextSeed, () => Date.now());
      if (r.filtered) filtered++;
      chosen.push(r.seed);
    }
    assert.ok(filtered >= 23, `expected the search to succeed nearly always, got ${filtered}/25`);

    // Re-check with an independent RNG and more attempts, so we are not just
    // reading back the same playout that selected the deal.
    const rng = makeRng(4242);
    const winnable = chosen.filter((s) => looksWinnable(deal(s, options), rng, 25)).length;

    const control = seedSource(99999 + draw);
    let baseline = 0;
    for (let i = 0; i < 25; i++) {
      if (looksWinnable(deal(control(), options), rng, 25)) baseline++;
    }

    assert.ok(winnable >= 22, `filtered deals should be winnable, got ${winnable}/25`);
    assert.ok(
      winnable > baseline,
      `filtering achieved nothing: ${winnable}/25 filtered vs ${baseline}/25 random`,
    );
  });
}

test('the search always returns a usable seed, even with a frozen clock', () => {
  // A clock that never advances must not spin: the try cap has to end the hunt.
  const nextSeed = seedSource(7);
  const result = findWinnableSeed(
    { draw: 3, scoring: 'standard', timed: false },
    nextSeed,
    () => 0,
  );
  assert.equal(typeof result.seed, 'number');
  assert.ok(result.tried > 0 && result.tried <= 40, `tries must stay bounded, got ${result.tried}`);
  const state = deal(result.seed, { draw: 3, scoring: 'standard', timed: false });
  assert.equal(
    Object.values(state.piles).flat().length,
    52,
    'the chosen seed must still deal a full deck',
  );
});

test('an exhausted time budget still yields a deal rather than hanging', () => {
  const nextSeed = seedSource(11);
  let calls = 0;
  const result = findWinnableSeed(
    { draw: 3, scoring: 'standard', timed: false },
    nextSeed,
    () => calls++ * 10_000, // blows the budget immediately
  );
  assert.equal(typeof result.seed, 'number');
  assert.equal(result.filtered, false);
});
