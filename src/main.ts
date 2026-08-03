import './styles/theme.css';
import './styles/cards.css';
import './styles/app.css';

import { Store, type Prefs } from './game/store';
import { Board } from './ui/board';
import { sound } from './ui/sound';
import { WinCascade } from './ui/winCascade';

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T;

const store = new Store();
const table = $('#table');
const layer = $('#cards');
const board = new Board(store, table, layer);
const cascade = new WinCascade();

let autoTimer: number | null = null;

/* ------------------------------------------------------------------ helpers */

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

let toastTimer: number | null = null;
function toast(message: string): void {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('is-on');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('is-on'), 2200);
}

/* --------------------------------------------------------------------- HUD */

function updateHud(): void {
  const { state } = store;
  $('#scoreValue').textContent = String(store.displayScore());
  $('#timeValue').textContent = formatTime(store.elapsed());
  $('#movesValue').textContent = String(state.moves);
  $('#drawValue').textContent = state.options.draw === 1 ? 'One' : 'Three';
  $('#dealLabel').textContent = `Deal #${(state.seed % 100000).toString().padStart(5, '0')}`;

  $('#chipScore').classList.toggle('is-hidden', state.options.scoring === 'none');
  $('#chipTime').classList.toggle('is-hidden', !state.options.timed);

  ($('#btnUndo') as HTMLButtonElement).disabled = !store.canUndo();
  const auto = $('#btnAuto');
  const running = autoTimer !== null;
  auto.classList.toggle('is-hidden', !store.canAutoFinish() && !running);
  auto.querySelector('span')!.textContent = running ? 'Stop' : 'Auto-finish';
  auto.title = running ? 'Stop auto-finish (A)' : 'Auto-finish (A)';
}

function applyPrefs(prefs: Prefs): void {
  document.documentElement.dataset.theme = prefs.theme;
  document.documentElement.dataset.back = prefs.cardBack;
  document.documentElement.classList.toggle('reduced-motion', prefs.reducedMotion);
  document.documentElement.classList.toggle('left-handed', prefs.leftHanded);
  sound.enabled = prefs.sound;
  syncControls(prefs);
  requestAnimationFrame(() => {
    board.measure();
    board.render(true);
  });
}

function syncControls(prefs: Prefs): void {
  const setGroup = (sel: string, value: string) => {
    for (const b of document.querySelectorAll<HTMLButtonElement>(`${sel} [data-value]`)) {
      const on = b.dataset.value === value;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
    }
  };
  setGroup('#optDraw', String(prefs.draw));
  setGroup('#optScoring', prefs.scoring);
  setGroup('#optTheme', prefs.theme);
  setGroup('#optBack', prefs.cardBack);

  const setSwitch = (sel: string, on: boolean) => {
    const el = $(sel);
    el.classList.toggle('is-on', on);
    el.setAttribute('aria-checked', String(on));
  };
  setSwitch('#optTimed', prefs.timed);
  setSwitch('#optSound', prefs.sound);
  setSwitch('#optMotion', prefs.reducedMotion);
  setSwitch('#optLeft', prefs.leftHanded);
}

/* ------------------------------------------------------------------ events */

store.subscribe((event) => {
  switch (event.type) {
    case 'deal':
      stopAuto();
      cascade.stop();
      board.buildDeal();
      board.measure();
      if (store.prefs.reducedMotion) board.render(true);
      else board.dealAnimation();
      sound.play('deal');
      updateHud();
      break;

    case 'move': {
      board.render(false);
      const { result } = event;
      if (result.type === 'draw') sound.play('draw');
      else if (result.type === 'recycle') sound.play('flip');
      else if (result.toFoundation) sound.play('foundation');
      else sound.play('place');
      if (result.flippedId) window.setTimeout(() => sound.play('flip'), 90);
      if (result.points <= -15) toast(`${result.points} points`);
      updateHud();
      break;
    }

    case 'undo':
      board.render(false);
      sound.play('undo');
      updateHud();
      break;

    case 'reject':
      board.pulseInvalid(event.from);
      updateHud();
      break;

    case 'tick':
      updateHud();
      break;

    case 'win':
      stopAuto();
      updateHud();
      celebrate();
      break;

    case 'prefs':
      applyPrefs(event.prefs);
      updateHud();
      break;
  }
});

function celebrate(): void {
  sound.play('win');
  if (store.prefs.reducedMotion) {
    window.setTimeout(showWinDialog, 400);
    return;
  }

  // The dialog's backdrop would blur the finale away, so it waits for the last
  // card to leave — unless the player taps to skip ahead.
  const finish = () => {
    window.removeEventListener('pointerdown', skip);
    window.removeEventListener('keydown', skip);
    cascade.stop();
    showWinDialog();
  };
  const skip = () => finish();
  window.addEventListener('pointerdown', skip);
  window.addEventListener('keydown', skip);
  cascade.start(board.foundationCardElements(), finish);
}

let winShown = false;
function showWinDialog(): void {
  if (winShown) return;
  winShown = true;
  const dialog = $<HTMLDialogElement>('#winDialog');
  const rows: Array<[string, string]> = [['Moves', String(store.state.moves)]];
  if (store.state.options.timed) rows.unshift(['Time', formatTime(store.elapsed())]);
  if (store.state.options.scoring !== 'none') {
    rows.unshift(['Final score', String(store.finalScore())]);
    const bonus = store.timeBonus();
    if (bonus > 0) rows.push(['Time bonus', `+${bonus}`]);
  }
  $('#winStats').innerHTML = rows
    .map(([k, v]) => `<div class="win__stat"><span>${k}</span><strong>${v}</strong></div>`)
    .join('');
  $('#winSub').textContent =
    store.stats.streak > 1 ? `${store.stats.streak} wins in a row.` : 'Every card home.';
  dialog.showModal();
}

/* ------------------------------------------------------------- auto-finish */

/** Backstop only — nextAutoFinishMove halts on its own; this caps any future regression. */
const AUTO_STEP_LIMIT = 400;
let autoSteps = 0;

function startAuto(): void {
  if (autoTimer !== null) {
    stopAuto();
    return;
  }
  autoSteps = 0;
  autoTimer = window.setInterval(() => {
    if (++autoSteps > AUTO_STEP_LIMIT || !store.autoFinishStep() || store.state.won) stopAuto();
  }, 90);
  updateHud();
}

function stopAuto(): void {
  if (autoTimer !== null) clearInterval(autoTimer);
  autoTimer = null;
  updateHud();
}

/* --------------------------------------------------------------- controls */

$('#btnNew').addEventListener('click', () => {
  winShown = false;
  store.newGame();
});
$('#btnRestart').addEventListener('click', () => {
  winShown = false;
  store.restartDeal();
});
$('#btnUndo').addEventListener('click', () => store.undo());
$('#btnAuto').addEventListener('click', startAuto);
$('#btnHint').addEventListener('click', () => {
  const hint = store.hint();
  if (!hint) {
    toast('No moves left — try a new deal.');
    sound.play('reject');
    return;
  }
  board.flashHint(hint.cardId, hint.to);
});

$('#btnSettings').addEventListener('click', () => $<HTMLDialogElement>('#settings').showModal());
$('#btnStats').addEventListener('click', () => {
  renderStats();
  $<HTMLDialogElement>('#statsDialog').showModal();
});
$('#btnResetStats').addEventListener('click', () => {
  store.resetStats();
  renderStats();
  toast('Statistics cleared.');
});
$('#btnWinNew').addEventListener('click', () => {
  $<HTMLDialogElement>('#winDialog').close();
  cascade.stop();
  winShown = false;
  store.newGame();
});
$('#btnWinReplay').addEventListener('click', () => {
  $<HTMLDialogElement>('#winDialog').close();
  cascade.stop();
  winShown = false;
  store.restartDeal();
});

function renderStats(): void {
  const s = store.stats;
  const rate = s.played ? Math.round((s.won / s.played) * 100) : 0;
  const rows: Array<[string, string]> = [
    ['Games played', String(s.played)],
    ['Games won', String(s.won)],
    ['Win rate', `${rate}%`],
    ['Current streak', String(s.streak)],
    ['Best streak', String(s.bestStreak)],
    ['Best time', s.bestTimeMs === null ? '—' : formatTime(s.bestTimeMs)],
    ['Best score', s.bestScore === null ? '—' : String(s.bestScore)],
  ];
  $('#statGrid').innerHTML = rows
    .map(([k, v]) => `<div class="statgrid__row"><span>${k}</span><strong>${v}</strong></div>`)
    .join('');
}

function bindGroup(sel: string, apply: (value: string) => void): void {
  $(sel).addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-value]') as HTMLElement | null;
    if (!btn?.dataset.value) return;
    apply(btn.dataset.value);
  });
}

bindGroup('#optDraw', (v) => store.setPrefs({ draw: v === '1' ? 1 : 3 }));
bindGroup('#optScoring', (v) => store.setPrefs({ scoring: v as Prefs['scoring'] }));
bindGroup('#optTheme', (v) => store.setPrefs({ theme: v }));
bindGroup('#optBack', (v) => store.setPrefs({ cardBack: v }));

const toggles: Array<[string, keyof Prefs]> = [
  ['#optTimed', 'timed'],
  ['#optSound', 'sound'],
  ['#optMotion', 'reducedMotion'],
  ['#optLeft', 'leftHanded'],
];
for (const [sel, key] of toggles) {
  $(sel).addEventListener('click', () => {
    store.setPrefs({ [key]: !store.prefs[key] } as Partial<Prefs>);
    if (key === 'sound' && !store.prefs.sound) return;
    if (key === 'sound') sound.play('place');
  });
}

/* -------------------------------------------------------------- keyboard */

window.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]') && e.key !== 'Escape') return;
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && key === 'z') {
    e.preventDefault();
    store.undo();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  switch (key) {
    case 'n':
      winShown = false;
      store.newGame();
      break;
    case 'u':
      store.undo();
      break;
    case 'h':
      $('#btnHint').click();
      break;
    case 'r':
      winShown = false;
      store.restartDeal();
      break;
    case 'a':
      // Always reachable while running, so the key can stop it too.
      if (autoTimer !== null || store.canAutoFinish()) startAuto();
      break;
    case ' ':
    case 'enter':
      e.preventDefault();
      store.draw();
      break;
  }
});

/* ------------------------------------------------------------- lifecycle */

let resizeRaf = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    board.measure();
    board.render(true);
  });
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) store.pause();
  else store.resume();
});

window.addEventListener('beforeunload', () => store.pause());

/* ------------------------------------------------------------------ boot */

// Handle for the dev console and for scripted UI checks.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__solitaire = { store, board };
}

applyPrefs(store.prefs);
board.buildDeal();
board.measure();
board.render(true);
updateHud();
document.body.classList.add('is-ready');

if (store.state.moves === 0) {
  requestAnimationFrame(() => board.dealAnimation());
}
