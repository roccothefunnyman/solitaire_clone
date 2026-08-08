/**
 * Win celebration: translucent balloons drifting up the screen with firework bursts
 * over them. Runs alongside the bouncing-card cascade rather than replacing it.
 *
 * Everything is CSS animation driven from custom properties, so the main thread only
 * creates nodes and then leaves the compositor to it.
 */

const BALLOON_HUES = [-40, -10, 20, 60, 110, 175, 220, 285, 320];
const BALLOONS = 22;
const BURSTS = 7;
const SHARDS = 22;
const RUN_MS = 9000;

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export class Celebration {
  private layer: HTMLElement;
  private timers: number[] = [];
  private running = false;

  constructor() {
    this.layer = document.createElement('div');
    this.layer.className = 'party';
    this.layer.setAttribute('aria-hidden', 'true');
  }

  /** `onBurst` fires with each firework so the caller can play a sparkle. */
  start(onBurst?: () => void): void {
    this.stop();
    this.running = true;
    document.body.appendChild(this.layer);

    for (let i = 0; i < BALLOONS; i++) {
      this.after(rand(0, 3400), () => this.balloon());
    }
    for (let i = 0; i < BURSTS; i++) {
      this.after(420 + i * rand(700, 1100), () => {
        this.burst();
        onBurst?.();
      });
    }
    this.after(RUN_MS, () => this.stop());
  }

  private after(ms: number, fn: () => void): void {
    this.timers.push(
      window.setTimeout(() => {
        if (this.running) fn();
      }, ms),
    );
  }

  private balloon(): void {
    const el = document.createElement('div');
    el.className = 'party__balloon';
    const size = rand(46, 96);
    el.style.setProperty('--x', `${rand(2, 96)}vw`);
    el.style.setProperty('--size', `${size}px`);
    el.style.setProperty('--hue', String(BALLOON_HUES[Math.floor(Math.random() * BALLOON_HUES.length)]));
    el.style.setProperty('--rise', `${rand(6.5, 11)}s`);
    el.style.setProperty('--sway', `${rand(2.6, 4.6)}s`);
    el.style.setProperty('--drift', `${rand(-40, 40)}px`);
    el.style.setProperty('--tilt', `${rand(-9, 9)}deg`);
    el.innerHTML = '<i class="party__body"></i><i class="party__string"></i>';
    this.layer.appendChild(el);
    // Clean up after the rise finishes, so a long finale never piles up nodes.
    el.addEventListener('animationend', (e) => {
      if ((e as AnimationEvent).animationName === 'balloon-rise') el.remove();
    });
  }

  private burst(): void {
    const el = document.createElement('div');
    el.className = 'party__burst';
    el.style.left = `${rand(14, 86)}vw`;
    el.style.top = `${rand(12, 46)}vh`;
    const hue = BALLOON_HUES[Math.floor(Math.random() * BALLOON_HUES.length)];
    el.style.setProperty('--hue', String(hue));

    // A bright bloom at the centre so the burst reads instantly against the board.
    const flash = document.createElement('b');
    flash.className = 'party__flash';
    el.appendChild(flash);

    for (let i = 0; i < SHARDS; i++) {
      const shard = document.createElement('i');
      const angle = (Math.PI * 2 * i) / SHARDS + rand(-0.1, 0.1);
      const reach = rand(110, 240);
      shard.style.setProperty('--dx', `${Math.cos(angle) * reach}px`);
      shard.style.setProperty('--dy', `${Math.sin(angle) * reach}px`);
      shard.style.setProperty('--fall', `${rand(40, 95)}px`);
      shard.style.setProperty('--sz', `${rand(10, 18)}px`);
      shard.style.setProperty('--hue', String(hue + rand(-22, 22)));
      shard.style.setProperty('--spark', `${rand(1.1, 1.8)}s`);
      el.appendChild(shard);
    }

    this.layer.appendChild(el);
    this.after(1600, () => el.remove());
  }

  stop(): void {
    this.running = false;
    for (const id of this.timers) clearTimeout(id);
    this.timers = [];
    this.layer.replaceChildren();
    this.layer.remove();
  }
}
