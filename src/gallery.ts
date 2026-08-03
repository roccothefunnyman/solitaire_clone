/**
 * Dev-only proof sheet: renders every card face plus each back design so the
 * artwork can be eyeballed without dealing a hundred games. Visit /gallery.html
 * while `npm run dev` is running.
 */
import './styles/theme.css';
import './styles/cards.css';
import './styles/app.css';

import { makeDeck } from './game/deck';
import { createCardElement } from './ui/cardArt';

const root = document.getElementById('gallery')!;
document.body.style.overflow = 'auto';
document.body.style.padding = '24px';
root.style.cssText =
  'display:grid;grid-template-columns:repeat(13,var(--card-w));gap:calc(var(--card-w) * .12);justify-content:center;';
const width = new URLSearchParams(location.search).get('w') ?? '96';
document.documentElement.style.setProperty('--card-w', `${width}px`);

const byRank = makeDeck().sort((a, b) => a.rank - b.rank);
for (const card of byRank) {
  card.faceUp = true;
  const el = createCardElement(card);
  el.classList.add('is-up');
  el.style.position = 'relative';
  root.appendChild(el);
}

const backs = document.createElement('div');
backs.style.cssText = 'display:flex;gap:16px;justify-content:center;margin-top:28px;';
for (const back of ['aurora', 'lattice', 'bloom', 'noir']) {
  const card = { id: `back-${back}`, suit: 'spades' as const, rank: 1, faceUp: false };
  const el = createCardElement(card);
  el.style.position = 'relative';
  el.dataset.backOverride = back;
  const holder = document.createElement('div');
  holder.dataset.back = back;
  holder.appendChild(el);
  backs.appendChild(holder);
}
document.body.appendChild(backs);
