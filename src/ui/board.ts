import type { Card } from '../game/deck';
import {
  ALL_PILES,
  FOUNDATIONS,
  TABLEAUS,
  type PileId,
  canDrop,
  canGrab,
  canRecycle,
  pileKind,
} from '../game/rules';
import type { Store } from '../game/store';
import { createCardElement } from './cardArt';
import { sound } from './sound';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Placement {
  x: number;
  y: number;
  z: number;
}

interface DragState {
  pointerId: number;
  from: PileId;
  index: number;
  cardId: string;
  cards: HTMLElement[];
  origins: Placement[];
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  moved: boolean;
  startedAt: number;
}

const CLICK_SLOP = 7;
/** Matches the usual OS double-click window. */
export const DOUBLE_CLICK_MS = 400;

export interface TapMemory {
  cardId: string;
  at: number;
}

export const NO_TAP: TapMemory = { cardId: '', at: 0 };

/**
 * Whether a click/tap that didn't turn into a drag should send the card home.
 *
 * A double-click is two clicks on the *same* card: a board-wide timestamp alone
 * would let a click on card A arm a click on card B. The pair is consumed on a
 * match so a third rapid click starts fresh rather than firing again.
 */
export function tapDecision(
  prev: TapMemory,
  cardId: string,
  now: number,
  isTouch: boolean,
): { auto: boolean; next: TapMemory } {
  const quickSecond = prev.cardId === cardId && now - prev.at < DOUBLE_CLICK_MS;
  return {
    auto: isTouch || quickSecond,
    next: quickSecond ? NO_TAP : { cardId, at: now },
  };
}

export class Board {
  private cardEls = new Map<string, HTMLElement>();
  private slotEls = new Map<PileId, HTMLElement>();
  private slotRects = new Map<PileId, Rect>();
  private dropRects = new Map<PileId, Rect>();
  /** Cards completely hidden under another card — their shadows would pile up. */
  private buried = new Set<string>();
  private drag: DragState | null = null;
  private cardW = 100;
  private cardH = 140;
  private fanDown = 0.145;
  private fanUp = 0.255;
  private lastTap: TapMemory = NO_TAP;

  constructor(
    private store: Store,
    private table: HTMLElement,
    private layer: HTMLElement,
  ) {
    this.buildSlots();
    this.attachEvents();
  }

  /* ------------------------------------------------------------- structure */

  private buildSlots(): void {
    const spec: Array<{ id: PileId; className: string; label: string }> = [
      { id: 'stock', className: 'slot slot--stock', label: 'Stock' },
      { id: 'waste', className: 'slot slot--waste', label: 'Waste' },
      ...FOUNDATIONS.map((id, i) => ({
        id,
        className: `slot slot--foundation slot--foundation-${i}`,
        label: `Foundation ${i + 1}`,
      })),
      ...TABLEAUS.map((id, i) => ({
        id,
        className: 'slot slot--tableau',
        label: `Column ${i + 1}`,
      })),
    ];

    const top = this.table.querySelector('.row--top') as HTMLElement;
    const bottom = this.table.querySelector('.row--tableau') as HTMLElement;

    for (const s of spec) {
      const el = document.createElement('div');
      el.className = s.className;
      el.dataset.pile = s.id;
      el.setAttribute('aria-label', s.label);
      if (pileKind(s.id) === 'foundation') {
        el.innerHTML = '<span class="slot__mark"></span>';
      } else if (s.id === 'stock') {
        el.innerHTML = '<span class="slot__recycle" aria-hidden="true"></span>';
      }
      this.slotEls.set(s.id, el);
      (pileKind(s.id) === 'tableau' ? bottom : top).appendChild(el);
    }
  }

  /** Rebuilds every card element — called once per deal. */
  buildDeal(): void {
    this.layer.replaceChildren();
    this.cardEls.clear();
    for (const pileId of ALL_PILES) {
      for (const card of this.store.state.piles[pileId]) {
        const el = createCardElement(card);
        this.cardEls.set(card.id, el);
        this.layer.appendChild(el);
      }
    }
  }

  /* ---------------------------------------------------------------- layout */

  measure(): void {
    const base = this.layer.getBoundingClientRect();
    for (const [id, el] of this.slotEls) {
      const r = el.getBoundingClientRect();
      this.slotRects.set(id, { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height });
    }
    const stock = this.slotRects.get('stock');
    if (stock) {
      this.cardW = stock.w;
      this.cardH = stock.h;
    }
    const css = getComputedStyle(document.documentElement);
    this.fanDown = Number.parseFloat(css.getPropertyValue('--fan-down')) || 0.145;
    this.fanUp = Number.parseFloat(css.getPropertyValue('--fan-up')) || 0.255;
  }

  private fanOffsets(pileId: PileId): { down: number; up: number } {
    const pile = this.store.state.piles[pileId];
    const slot = this.slotRects.get(pileId)!;
    let down = this.cardH * this.fanDown;
    let up = this.cardH * this.fanUp;

    const hidden = pile.filter((c) => !c.faceUp).length;
    const shown = Math.max(0, pile.length - hidden - 1);
    const needed = hidden * down + shown * up;
    const available = Math.max(this.cardH * 0.6, this.layer.clientHeight - slot.y - this.cardH - 4);
    if (needed > available && needed > 0) {
      const scale = available / needed;
      down *= scale;
      up *= scale;
    }
    return { down, up };
  }

  private placements(): Map<string, Placement> {
    const out = new Map<string, Placement>();
    const state = this.store.state;
    this.buried.clear();

    const stockSlot = this.slotRects.get('stock')!;
    const stock = state.piles['stock'];
    stock.forEach((card, i) => {
      const lift = Math.min(5, Math.floor(i / 6)) * 0.9;
      if (i < stock.length - 1) this.buried.add(card.id);
      out.set(card.id, { x: stockSlot.x, y: stockSlot.y - lift, z: 100 + i });
    });

    const wasteSlot = this.slotRects.get('waste')!;
    const waste = state.piles['waste'];
    const fanCount = state.options.draw === 1 ? 1 : 3;
    const dir = document.documentElement.classList.contains('left-handed') ? -1 : 1;
    const spread = this.cardW * 0.34 * dir;
    const visibleFrom = Math.max(0, waste.length - fanCount);
    waste.forEach((card, i) => {
      const step = i < visibleFrom ? 0 : i - visibleFrom;
      if (i < visibleFrom) this.buried.add(card.id);
      out.set(card.id, { x: wasteSlot.x + step * spread, y: wasteSlot.y, z: 200 + i });
    });

    FOUNDATIONS.forEach((id, fi) => {
      const slot = this.slotRects.get(id)!;
      const pile = state.piles[id];
      pile.forEach((card, i) => {
        const lift = Math.min(4, Math.floor(i / 4)) * 0.8;
        if (i < pile.length - 1) this.buried.add(card.id);
        out.set(card.id, { x: slot.x, y: slot.y - lift, z: 300 + fi * 60 + i });
      });
    });

    TABLEAUS.forEach((id, ti) => {
      const slot = this.slotRects.get(id)!;
      const { down, up } = this.fanOffsets(id);
      let y = slot.y;
      state.piles[id].forEach((card, i) => {
        out.set(card.id, { x: slot.x, y, z: 1000 + ti * 60 + i });
        y += card.faceUp ? up : down;
      });
      const height = y - slot.y + this.cardH;
      this.dropRects.set(id, { x: slot.x, y: slot.y, w: this.cardW, h: Math.max(this.cardH, height) });
    });

    for (const id of [...FOUNDATIONS, 'waste', 'stock'] as PileId[]) {
      const slot = this.slotRects.get(id)!;
      this.dropRects.set(id, { ...slot });
    }

    return out;
  }

  /** Positions every card from current state. `instant` skips transitions. */
  render(instant = false): void {
    if (!this.slotRects.size) this.measure();
    const places = this.placements();
    const state = this.store.state;

    if (instant) this.layer.classList.add('no-anim');

    for (const [id, el] of this.cardEls) {
      const place = places.get(id);
      if (!place) continue;
      if (this.drag && this.drag.cards.includes(el)) continue;
      el.style.transform = `translate3d(${place.x.toFixed(2)}px, ${place.y.toFixed(2)}px, 0)`;
      el.style.zIndex = String(place.z);
      el.classList.toggle('is-buried', this.buried.has(id));
    }

    for (const [id, card] of this.allCards()) {
      const el = this.cardEls.get(id);
      if (el) el.classList.toggle('is-up', card.faceUp);
    }

    // "Exhausted" means the stock will never come back — either nothing is left at all,
    // or the redeal limit is spent. Showing the recycle arrow in that state made a dead
    // stock look identical to one more click away from a fresh pass.
    const stockEmpty = state.piles['stock'].length === 0;
    this.slotEls.get('stock')!.classList.toggle('is-empty', stockEmpty);
    this.slotEls.get('stock')!.classList.toggle('is-exhausted', stockEmpty && !canRecycle(state));

    if (instant) {
      void this.layer.offsetHeight;
      this.layer.classList.remove('no-anim');
    }
  }

  private *allCards(): Generator<[string, Card]> {
    for (const pileId of ALL_PILES) {
      for (const card of this.store.state.piles[pileId]) yield [card.id, card];
    }
  }

  /** Cinematic deal: everything springs out of the stock. */
  dealAnimation(): void {
    const stock = this.slotRects.get('stock');
    if (!stock) return;
    this.layer.classList.add('no-anim');
    let i = 0;
    for (const el of this.cardEls.values()) {
      el.style.transform = `translate3d(${stock.x}px, ${stock.y}px, 0)`;
      el.classList.remove('is-up');
      el.style.transitionDelay = `${Math.min(i, 28) * 18}ms`;
      i++;
    }
    void this.layer.offsetHeight;
    this.layer.classList.remove('no-anim');
    requestAnimationFrame(() => {
      this.render(false);
      window.setTimeout(() => {
        for (const el of this.cardEls.values()) el.style.transitionDelay = '';
      }, 900);
    });
  }

  /* ------------------------------------------------------------ locating */

  private locate(cardId: string): { pile: PileId; index: number } | null {
    for (const pileId of ALL_PILES) {
      const index = this.store.state.piles[pileId].findIndex((c) => c.id === cardId);
      if (index >= 0) return { pile: pileId, index };
    }
    return null;
  }

  private overlap(a: Rect, b: Rect): number {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
  }

  /* -------------------------------------------------------------- events */

  private attachEvents(): void {
    this.layer.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove, { passive: false });
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);

    this.table.addEventListener('pointerdown', (e) => {
      const slot = (e.target as HTMLElement).closest('.slot') as HTMLElement | null;
      if (slot?.dataset.pile === 'stock') {
        e.preventDefault();
        this.store.draw();
      }
    });

    // No `dblclick` listener: the gesture is owned solely by onPointerUp. Two
    // handlers for one physical double-click fired auto-move twice, and the second
    // pass could pull the card straight back off the foundation.

    this.layer.addEventListener('contextmenu', (e) => {
      const el = (e.target as HTMLElement).closest('.card') as HTMLElement | null;
      if (!el?.dataset.id) return;
      e.preventDefault();
      const at = this.locate(el.dataset.id);
      if (at && at.pile !== 'stock') this.store.auto(at.pile, at.index);
    });
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const el = (e.target as HTMLElement).closest('.card') as HTMLElement | null;
    if (!el?.dataset.id) return;
    const at = this.locate(el.dataset.id);
    if (!at) return;

    if (at.pile === 'stock') {
      e.preventDefault();
      this.store.draw();
      return;
    }
    if (!canGrab(this.store.state, at.pile, at.index)) return;

    e.preventDefault();
    const cards = this.store.state.piles[at.pile].slice(at.index);
    const els = cards.map((c) => this.cardEls.get(c.id)!).filter(Boolean);
    const places = this.placements();
    const origins = cards.map((c) => places.get(c.id)!);

    this.drag = {
      pointerId: e.pointerId,
      from: at.pile,
      index: at.index,
      cardId: el.dataset.id,
      cards: els,
      origins,
      startX: e.clientX,
      startY: e.clientY,
      dx: 0,
      dy: 0,
      moved: false,
      startedAt: performance.now(),
    };

    els.forEach((cardEl, i) => {
      cardEl.classList.add('is-dragging');
      cardEl.style.zIndex = String(9000 + i);
    });
  };

  private onPointerMove = (e: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.dx = e.clientX - drag.startX;
    drag.dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(drag.dx, drag.dy) > CLICK_SLOP) {
      drag.moved = true;
      this.layer.classList.add('is-dragging-any');
    }
    if (!drag.moved) return;
    e.preventDefault();

    drag.cards.forEach((el, i) => {
      const o = drag.origins[i];
      el.style.transform = `translate3d(${o.x + drag.dx}px, ${o.y + drag.dy}px, 0)`;
    });
    this.highlightTarget(this.hitTest(drag));
  };

  private onPointerUp = (e: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    this.drag = null;
    this.layer.classList.remove('is-dragging-any');
    drag.cards.forEach((el) => el.classList.remove('is-dragging'));
    this.highlightTarget(null);

    if (!drag.moved) {
      const { auto, next } = tapDecision(
        this.lastTap,
        drag.cardId,
        performance.now(),
        e.pointerType !== 'mouse',
      );
      this.lastTap = next;
      if (auto) this.store.auto(drag.from, drag.index);
      this.render(false);
      return;
    }

    const target = this.hitTest(drag);
    if (target && this.store.move(drag.from, drag.index, target)) return;
    sound.play('reject');
    this.render(false);
  };

  private hitTest(drag: DragState): PileId | null {
    const first = drag.origins[0];
    const rect: Rect = { x: first.x + drag.dx, y: first.y + drag.dy, w: this.cardW, h: this.cardH };
    let best: PileId | null = null;
    let bestArea = this.cardW * this.cardH * 0.08;
    for (const [id, drop] of this.dropRects) {
      if (!canDrop(this.store.state, drag.from, drag.index, id)) continue;
      const area = this.overlap(rect, drop);
      if (area > bestArea) {
        bestArea = area;
        best = id;
      }
    }
    return best;
  }

  private highlightTarget(pile: PileId | null): void {
    for (const [id, el] of this.slotEls) el.classList.toggle('is-target', id === pile);
    for (const el of this.cardEls.values()) el.classList.remove('is-target-top');
    if (!pile) return;
    const top = this.store.state.piles[pile].at(-1);
    if (top) this.cardEls.get(top.id)?.classList.add('is-target-top');
  }

  /* -------------------------------------------------------------- effects */

  flashHint(cardId: string, to: PileId): void {
    const el = cardId ? this.cardEls.get(cardId) : null;
    const target =
      this.store.state.piles[to].at(-1) ?? null;
    const targetEl = target ? this.cardEls.get(target.id) : this.slotEls.get(to);
    el?.classList.add('is-hint');
    targetEl?.classList.add('is-hint-target');
    if (!cardId) this.slotEls.get('stock')?.classList.add('is-hint-target');
    window.setTimeout(() => {
      el?.classList.remove('is-hint');
      targetEl?.classList.remove('is-hint-target');
      this.slotEls.get('stock')?.classList.remove('is-hint-target');
    }, 1400);
  }

  pulseInvalid(pile: PileId): void {
    const el = this.slotEls.get(pile);
    if (!el) return;
    el.classList.remove('is-shake');
    void el.offsetWidth;
    el.classList.add('is-shake');
  }

  elementFor(cardId: string): HTMLElement | undefined {
    return this.cardEls.get(cardId);
  }

  foundationCardElements(): HTMLElement[] {
    const out: HTMLElement[] = [];
    for (const id of FOUNDATIONS) {
      for (const card of this.store.state.piles[id]) {
        const el = this.cardEls.get(card.id);
        if (el) out.push(el);
      }
    }
    return out;
  }
}
