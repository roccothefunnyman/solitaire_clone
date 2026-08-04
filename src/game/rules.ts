import { type Card, colorOf, makeDeck, makeRng, shuffle } from './deck';

export type PileId = string;
export type PileKind = 'stock' | 'waste' | 'foundation' | 'tableau';

export type DrawCount = 1 | 3;
export type ScoringMode = 'standard' | 'vegas' | 'none';

export interface Options {
  draw: DrawCount;
  scoring: ScoringMode;
  timed: boolean;
}

export interface GameState {
  piles: Record<PileId, Card[]>;
  options: Options;
  seed: number;
  /** Base score, before any timed-play penalty (which is derived, not stored). */
  score: number;
  moves: number;
  /** Completed passes through the stock. */
  passes: number;
  won: boolean;
}

export interface MoveResult {
  type: 'draw' | 'recycle' | 'move';
  from: PileId;
  to: PileId;
  cardIds: string[];
  /** Card that got turned face up as a consequence of the move. */
  flippedId: string | null;
  points: number;
  toFoundation: boolean;
}

export const FOUNDATIONS: PileId[] = ['f0', 'f1', 'f2', 'f3'];
export const TABLEAUS: PileId[] = ['t0', 't1', 't2', 't3', 't4', 't5', 't6'];
export const ALL_PILES: PileId[] = ['stock', 'waste', ...FOUNDATIONS, ...TABLEAUS];

export function pileKind(id: PileId): PileKind {
  if (id === 'stock') return 'stock';
  if (id === 'waste') return 'waste';
  return id[0] === 'f' ? 'foundation' : 'tableau';
}

export function topOf(pile: Card[]): Card | null {
  return pile.length ? pile[pile.length - 1] : null;
}

/* ------------------------------------------------------------------ dealing */

export function deal(seed: number, options: Options): GameState {
  const rng = makeRng(seed);
  const deck = shuffle(makeDeck(), rng);

  const piles: Record<PileId, Card[]> = {};
  for (const id of ALL_PILES) piles[id] = [];

  let i = 0;
  for (let col = 0; col < 7; col++) {
    for (let row = 0; row <= col; row++) {
      const card = deck[i++];
      card.faceUp = row === col;
      piles[TABLEAUS[col]].push(card);
    }
  }
  while (i < deck.length) {
    const card = deck[i++];
    card.faceUp = false;
    piles['stock'].push(card);
  }

  return {
    piles,
    options,
    seed,
    score: options.scoring === 'vegas' ? -52 : 0,
    moves: 0,
    passes: 0,
    won: false,
  };
}

export function cloneState(state: GameState): GameState {
  const piles: Record<PileId, Card[]> = {};
  for (const id of ALL_PILES) piles[id] = state.piles[id].map((c) => ({ ...c }));
  return { ...state, options: { ...state.options }, piles };
}

/* ------------------------------------------------------------------ legality */

export function canPlaceOnFoundation(card: Card, foundation: Card[]): boolean {
  const top = topOf(foundation);
  if (!top) return card.rank === 1;
  return top.suit === card.suit && card.rank === top.rank + 1;
}

export function canPlaceOnTableau(card: Card, tableau: Card[]): boolean {
  const top = topOf(tableau);
  if (!top) return card.rank === 13;
  if (!top.faceUp) return false;
  return colorOf(top.suit) !== colorOf(card.suit) && card.rank === top.rank - 1;
}

/** A run is movable when every card is face up and descends in alternating colours. */
export function isMovableRun(pile: Card[], fromIndex: number): boolean {
  if (fromIndex < 0 || fromIndex >= pile.length) return false;
  for (let i = fromIndex; i < pile.length; i++) {
    if (!pile[i].faceUp) return false;
    if (i > fromIndex) {
      const prev = pile[i - 1];
      const cur = pile[i];
      if (cur.rank !== prev.rank - 1 || colorOf(cur.suit) === colorOf(prev.suit)) return false;
    }
  }
  return true;
}

export function canGrab(state: GameState, from: PileId, index: number): boolean {
  const pile = state.piles[from];
  const kind = pileKind(from);
  if (kind === 'stock') return false;
  if (kind === 'waste' || kind === 'foundation') return index === pile.length - 1 && pile.length > 0;
  return isMovableRun(pile, index);
}

export function canDrop(state: GameState, from: PileId, index: number, to: PileId): boolean {
  if (from === to) return false;
  if (!canGrab(state, from, index)) return false;
  const moving = state.piles[from].slice(index);
  const kind = pileKind(to);
  if (kind === 'foundation') {
    return moving.length === 1 && canPlaceOnFoundation(moving[0], state.piles[to]);
  }
  if (kind === 'tableau') return canPlaceOnTableau(moving[0], state.piles[to]);
  return false;
}

/**
 * How many times the waste may be turned back into the stock.
 * Vegas keeps the classic limits (one pass on draw-one, three on draw-three);
 * every other mode is unlimited, matching the Windows default.
 */
export function maxRecycles(options: Options): number {
  if (options.scoring !== 'vegas') return Infinity;
  return options.draw === 1 ? 0 : 2;
}

export function canRecycle(state: GameState): boolean {
  return state.piles['waste'].length > 0 && state.passes < maxRecycles(state.options);
}

/* ------------------------------------------------------------------- scoring */

function award(state: GameState, points: number): number {
  if (state.options.scoring === 'none') return 0;
  const before = state.score;
  let next = before + points;
  if (state.options.scoring === 'standard' && next < 0) next = 0;
  state.score = next;
  return next - before;
}

function scoreForMove(state: GameState, from: PileId, to: PileId): number {
  const mode = state.options.scoring;
  const fromKind = pileKind(from);
  const toKind = pileKind(to);
  if (mode === 'vegas') {
    if (toKind === 'foundation') return 5;
    if (fromKind === 'foundation') return -5;
    return 0;
  }
  if (mode === 'standard') {
    if (toKind === 'foundation') return 10;
    if (fromKind === 'waste' && toKind === 'tableau') return 5;
    if (fromKind === 'foundation' && toKind === 'tableau') return -15;
    return 0;
  }
  return 0;
}

function recyclePenalty(state: GameState): number {
  if (state.options.scoring !== 'standard') return 0;
  // Windows rule: no penalty for the first three passes through the deck.
  if (state.passes < 3) return 0;
  return state.options.draw === 1 ? -100 : -20;
}

/* --------------------------------------------------------------------- moves */

export function drawFromStock(state: GameState): MoveResult | null {
  const stock = state.piles['stock'];
  const waste = state.piles['waste'];

  if (stock.length === 0) {
    if (waste.length === 0) return null;
    if (state.passes >= maxRecycles(state.options)) return null;
    const ids: string[] = [];
    while (waste.length) {
      const card = waste.pop()!;
      card.faceUp = false;
      stock.push(card);
      ids.push(card.id);
    }
    state.passes += 1;
    state.moves += 1;
    const points = award(state, recyclePenalty(state));
    return {
      type: 'recycle',
      from: 'waste',
      to: 'stock',
      cardIds: ids,
      flippedId: null,
      points,
      toFoundation: false,
    };
  }

  const count = Math.min(state.options.draw, stock.length);
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const card = stock.pop()!;
    card.faceUp = true;
    waste.push(card);
    ids.push(card.id);
  }
  state.moves += 1;
  return {
    type: 'draw',
    from: 'stock',
    to: 'waste',
    cardIds: ids,
    flippedId: null,
    points: 0,
    toFoundation: false,
  };
}

export function moveCards(
  state: GameState,
  from: PileId,
  index: number,
  to: PileId,
): MoveResult | null {
  if (!canDrop(state, from, index, to)) return null;

  const source = state.piles[from];
  const moving = source.splice(index);
  state.piles[to].push(...moving);

  let points = scoreForMove(state, from, to);
  points = award(state, points);

  let flippedId: string | null = null;
  if (pileKind(from) === 'tableau') {
    const newTop = topOf(source);
    if (newTop && !newTop.faceUp) {
      newTop.faceUp = true;
      flippedId = newTop.id;
      if (state.options.scoring === 'standard') points += award(state, 5);
    }
  }

  state.moves += 1;
  state.won = checkWon(state);

  return {
    type: 'move',
    from,
    to,
    cardIds: moving.map((c) => c.id),
    flippedId,
    points,
    toFoundation: pileKind(to) === 'foundation',
  };
}

/** Best foundation for a card, or null when it cannot be placed. */
export function findFoundationFor(state: GameState, card: Card): PileId | null {
  // A card already home is not looking for a foundation. Without this an ace sitting
  // on one foundation would "move" to any other empty one, scoring on every hop.
  for (const id of FOUNDATIONS) {
    if (topOf(state.piles[id])?.id === card.id) return null;
  }
  for (const id of FOUNDATIONS) {
    if (canPlaceOnFoundation(card, state.piles[id])) return id;
  }
  return null;
}

/** First tableau that accepts the card — prefers non-empty piles. */
export function findTableauFor(state: GameState, from: PileId, index: number): PileId | null {
  const card = state.piles[from][index];
  if (!card) return null;
  const occupied = TABLEAUS.filter((id) => id !== from && state.piles[id].length > 0);
  const empty = TABLEAUS.filter((id) => id !== from && state.piles[id].length === 0);
  for (const id of [...occupied, ...empty]) {
    if (canDrop(state, from, index, id)) return id;
  }
  return null;
}

/**
 * Double-click / right-click behaviour: send the card home, or do nothing.
 *
 * Strictly foundation-only, like Windows. It never relocates a card within the
 * tableau and never takes a card back off a foundation — those are drag-only, so
 * a stray or repeated click can't dismantle a position.
 */
export function autoMove(state: GameState, from: PileId, index: number): MoveResult | null {
  if (pileKind(from) === 'foundation') return null;
  const pile = state.piles[from];
  if (index !== pile.length - 1) return null;
  const card = pile[index];
  if (!card || !card.faceUp) return null;
  const foundation = findFoundationFor(state, card);
  if (!foundation || !canDrop(state, from, index, foundation)) return null;
  return moveCards(state, from, index, foundation);
}

export function checkWon(state: GameState): boolean {
  return FOUNDATIONS.every((id) => state.piles[id].length === 13);
}

/* ---------------------------------------------------------------- assistance */

export interface Hint {
  from: PileId;
  index: number;
  to: PileId;
  cardId: string;
  weight: number;
}

/** Ranked list of useful moves — powers the hint button. */
export function findHints(state: GameState): Hint[] {
  const hints: Hint[] = [];
  const push = (from: PileId, index: number, to: PileId, weight: number) => {
    const card = state.piles[from][index];
    if (card) hints.push({ from, index, to, cardId: card.id, weight });
  };

  for (const from of [...TABLEAUS, 'waste']) {
    const pile = state.piles[from];
    if (!pile.length) continue;
    const top = pile[pile.length - 1];
    const foundation = findFoundationFor(state, top);
    if (foundation && canDrop(state, from, pile.length - 1, foundation)) {
      push(from, pile.length - 1, foundation, top.rank <= 2 ? 100 : 70);
    }
  }

  for (const from of TABLEAUS) {
    const pile = state.piles[from];
    for (let i = 0; i < pile.length; i++) {
      if (!pile[i].faceUp || !isMovableRun(pile, i)) continue;
      const hasHidden = i > 0 && !pile[i - 1].faceUp;
      for (const to of TABLEAUS) {
        if (to === from) continue;
        if (!canDrop(state, from, i, to)) continue;
        // Only worth flagging when it uncovers something or unloads a king.
        if (i === 0 && state.piles[to].length === 0) continue;
        push(from, i, to, hasHidden ? 60 : 25);
      }
      break; // the lowest movable index is the interesting one
    }
  }

  const waste = state.piles['waste'];
  if (waste.length) {
    const to = findTableauFor(state, 'waste', waste.length - 1);
    if (to) push('waste', waste.length - 1, to, 40);
  }

  if (state.piles['stock'].length > 0) {
    hints.push({ from: 'stock', index: -1, to: 'waste', cardId: '', weight: 10 });
  } else if (waste.length > 1 && state.passes < maxRecycles(state.options)) {
    hints.push({ from: 'stock', index: -1, to: 'waste', cardId: '', weight: 5 });
  }

  return hints.sort((a, b) => b.weight - a.weight);
}

/**
 * Auto-finish is offered only when it can actually finish. Nothing hidden in the
 * tableau is necessary but not sufficient: the finisher only plays pile tops and draws,
 * so in draw-three it could otherwise stall half way and leave the board worse.
 */
export function canAutoFinish(state: GameState): boolean {
  if (state.won) return false;
  for (const id of TABLEAUS) {
    if (state.piles[id].some((c) => !c.faceUp)) return false;
  }
  const remaining = FOUNDATIONS.reduce((n, id) => n + state.piles[id].length, 0);
  if (remaining >= 52) return false;

  const probe = cloneState(state);
  for (let step = 0; step < 400; step++) {
    const next = nextAutoFinishMove(probe);
    if (!next) return false;
    const ok =
      next.from === 'stock'
        ? drawFromStock(probe) !== null
        : moveCards(probe, next.from, next.index, next.to) !== null;
    if (!ok) return false;
    if (probe.won) return true;
  }
  return false;
}

/** Next single step of the auto-finish sequence, or null when stuck/complete. */
export function nextAutoFinishMove(state: GameState): { from: PileId; index: number; to: PileId } | null {
  const sources: PileId[] = [...TABLEAUS, 'waste'];
  let best: { from: PileId; index: number; to: PileId; rank: number } | null = null;
  for (const from of sources) {
    const pile = state.piles[from];
    if (!pile.length) continue;
    const index = pile.length - 1;
    const card = pile[index];
    if (!card.faceUp) continue;
    const to = findFoundationFor(state, card);
    if (to && (!best || card.rank < best.rank)) best = { from, index, to, rank: card.rank };
  }
  if (best) return { from: best.from, index: best.index, to: best.to };

  // Only draw when drawing can actually reach a foundation-playable card. Nothing
  // but the stock and waste changes while we draw, so a repeated stock+waste
  // configuration proves the cycle is closed and there is nothing left to find.
  // Without this the unlimited redeals of standard scoring spin forever.
  const probe = cloneState(state);
  const seen = new Set<string>();
  for (;;) {
    const key = `${probe.piles['stock'].map((c) => c.id).join(',')}|${probe.piles['waste']
      .map((c) => c.id)
      .join(',')}`;
    if (seen.has(key)) return null;
    seen.add(key);
    if (!drawFromStock(probe)) return null;
    const top = topOf(probe.piles['waste']);
    if (top && findFoundationFor(probe, top)) return { from: 'stock', index: -1, to: 'waste' };
  }
}
