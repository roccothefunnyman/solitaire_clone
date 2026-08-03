interface Flier {
  el: HTMLElement;
  source: HTMLElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  spin: number;
  angle: number;
  alive: boolean;
  ghostAt: number;
}

/** Units are per 60fps frame; `tick` scales them by real elapsed time. */
const GRAVITY = 0.62;
const BOUNCE = 0.8;
const GHOST_POOL = 170;
const GHOST_EVERY_MS = 46;
const MAX_MS = 11000;

/**
 * The bouncing-cards finale, rebuilt: real card nodes fly under gravity and
 * leave a fading trail of ghost copies behind them.
 */
export class WinCascade {
  private overlay: HTMLElement;
  private ghosts: HTMLElement[] = [];
  private ghostIndex = 0;
  private fliers: Flier[] = [];
  private raf = 0;
  private queue: HTMLElement[] = [];
  private launched: HTMLElement[] = [];
  private nextLaunch = 0;
  private running = false;

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'cascade';
    this.overlay.setAttribute('aria-hidden', 'true');
  }

  /** Runs until the deck has flown off screen, or `MAX_MS`, then calls back. */
  start(cards: HTMLElement[], onSettled?: () => void): void {
    this.stop();
    document.body.appendChild(this.overlay);
    const hint = document.createElement('p');
    hint.className = 'cascade__hint';
    hint.textContent = 'Click anywhere to continue';
    this.overlay.appendChild(hint);
    this.running = true;

    for (let i = 0; i < GHOST_POOL; i++) {
      const ghost = document.createElement('div');
      ghost.className = 'cascade__ghost';
      this.overlay.appendChild(ghost);
      this.ghosts.push(ghost);
    }

    this.queue = cards.slice().reverse();
    this.nextLaunch = 0;

    const started = performance.now();
    let last = started;
    const finish = () => {
      this.running = false;
      onSettled?.();
    };
    const step = (now: number) => {
      if (!this.running) return;
      // Frame-rate independent: a slow frame advances the sim further, so the
      // finale looks the same on a 30fps laptop and a 120Hz display.
      const dt = Math.min(3, (now - last) / 16.667) || 1;
      last = now;
      if (now >= this.nextLaunch && this.queue.length) {
        this.launch(this.queue.pop()!);
        this.nextLaunch = now + 80;
      }
      this.tick(dt, now);
      if (now - started > MAX_MS) finish();
      else if (this.fliers.length || this.queue.length) this.raf = requestAnimationFrame(step);
      else finish();
    };
    this.raf = requestAnimationFrame(step);
  }

  private launch(el: HTMLElement): void {
    const rect = el.getBoundingClientRect();
    if (!rect.width) return;
    const clone = el.cloneNode(true) as HTMLElement;
    clone.className = `${el.className} cascade__card`;
    clone.style.width = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    this.overlay.appendChild(clone);
    // The foundation visibly empties as its cards take off.
    el.style.visibility = 'hidden';
    this.launched.push(el);

    const dir = rect.left < window.innerWidth / 2 ? 1 : -1;
    this.fliers.push({
      el: clone,
      source: el,
      x: rect.left,
      y: rect.top,
      vx: dir * (4.2 + Math.random() * 6),
      vy: -(3 + Math.random() * 5),
      w: rect.width,
      h: rect.height,
      spin: (Math.random() - 0.5) * 0.9,
      angle: 0,
      alive: true,
      ghostAt: 0,
    });
  }

  private spawnGhost(f: Flier): void {
    const ghost = this.ghosts[this.ghostIndex];
    this.ghostIndex = (this.ghostIndex + 1) % this.ghosts.length;
    ghost.style.width = `${f.w}px`;
    ghost.style.height = `${f.h}px`;
    ghost.style.transform = `translate3d(${f.x}px, ${f.y}px, 0) rotate(${f.angle}deg)`;
    ghost.style.background = f.el.dataset.color === 'red' ? 'var(--ghost-red)' : 'var(--ghost-black)';
    ghost.classList.remove('is-live');
    void ghost.offsetWidth;
    ghost.classList.add('is-live');
  }

  private tick(dt: number, now: number): void {
    const floor = window.innerHeight;
    for (const f of this.fliers) {
      f.vy += GRAVITY * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.angle += f.spin * dt;

      if (f.y + f.h >= floor) {
        f.y = floor - f.h;
        f.vy = -Math.abs(f.vy) * BOUNCE;
        f.spin *= 0.7;
        if (Math.abs(f.vy) < 2.2) f.vy = -6 - Math.random() * 3;
      }
      if (now - f.ghostAt >= GHOST_EVERY_MS) {
        f.ghostAt = now;
        this.spawnGhost(f);
      }
      f.el.style.transform = `translate3d(${f.x}px, ${f.y}px, 0) rotate(${f.angle}deg)`;

      if (f.x < -f.w * 2 || f.x > window.innerWidth + f.w * 2) f.alive = false;
    }
    for (const f of this.fliers) if (!f.alive) f.el.remove();
    this.fliers = this.fliers.filter((f) => f.alive);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.fliers.forEach((f) => f.el.remove());
    this.launched.forEach((el) => (el.style.visibility = ''));
    this.launched = [];
    this.fliers = [];
    this.queue = [];
    this.ghosts = [];
    this.ghostIndex = 0;
    this.overlay.replaceChildren();
    this.overlay.remove();
  }
}
