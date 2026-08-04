import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DOUBLE_CLICK_MS, NO_TAP, type TapMemory, tapDecision } from '../src/ui/board';

/** Replays a click sequence and counts how many send-home actions it triggered. */
function replay(clicks: Array<{ cardId: string; at: number; touch?: boolean }>): {
  autos: string[];
} {
  let memory: TapMemory = NO_TAP;
  const autos: string[] = [];
  for (const click of clicks) {
    const { auto, next } = tapDecision(memory, click.cardId, click.at, click.touch ?? false);
    memory = next;
    if (auto) autos.push(click.cardId);
  }
  return { autos };
}

test('a double-click on one card sends it home exactly once', () => {
  const { autos } = replay([
    { cardId: 'hearts-2', at: 1000 },
    { cardId: 'hearts-2', at: 1120 },
  ]);
  assert.deepEqual(autos, ['hearts-2']);
});

test('a double-click fires once at every realistic click speed', () => {
  // Windows' default DoubleClickSpeed is 500ms; an unhurried but perfectly ordinary
  // double-click lands well past 400ms and must still send the card home.
  for (const gap of [40, 60, 120, 200, 300, 399, 420, 450, 490]) {
    const { autos } = replay([
      { cardId: 'spades-5', at: 500 },
      { cardId: 'spades-5', at: 500 + gap },
    ]);
    assert.deepEqual(autos, ['spades-5'], `gap ${gap}ms`);
  }
});

test('two single clicks on different cards never send anything home', () => {
  for (const gap of [10, 50, 150, 250, 300, 399]) {
    const { autos } = replay([
      { cardId: 'clubs-13', at: 800 },
      { cardId: 'spades-7', at: 800 + gap },
    ]);
    assert.deepEqual(autos, [], `gap ${gap}ms — a click on one card must not arm another`);
  }
});

test('a slow second click on the same card is not a double-click', () => {
  const { autos } = replay([
    { cardId: 'hearts-2', at: 0 },
    { cardId: 'hearts-2', at: DOUBLE_CLICK_MS },
  ]);
  assert.deepEqual(autos, []);
});

test('a third rapid click starts a fresh pair rather than firing again', () => {
  const { autos } = replay([
    { cardId: 'hearts-2', at: 0 },
    { cardId: 'hearts-2', at: 100 },
    { cardId: 'hearts-2', at: 200 },
  ]);
  assert.deepEqual(autos, ['hearts-2'], 'three clicks are one double-click, not two');
});

test('four rapid clicks are exactly two double-clicks', () => {
  const { autos } = replay([
    { cardId: 'hearts-2', at: 0 },
    { cardId: 'hearts-2', at: 100 },
    { cardId: 'hearts-2', at: 200 },
    { cardId: 'hearts-2', at: 300 },
  ]);
  assert.deepEqual(autos, ['hearts-2', 'hearts-2']);
});

test('a double-click followed by a click on another card does not move that card', () => {
  // The old board-wide timestamp left a live window here, so the next click on any
  // card fired an unrequested move.
  for (const gap of [221, 300, 399, 401]) {
    const { autos } = replay([
      { cardId: 'hearts-2', at: 0 },
      { cardId: 'hearts-2', at: 120 },
      { cardId: 'diamonds-9', at: 120 + gap },
    ]);
    assert.deepEqual(autos, ['hearts-2'], `follow-up gap ${gap}ms`);
  }
});

test('a steady click rhythm connects instead of never registering', () => {
  // The tap memory re-arms on every miss, so if the window is shorter than the
  // player's natural rhythm, a metronomic double-click never fires at all.
  const clicks = [0, 450, 900, 1350].map((at) => ({ cardId: 'hearts-2', at }));
  assert.ok(replay(clicks).autos.length > 0, 'a 450ms rhythm never registered a double-click');
});

test('a single tap sends home on touch, where there is no double-tap convention', () => {
  const { autos } = replay([{ cardId: 'hearts-2', at: 0, touch: true }]);
  assert.deepEqual(autos, ['hearts-2']);
});
