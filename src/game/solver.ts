import { type Card, colorOf } from './deck';
import {
  FOUNDATIONS,
  type GameState,
  type Options,
  type PileId,
  TABLEAUS,
  canDrop,
  cloneState,
  deal,
  drawFromStock,
  moveCards,
  topOf,
} from './rules';

/**
 * Deal filtering. A truly random Klondike shuffle is merciless — only about 70% of
 * draw-three deals are winnable at all, and most of those need near-perfect play.
 * Microsoft's Solitaire hands you friendlier deals, which is what most people mean
 * when they say a game "plays like Windows".
 *
 * Rather than prove winnability exhaustively (slow, and a deal only a solver can win
 * is no fun), we play the deal out with a quick heuristic player a number of times.
 * If that player can win it, a person can. Everything runs through the real rules, so
 * this can never disagree with the game about what is legal.
 */

interface Candidate {
  from: PileId;
  index: number;
  to: PileId;
  score: number;
}

function foundationRank(state: GameState, suit: string): number {
  for (const id of FOUNDATIONS) {
    const top = topOf(state.piles[id]);
    if (top && top.suit === suit) return top.rank;
  }
  return 0;
}

/** A card is safe to send home when no tableau card still needs it as a target. */
function safeToSendHome(state: GameState, card: Card): boolean {
  if (card.rank <= 2) return true;
  const opposites = colorOf(card.suit) === 'red' ? ['spades', 'clubs'] : ['hearts', 'diamonds'];
  return Math.min(...opposites.map((s) => foundationRank(state, s))) >= card.rank - 1;
}

function candidates(state: GameState): Candidate[] {
  const out: Candidate[] = [];

  for (const from of [...TABLEAUS, 'waste'] as PileId[]) {
    const pile = state.piles[from];
    const card = topOf(pile);
    if (!card || !card.faceUp) continue;
    for (const to of FOUNDATIONS) {
      if (!canDrop(state, from, pile.length - 1, to)) continue;
      out.push({
        from,
        index: pile.length - 1,
        to,
        score: safeToSendHome(state, card) ? 1000 - card.rank : 100 - card.rank,
      });
      break;
    }
  }

  for (const from of TABLEAUS) {
    const pile = state.piles[from];
    for (let i = 0; i < pile.length; i++) {
      if (!pile[i].faceUp) continue;
      const head = pile[i];
      const uncovers = i > 0 && !pile[i - 1].faceUp;
      const emptiesColumn = i === 0;
      for (const to of TABLEAUS) {
        if (to === from || !canDrop(state, from, i, to)) continue;
        // Shuffling a lone king between bare columns achieves nothing.
        if (emptiesColumn && state.piles[to].length === 0) continue;
        let score = 10;
        if (uncovers) score = 500 + head.rank;
        else if (emptiesColumn) score = 200;
        out.push({ from, index: i, to, score });
      }
      break;
    }
  }

  const waste = state.piles['waste'];
  if (waste.length) {
    for (const to of TABLEAUS) {
      if (canDrop(state, 'waste', waste.length - 1, to)) {
        out.push({ from: 'waste', index: waste.length - 1, to, score: 300 });
      }
    }
  }

  return out;
}

/**
 * Plays one game with a greedy heuristic, breaking ties at random so repeated
 * playouts explore different lines. Returns true if it won.
 */
function playout(start: GameState, rng: () => number): boolean {
  const state = cloneState(start);
  const tried = new Set<string>();
  let barren = 0;

  for (let step = 0; step < 3000; step++) {
    if (state.won) return true;

    const moves = candidates(state);
    for (const m of moves) m.score += rng() * 40;
    moves.sort((a, b) => b.score - a.score);

    // Skip pure shuffles we have already made, so the player cannot loop A->B->A.
    const move = moves.find((m) => {
      if (m.score >= 200) return true;
      const key = `${state.piles[m.from][m.index].id}>${m.to}`;
      if (tried.has(key)) return false;
      tried.add(key);
      return true;
    });

    if (move) {
      if (!moveCards(state, move.from, move.index, move.to)) return false;
      barren = 0;
      continue;
    }

    if (state.piles['stock'].length === 0 && state.piles['waste'].length === 0) return false;
    if (++barren > 60) return false;
    if (!drawFromStock(state)) return false;
  }
  return state.won;
}

/** True when the heuristic player can win this deal within `playouts` attempts. */
export function looksWinnable(state: GameState, rng: () => number, playouts: number): boolean {
  for (let i = 0; i < playouts; i++) {
    if (playout(state, rng)) return true;
  }
  return false;
}

export interface WinnableSearch {
  /** The chosen seed — a friendly one if we found it, otherwise the first tried. */
  seed: number;
  /** False when the time budget ran out and we fell back to an unfiltered deal. */
  filtered: boolean;
  tried: number;
}

/**
 * Looks for a deal the heuristic player can win, within a wall-clock budget.
 * Always returns a usable seed: a hunt that times out falls back to the first
 * candidate rather than leaving the player waiting.
 */
export function findWinnableSeed(
  options: Options,
  nextSeed: () => number,
  now: () => number,
  budgetMs = 1500,
  playouts = 12,
  maxTries = 40,
): WinnableSearch {
  const started = now();
  const rng = makeSearchRng(nextSeed());
  let first: number | null = null;
  let tried = 0;

  // Bounded by tries as well as time: a clock that does not advance (tests, or a
  // browser throttling a background tab) must not spin here.
  while (tried < maxTries && now() - started < budgetMs) {
    const seed = nextSeed();
    if (first === null) first = seed;
    tried++;
    if (looksWinnable(deal(seed, options), rng, playouts)) {
      return { seed, filtered: true, tried };
    }
  }

  return { seed: first ?? nextSeed(), filtered: false, tried };
}

/** Local PRNG for playout tie-breaking; deliberately not the deal's shuffle stream. */
function makeSearchRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = Math.imul(a ^ (a >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return ((t ^= t >>> 15) >>> 0) / 4294967296;
  };
}
