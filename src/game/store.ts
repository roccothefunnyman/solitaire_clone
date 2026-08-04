import { randomSeed } from './deck';
import { findWinnableSeed } from './solver';
import {
  ALL_PILES,
  type DrawCount,
  type GameState,
  type MoveResult,
  type Options,
  type PileId,
  type ScoringMode,
  autoMove,
  canAutoFinish,
  checkWon,
  cloneState,
  deal,
  drawFromStock,
  findHints,
  moveCards,
  nextAutoFinishMove,
} from './rules';

const SAVE_KEY = 'solitaire.save.v1';
const PREFS_KEY = 'solitaire.prefs.v1';
const STATS_KEY = 'solitaire.stats.v1';

export interface Prefs extends Options {
  theme: string;
  cardBack: string;
  sound: boolean;
  reducedMotion: boolean;
  leftHanded: boolean;
  /** Deal only hands a reasonable player can actually win. */
  winnableOnly: boolean;
}

export interface Stats {
  played: number;
  won: number;
  streak: number;
  bestStreak: number;
  bestTimeMs: number | null;
  bestScore: number | null;
  totalTimeMs: number;
}

export const DEFAULT_PREFS: Prefs = {
  draw: 3,
  scoring: 'standard',
  timed: true,
  theme: 'midnight',
  cardBack: 'aurora',
  sound: true,
  reducedMotion: false,
  leftHanded: false,
  winnableOnly: true,
};

const DEFAULT_STATS: Stats = {
  played: 0,
  won: 0,
  streak: 0,
  bestStreak: 0,
  bestTimeMs: null,
  bestScore: null,
  totalTimeMs: 0,
};

/** Always returns a fresh object — handing back `fallback` itself would let the
 *  caller mutate the DEFAULT_* constants in place. */
function load<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...fallback };
    return { ...fallback, ...(JSON.parse(raw) as T) };
  } catch {
    return { ...fallback };
  }
}

const DRAWS: DrawCount[] = [1, 3];
const SCORINGS: ScoringMode[] = ['standard', 'vegas', 'none'];

function validOptions(value: unknown): value is Options {
  if (!value || typeof value !== 'object') return false;
  const o = value as Options;
  return (
    DRAWS.includes(o.draw) && SCORINGS.includes(o.scoring) && typeof o.timed === 'boolean'
  );
}

/** A save file is only worth restoring if it is a complete, legal-looking 52-card game. */
function validSave(value: unknown): value is SaveFile {
  const file = value as SaveFile | null;
  if (!file?.state || typeof file.state !== 'object') return false;
  if (!validOptions(file.state.options)) return false;
  const piles = file.state.piles;
  if (!piles || typeof piles !== 'object') return false;
  let count = 0;
  const ids = new Set<string>();
  for (const id of ALL_PILES) {
    const pile = piles[id];
    if (!Array.isArray(pile)) return false;
    for (const card of pile) {
      if (!card || typeof card.id !== 'string') return false;
      ids.add(card.id);
      count++;
    }
  }
  return count === 52 && ids.size === 52;
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — play on regardless */
  }
}

export type StoreEvent =
  | { type: 'deal'; state: GameState }
  | { type: 'move'; state: GameState; result: MoveResult }
  | { type: 'undo'; state: GameState }
  | { type: 'reject'; from: PileId }
  | { type: 'tick'; state: GameState }
  | { type: 'win'; state: GameState }
  | { type: 'prefs'; prefs: Prefs };

type Listener = (event: StoreEvent) => void;

interface SaveFile {
  state: GameState;
  elapsedMs: number;
  countedPlayed: boolean;
}

export class Store {
  state: GameState;
  prefs: Prefs;
  stats: Stats;

  private history: GameState[] = [];
  private listeners = new Set<Listener>();
  private elapsedMs = 0;
  private runningSince: number | null = null;
  private timer: number | null = null;
  private countedPlayed = false;
  private countedWin = false;
  private autoFinishCache: boolean | null = null;

  constructor() {
    this.prefs = load(PREFS_KEY, DEFAULT_PREFS);
    // Stored prefs are just JSON someone could have edited; never let a bad value
    // reach the engine as a game option.
    if (!DRAWS.includes(this.prefs.draw)) this.prefs.draw = DEFAULT_PREFS.draw;
    if (!SCORINGS.includes(this.prefs.scoring)) this.prefs.scoring = DEFAULT_PREFS.scoring;
    if (typeof this.prefs.timed !== 'boolean') this.prefs.timed = DEFAULT_PREFS.timed;
    if (typeof this.prefs.winnableOnly !== 'boolean') {
      this.prefs.winnableOnly = DEFAULT_PREFS.winnableOnly;
    }
    this.stats = load(STATS_KEY, DEFAULT_STATS);

    const restored = this.loadSave();
    if (restored) {
      this.state = restored.state;
      this.elapsedMs = restored.elapsedMs;
      this.countedPlayed = restored.countedPlayed;
      // The settings dialog reads `prefs`, the game reads `state.options`, and they
      // live in different storage keys. A second tab can leave them disagreeing, so
      // the restored game always wins — otherwise the dialog advertises a mode the
      // player is not actually playing and cannot click their way out of.
      this.adoptOptions(this.state.options);
    } else {
      const options = this.optionsFromPrefs();
      this.state = deal(this.pickSeed(options), options);
      this.countedPlayed = false;
    }
    this.startTimer();
  }

  /* ------------------------------------------------------------- plumbing */

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(event: StoreEvent): void {
    for (const fn of this.listeners) fn(event);
  }

  private optionsFromPrefs(): Options {
    return { draw: this.prefs.draw, scoring: this.prefs.scoring, timed: this.prefs.timed };
  }

  /** Point the saved prefs at the mode actually being played. */
  private adoptOptions(options: Options): void {
    if (
      this.prefs.draw === options.draw &&
      this.prefs.scoring === options.scoring &&
      this.prefs.timed === options.timed
    ) {
      return;
    }
    this.prefs = { ...this.prefs, ...options };
    save(PREFS_KEY, this.prefs);
  }

  private loadSave(): SaveFile | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as SaveFile;
      if (!validSave(parsed)) return null;
      if (parsed.state.won) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private persist(): void {
    // Every state change funnels through here, so this is the one place the
    // auto-finish check needs re-evaluating.
    this.autoFinishCache = null;
    const file: SaveFile = {
      state: this.state,
      elapsedMs: this.elapsed(),
      countedPlayed: this.countedPlayed,
    };
    save(SAVE_KEY, file);
  }

  /* ---------------------------------------------------------------- timer */

  private startTimer(): void {
    if (this.timer !== null) return;
    this.runningSince = performance.now();
    this.timer = window.setInterval(() => {
      if (this.state.won) return;
      this.emit({ type: 'tick', state: this.state });
    }, 250);
  }

  private stopTimer(): void {
    if (this.runningSince !== null) {
      this.elapsedMs += performance.now() - this.runningSince;
      this.runningSince = null;
    }
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  elapsed(): number {
    return this.elapsedMs + (this.runningSince === null ? 0 : performance.now() - this.runningSince);
  }

  pause(): void {
    if (this.runningSince === null) return;
    this.elapsedMs += performance.now() - this.runningSince;
    this.runningSince = null;
    this.persist();
  }

  resume(): void {
    if (this.state.won) return;
    if (this.runningSince === null) this.runningSince = performance.now();
  }

  /** Timed play bleeds two points every ten seconds. */
  timePenalty(): number {
    if (this.state.options.scoring !== 'standard' || !this.state.options.timed) return 0;
    return -2 * Math.floor(this.elapsed() / 10000);
  }

  displayScore(): number {
    if (this.state.options.scoring === 'none') return 0;
    if (this.state.options.scoring === 'vegas') return this.state.score;
    return Math.max(0, this.state.score + this.timePenalty());
  }

  /* ------------------------------------------------------------- lifecycle */

  /** A random deal, or a filtered one when the player wants winnable hands. */
  private pickSeed(options: Options): number {
    if (!this.prefs.winnableOnly) return randomSeed();
    return findWinnableSeed(options, randomSeed, () => performance.now()).seed;
  }

  newGame(seed?: number): void {
    if (!this.countedPlayed && this.state.moves > 0 && !this.state.won) this.recordLoss();
    this.history = [];
    const options = this.optionsFromPrefs();
    this.state = deal(seed ?? this.pickSeed(options), options);
    this.elapsedMs = 0;
    this.runningSince = performance.now();
    this.countedPlayed = false;
    this.countedWin = false;
    this.startTimer();
    this.persist();
    this.emit({ type: 'deal', state: this.state });
  }

  restartDeal(): void {
    const seed = this.state.seed;
    this.history = [];
    this.state = deal(seed, this.optionsFromPrefs());
    this.elapsedMs = 0;
    this.runningSince = performance.now();
    this.countedPlayed = false;
    this.countedWin = false;
    this.startTimer();
    this.persist();
    this.emit({ type: 'deal', state: this.state });
  }

  setPrefs(patch: Partial<Prefs>): void {
    // `timed` is deliberately absent: it only affects scoring and the clock display,
    // so it applies to the hand in progress instead of throwing the deal away.
    const optionKeys: Array<keyof Options> = ['draw', 'scoring'];
    // Compared against the LIVE game, not against prefs: if the two ever disagree,
    // clicking the option that matches prefs must still re-deal, or the player is
    // stuck in a mode the dialog refuses to admit to.
    const changesOptions = optionKeys.some(
      (k) => patch[k] !== undefined && patch[k] !== this.state.options[k],
    );
    this.prefs = { ...this.prefs, ...patch };
    save(PREFS_KEY, this.prefs);

    if (patch.timed !== undefined && patch.timed !== this.state.options.timed) {
      this.state.options.timed = patch.timed;
      this.persist();
    }

    this.emit({ type: 'prefs', prefs: this.prefs });
    if (changesOptions) this.newGame();
  }

  /* ----------------------------------------------------------------- moves */

  private snapshot(): void {
    this.history.push(cloneState(this.state));
    if (this.history.length > 400) this.history.shift();
  }

  canUndo(): boolean {
    return this.history.length > 0;
  }

  undo(): void {
    const previous = this.history.pop();
    if (!previous) return;
    const wasWon = this.state.won;
    this.state = previous;
    // Winning stops the clock; undoing back into a live game must restart it.
    if (wasWon && !this.state.won) this.startTimer();
    this.persist();
    this.emit({ type: 'undo', state: this.state });
  }

  draw(): boolean {
    this.snapshot();
    const result = drawFromStock(this.state);
    if (!result) {
      this.history.pop();
      this.emit({ type: 'reject', from: 'stock' });
      return false;
    }
    this.afterMove(result);
    return true;
  }

  move(from: PileId, index: number, to: PileId): boolean {
    this.snapshot();
    const result = moveCards(this.state, from, index, to);
    if (!result) {
      this.history.pop();
      this.emit({ type: 'reject', from });
      return false;
    }
    this.afterMove(result);
    return true;
  }

  auto(from: PileId, index: number): boolean {
    this.snapshot();
    const result = autoMove(this.state, from, index);
    if (!result) {
      this.history.pop();
      this.emit({ type: 'reject', from });
      return false;
    }
    this.afterMove(result);
    return true;
  }

  private afterMove(result: MoveResult): void {
    this.state.won = checkWon(this.state);
    this.persist();
    this.emit({ type: 'move', state: this.state, result });
    if (this.state.won) this.finishWin();
  }

  /** Cached because the HUD asks every timer tick and the check simulates the finisher. */
  canAutoFinish(): boolean {
    if (this.autoFinishCache === null) this.autoFinishCache = canAutoFinish(this.state);
    return this.autoFinishCache;
  }

  /** One step of the auto-finish cascade. Returns false when there is nothing left. */
  autoFinishStep(): boolean {
    const next = nextAutoFinishMove(this.state);
    if (!next) return false;
    if (next.from === 'stock') return this.draw();
    return this.move(next.from, next.index, next.to);
  }

  hint() {
    return findHints(this.state)[0] ?? null;
  }

  /* ----------------------------------------------------------------- stats */

  private finishWin(): void {
    this.stopTimer();
    const time = this.elapsed();
    const finalScore = this.finalScore();

    // Undoing the winning move and replaying it must not bank the win twice.
    if (!this.countedWin) {
      this.countedWin = true;
      this.stats.played += this.countedPlayed ? 0 : 1;
      this.countedPlayed = true;
      this.stats.won += 1;
      this.stats.streak += 1;
      this.stats.bestStreak = Math.max(this.stats.bestStreak, this.stats.streak);
      this.stats.totalTimeMs += time;
      if (this.stats.bestTimeMs === null || time < this.stats.bestTimeMs) {
        this.stats.bestTimeMs = time;
      }
      if (this.state.options.scoring !== 'none') {
        if (this.stats.bestScore === null || finalScore > this.stats.bestScore) {
          this.stats.bestScore = finalScore;
        }
      }
      save(STATS_KEY, this.stats);
    }
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* ignore */
    }
    this.emit({ type: 'win', state: this.state });
  }

  private recordLoss(): void {
    this.stats.played += 1;
    this.stats.streak = 0;
    this.countedPlayed = true;
    save(STATS_KEY, this.stats);
  }

  /** Timed standard games pay a completion bonus, exactly like the old Windows build. */
  timeBonus(): number {
    if (this.state.options.scoring !== 'standard' || !this.state.options.timed) return 0;
    const seconds = Math.max(1, Math.round(this.elapsed() / 1000));
    if (seconds < 30) return 0;
    return Math.floor(700000 / seconds);
  }

  finalScore(): number {
    if (this.state.options.scoring === 'none') return 0;
    if (this.state.options.scoring === 'vegas') return this.state.score;
    return Math.max(0, this.state.score + this.timePenalty() + (this.state.won ? this.timeBonus() : 0));
  }

  resetStats(): void {
    this.stats = {
      played: 0,
      won: 0,
      streak: 0,
      bestStreak: 0,
      bestTimeMs: null,
      bestScore: null,
      totalTimeMs: 0,
    };
    this.countedPlayed = false;
    this.countedWin = false;
    save(STATS_KEY, this.stats);
  }
}
