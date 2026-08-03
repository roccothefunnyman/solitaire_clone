/**
 * Minimal browser globals so `store.ts` can run under Node. The clock is manual —
 * `performance.now()` only advances when a test says so — and `window.setInterval`
 * hands back a fake numeric id instead of a real timer, so a Store under test never
 * keeps the process alive.
 */
const realClearInterval = globalThis.clearInterval;

export function installBrowserStubs() {
  const storage = new Map();
  let now = 0;
  let nextTimerId = 0;
  let liveTimers = 0;

  globalThis.localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => void storage.set(k, String(v)),
    removeItem: (k) => void storage.delete(k),
    clear: () => storage.clear(),
  };

  globalThis.performance = { now: () => now };

  globalThis.window = {
    setInterval: () => {
      liveTimers++;
      return ++nextTimerId;
    },
    setTimeout: () => ++nextTimerId,
  };

  globalThis.clearInterval = (id) => {
    // Node's own timers are objects; ours are numbers.
    if (typeof id === 'number') {
      liveTimers--;
      return;
    }
    realClearInterval(id);
  };

  return {
    advance: (ms) => {
      now += ms;
    },
    reset: () => {
      storage.clear();
      now = 0;
      liveTimers = 0;
    },
    raw: (key) => (storage.has(key) ? storage.get(key) : null),
    liveTimers: () => liveTimers,
  };
}
