import { type Card, RANK_LABEL, type Suit, colorOf } from '../game/deck';

/** Suit silhouettes drawn in a 100x100 box, centred on (50,50). */
const SUIT_PATHS: Record<Suit, string> = {
  spades:
    'M50 6 C50 6 10 36 10 58 C10 72 20 81 33 81 C41 81 47 77 50 71 C49 82 44 90 35 95 L65 95 C56 90 51 82 50 71 C53 77 59 81 67 81 C80 81 90 72 90 58 C90 36 50 6 50 6 Z',
  hearts:
    'M50 92 C18 68 6 52 6 33 C6 17 18 8 30 8 C39 8 46 13 50 21 C54 13 61 8 70 8 C82 8 94 17 94 33 C94 52 82 68 50 92 Z',
  diamonds: 'M50 4 C61 26 73 41 90 50 C73 59 61 74 50 96 C39 74 27 59 10 50 C27 41 39 26 50 4 Z',
  clubs:
    'M50 5 C38 5 29 14 29 26 C29 31 30 35 33 39 C29 36 24 34 19 34 C8 34 -1 43 -1 55 C-1 66 8 75 19 75 C28 75 36 70 40 62 C40 62 39 78 30 95 L70 95 C61 78 60 62 60 62 C64 70 72 75 81 75 C92 75 101 66 101 55 C101 43 92 34 81 34 C76 34 71 36 67 39 C70 35 71 31 71 26 C71 14 62 5 50 5 Z',
};

/**
 * Classic pip grid in the card's 100x140 face space.
 * Columns sit at 33 / 50 / 67 so they clear the corner indices; rows follow the
 * traditional four-band layout with a centre band for odd ranks.
 */
const PIP_LAYOUTS: Record<number, Array<[number, number]>> = {
  1: [[50, 70]],
  2: [
    [50, 24],
    [50, 116],
  ],
  3: [
    [50, 24],
    [50, 70],
    [50, 116],
  ],
  4: [
    [33, 24],
    [67, 24],
    [33, 116],
    [67, 116],
  ],
  5: [
    [33, 24],
    [67, 24],
    [50, 70],
    [33, 116],
    [67, 116],
  ],
  6: [
    [33, 24],
    [67, 24],
    [33, 70],
    [67, 70],
    [33, 116],
    [67, 116],
  ],
  7: [
    [33, 24],
    [67, 24],
    [50, 47],
    [33, 70],
    [67, 70],
    [33, 116],
    [67, 116],
  ],
  8: [
    [33, 24],
    [67, 24],
    [50, 47],
    [33, 70],
    [67, 70],
    [50, 93],
    [33, 116],
    [67, 116],
  ],
  9: [
    [33, 24],
    [67, 24],
    [33, 54.7],
    [67, 54.7],
    [50, 70],
    [33, 85.3],
    [67, 85.3],
    [33, 116],
    [67, 116],
  ],
  10: [
    [33, 24],
    [67, 24],
    [50, 39.3],
    [33, 54.7],
    [67, 54.7],
    [33, 85.3],
    [67, 85.3],
    [50, 100.7],
    [33, 116],
    [67, 116],
  ],
};

function pip(suit: Suit, x: number, y: number, size: number, flip: boolean): string {
  const s = size / 100;
  const rot = flip ? ' rotate(180)' : '';
  return `<g transform="translate(${x} ${y})${rot} scale(${s.toFixed(3)}) translate(-50 -50)"><path class="pip" d="${SUIT_PATHS[suit]}"/></g>`;
}

/**
 * Court headdresses as fine gold line art, drawn centred on the local origin.
 * Line work reads far better than filled silhouettes at playing-card sizes.
 */
const CROWNS: Record<number, string> = {
  11: `<path class="crown" d="M-10.5 7 L-8 -2.5 C-6.5 -8.5 6.5 -8.5 8 -2.5 L10.5 7 Z"/>
       <path class="crown thin" d="M7.5 -4 C13 -12.5 19 -12.5 21 -6.5"/>
       <circle class="crown-dot" cx="21.4" cy="-5.6" r="1.5"/>
       <path class="crown-fill" d="M-11.4 7 h22.8" />`,
  12: `<path class="crown" d="M-12 7 L-12.5 -6 C-12.5 -6 -8 0 -4.6 0 C-1.2 0 -2 -9 0 -9 C2 -9 1.2 0 4.6 0 C8 0 12.5 -6 12.5 -6 L12 7 Z"/>
       <circle class="crown-dot" cx="0" cy="-11" r="1.9"/>
       <circle class="crown-dot" cx="-12.5" cy="-8" r="1.5"/>
       <circle class="crown-dot" cx="12.5" cy="-8" r="1.5"/>`,
  13: `<path class="crown" d="M-12 7 L-12.5 -6 L-6.5 0 L0 -9.5 L6.5 0 L12.5 -6 L12 7 Z"/>
       <path class="crown" d="M0 -12.5 v-4 M-2 -14.5 h4"/>`,
};

function courtOrnament(card: Card): string {
  const crown = CROWNS[card.rank] ?? '';
  const label = RANK_LABEL[card.rank];
  return `
    <g class="court-orn">
      <g transform="translate(33 27)">${crown}</g>
      <text class="court-letter" x="33" y="53" font-size="27" text-anchor="middle" dominant-baseline="central">${label}</text>
      <g transform="translate(33 74) scale(0.16) translate(-50 -50)"><path class="pip" d="${SUIT_PATHS[card.suit]}"/></g>
    </g>`;
}

function faceSvg(card: Card): string {
  const isCourt = card.rank >= 11;
  if (isCourt) {
    const orn = courtOrnament(card);
    return `<svg class="card__art" viewBox="0 0 100 140" aria-hidden="true">
      <rect class="court-panel" x="11" y="11" width="78" height="118" rx="7"/>
      <path class="court-tint" d="M11 18 A7 7 0 0 1 18 11 L82 11 L11 122 Z"/>
      <rect class="court-panel-inner" x="14.5" y="14.5" width="71" height="111" rx="5"/>
      <line class="court-split" x1="12" y1="126" x2="88" y2="12"/>
      ${orn}
      <g transform="rotate(180 50 70)">${orn}</g>
    </svg>`;
  }

  const layout = PIP_LAYOUTS[card.rank] ?? [];
  const size = card.rank === 1 ? 46 : 19;
  const body = layout.map(([x, y]) => pip(card.suit, x, y, size, y > 70)).join('');
  return `<svg class="card__art" viewBox="0 0 100 140" aria-hidden="true">${body}</svg>`;
}

function cornerSvg(suit: Suit): string {
  return `<svg class="corner__suit" viewBox="0 0 100 100" aria-hidden="true"><path class="pip" d="${SUIT_PATHS[suit]}"/></svg>`;
}

export function suitSymbolSvg(suit: Suit, className = 'suit-mark'): string {
  return `<svg class="${className}" viewBox="0 0 100 100" aria-hidden="true"><path class="pip" d="${SUIT_PATHS[suit]}"/></svg>`;
}

export function cardLabel(card: Card): string {
  const names: Record<number, string> = { 1: 'Ace', 11: 'Jack', 12: 'Queen', 13: 'King' };
  const rank = names[card.rank] ?? String(card.rank);
  const suit = card.suit[0].toUpperCase() + card.suit.slice(1);
  return `${rank} of ${suit}`;
}

/** Builds the persistent DOM node for a card. Created once per deal. */
export function createCardElement(card: Card): HTMLElement {
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.id = card.id;
  el.dataset.suit = card.suit;
  el.dataset.color = colorOf(card.suit);
  el.dataset.rank = String(card.rank);
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', cardLabel(card));

  const label = RANK_LABEL[card.rank];
  el.innerHTML = `
    <div class="card__inner">
      <div class="card__face card__front">
        <div class="card__sheen"></div>
        <div class="corner corner--tl"><span class="corner__rank">${label}</span>${cornerSvg(card.suit)}</div>
        ${faceSvg(card)}
        <div class="corner corner--br"><span class="corner__rank">${label}</span>${cornerSvg(card.suit)}</div>
      </div>
      <div class="card__face card__back"><div class="card__back-art"></div></div>
    </div>`;
  return el;
}
