import { Sim } from './sim';
import { Renderer } from './render';
import { UI } from './ui';
import { setSeed } from './rng';
import { seasonName } from './names';
import { initLang, getLang, setLang, onLangChange, t } from './i18n';
import { loadSnapshot, saveSnapshot } from './store';

// ============================================================
// ONE WORLD. Everyone who opens this page sees the same world,
// computed deterministically from the age's seed and anchored
// to the real clock. Each age lasts seven real days, ends in
// the Judgment, and a new age begins by itself.
//
// Returning visitors resume from a local snapshot and only
// simulate the time since their last visit.
// ============================================================
const BASE_SEED = 20260704;
const WORLD_START = 1783123200000; // 2026-07-04T00:00:00Z — the first dawn of age 1
const TICK_MS = 10_000; // the world takes one step every 10 real seconds
const WEEK_MS = 7 * 24 * 3600 * 1000;
const TOTAL_TICKS = Math.floor(WEEK_MS / TICK_MS); // 60,480 ticks ≈ 151 sim-years per age
const SAVE_EVERY_MS = 3 * 60_000;

// dev override: ?seed=N runs a private sandbox at a gentle fixed pace
const params = new URLSearchParams(location.search);
const devSeed = Number(params.get('seed'));
const SANDBOX = Number.isFinite(devSeed) && devSeed > 0;

const age = SANDBOX ? 0 : Math.max(0, Math.floor((Date.now() - WORLD_START) / WEEK_MS));
const ageStart = WORLD_START + age * WEEK_MS;
const seed = SANDBOX ? devSeed : BASE_SEED + age * 7919;
initLang();
setSeed(seed);

const sim = new Sim();
const canvas = document.getElementById('world') as HTMLCanvasElement;
const renderer = new Renderer(canvas, sim);
const ui = new UI(sim, renderer);

(window as any).sim = sim;
(window as any).ui = ui;
(window as any).renderer = renderer;

const dateEl = document.getElementById('date')!;
const popEl = document.getElementById('pop')!;
const overlay = document.getElementById('overlay')!;
const overlayContent = document.getElementById('overlay-content')!;
const countdownEl = document.getElementById('countdown')!;

let judged = false;
const paused = () => judged;

function updateHud() {
  dateEl.textContent = t('Year {y}, {s} — day {d}', { y: sim.year, s: t(seasonName(sim.season)), d: sim.day });
  popEl.textContent = t('☺ {n} souls · {w} war(s)', { n: sim.livingCount(), w: sim.wars.length });
}

function applyStaticLabels() {
  document.title = t('The Simulation — a living world');
  document.documentElement.lang = getLang();
  for (const btn of document.querySelectorAll<HTMLButtonElement>('#tabs .tab')) {
    const key = btn.dataset.tab!;
    btn.textContent = t(key === 'inspect' ? 'Inspect' : key === 'factions' ? 'Factions' : key === 'legends' ? 'Legends' : 'Chronicle');
  }
  const share = document.getElementById('btn-share')!;
  share.textContent = t('🔗 Share');
  share.title = t('copy the link — same world for everyone');
  document.getElementById('btn-zoom-in')!.title = t('zoom in');
  document.getElementById('btn-zoom-out')!.title = t('zoom out');
  const langBtn = document.getElementById('btn-lang')!;
  langBtn.textContent = getLang() === 'en' ? 'ES' : 'EN'; // shows the language you switch TO
  langBtn.title = t('Language');
  document.getElementById('seed')!.textContent = SANDBOX ? t('sandbox {n}', { n: seed }) : t('age {n}', { n: age + 1 });
}

document.getElementById('btn-zoom-in')!.addEventListener('click', () => renderer.zoomCenter(1.3));
document.getElementById('btn-zoom-out')!.addEventListener('click', () => renderer.zoomCenter(1 / 1.3));
document.getElementById('btn-lang')!.addEventListener('click', () => {
  setLang(getLang() === 'en' ? 'es' : 'en');
});

const flash = (btn: HTMLElement, text: string) => {
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = old; }, 1800);
};

// share: the world is the same for everyone, so the plain link is enough
const shareBtn = document.getElementById('btn-share')!;
shareBtn.addEventListener('click', () => {
  const url = `${location.origin}${location.pathname}`;
  navigator.clipboard.writeText(url).then(
    () => flash(shareBtn, t('✓ link copied')),
    () => flash(shareBtn, url.slice(0, 24) + '…')
  );
});

// ---- render loop (a draw error must never kill it) ----
function frame() {
  try {
    renderer.draw();
  } catch (e) {
    console.error('draw failed:', e);
    renderer.dirty = false;
  }
  requestAnimationFrame(frame);
}
frame();

// refresh the open panel periodically so live data stays current
setInterval(() => {
  if (!paused()) ui.render();
}, 1800);

// the life layer: keep redrawing so smoke drifts and the crowd sways
// (purely cosmetic — the simulation itself only steps on its clock)
setInterval(() => { renderer.dirty = true; }, 120);

// ---- persistence: resume from where this browser last saw the world ----
let saving = false;
let lastSaveAt = 0;

async function persist(force = false) {
  if (SANDBOX || saving) return;
  if (!force && Date.now() - lastSaveAt < SAVE_EVERY_MS) return;
  saving = true;
  try {
    const state = sim.serialize();
    await saveSnapshot({ seed, age, savedAt: Date.now(), state });
    lastSaveAt = Date.now();
  } finally {
    saving = false;
  }
}

onLangChange(() => {
  applyStaticLabels();
  updateHud();
  ui.render();
  renderer.dirty = true;
  if (judged) showJudgment();
  if (!SANDBOX) updateCountdown();
});

// ============================================================
// DEV SANDBOX: gentle fixed pace, no judgment
// ============================================================
if (SANDBOX) {
  countdownEl.style.display = 'none';
  setInterval(() => {
    sim.tick();
    renderer.dirty = true;
    updateHud();
  }, 500);
}

// ============================================================
// THE ONE WORLD
// ============================================================
const expectedTicks = () =>
  Math.max(0, Math.min(TOTAL_TICKS, Math.floor((Date.now() - ageStart) / TICK_MS)));

const updateCountdown = () => {
  const left = ageStart + WEEK_MS - Date.now();
  if (left <= 0) {
    countdownEl.textContent = t('⌛ the Judgment has come');
    return;
  }
  const d = Math.floor(left / 86400000);
  const h = Math.floor((left % 86400000) / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  countdownEl.textContent = t('⌛ the age ends in {d}d {h}h {m}m', { d, h, m });
};

function showJudgment() {
  const ranked = sim.factions
    .map((f) => ({ f, score: sim.factionScore(f) }))
    .sort((a, b) => b.score - a.score);
  const winner = ranked[0];

  let html = `<h1>${t('The Judgment of Age {n}', { n: age + 1 })}</h1>`;
  html += `<p class="winner">${t('☼ {f} claims the age ☼', { f: `${winner.f.symbol} ${winner.f.name}` })}</p>`;
  html += `<table><tr><th></th><th>${t('People')}</th><th>${t('Souls')}</th><th>${t('Stores')}</th><th class="score">${t('Score')}</th></tr>`;
  for (const { f, score } of ranked) {
    const res = Math.floor(f.stock.food + f.stock.wood + f.stock.stone + f.stock.metal);
    html += `<tr>
      <td style="color:${f.color}">${f.symbol}</td>
      <td style="color:${f.color}">${f.name}${f.alive ? '' : ' †'}</td>
      <td>${sim.factionPop(f.id)}</td><td>${f.alive ? res : 0}</td>
      <td class="score">${score}</td></tr>`;
  }
  html += `</table>`;
  html += `<p class="muted">${t('Souls ×10 + stores + knowledge. This world is frozen now; walk it as long as you like.')}</p>`;
  const nextReady = Date.now() >= ageStart + WEEK_MS;
  html += `<button id="btn-close-overlay">${t('Walk the silent world')}</button>`;
  if (nextReady) html += `<button id="btn-next-age">${t('Begin Age {n} ⟶', { n: age + 2 })}</button>`;
  overlayContent.innerHTML = html;
  overlay.classList.remove('hidden');
  document.getElementById('btn-close-overlay')!.addEventListener('click', () => overlay.classList.add('hidden'));
  document.getElementById('btn-next-age')?.addEventListener('click', () => location.reload());
}

const judge = () => {
  if (judged) return;
  judged = true;
  const ranked = sim.factions
    .map((f) => ({ f, score: sim.factionScore(f) }))
    .sort((a, b) => b.score - a.score);
  sim.log('misc', `⚖ The age ends after seven days of the watchers' time. ${ranked[0].f.name} stands above all.`);
  void persist(true);
  showJudgment();
};
(window as any).__judge = judge;

if (!SANDBOX) {
  // catch up to where the world really is, in digestible slices
  const catchUp = (onDone: () => void) => {
    const target = expectedTicks();
    if (sim.tickCount >= target) { onDone(); return; }
    overlayContent.innerHTML = `<h1>${t('The Chronicler Recounts')}</h1>
      <p class="progress" id="catchup-msg">…</p>
      <div class="bar"><div id="catchup-bar"></div></div>`;
    overlay.classList.remove('hidden');
    const msg = document.getElementById('catchup-msg')!;
    const bar = document.getElementById('catchup-bar')!;
    const startTicks = sim.tickCount;
    let sinceSave = 0;
    const step = () => {
      // large slices: hidden tabs throttle timers to one callback per second
      const t0 = performance.now();
      while (sim.tickCount < target && performance.now() - t0 < 150) { sim.tick(); sinceSave++; }
      msg.textContent = t('…the events of Year {y}…', { y: sim.year });
      const frac = (sim.tickCount - startTicks) / Math.max(1, target - startTicks);
      bar.style.width = `${Math.floor(frac * 100)}%`;
      renderer.dirty = true;
      updateHud();
      if (sinceSave >= 10_000) { sinceSave = 0; void persist(true); } // a refresh mid-recount resumes here
      if (sim.tickCount < target) {
        setTimeout(step, 0);
      } else {
        overlay.classList.add('hidden');
        onDone();
      }
    };
    step();
  };

  const boot = async () => {
    // resume from the last snapshot this browser saved of the same age
    const snap = await loadSnapshot();
    if (snap && snap.seed === seed && snap.age === age && snap.state) {
      sim.loadFrom(snap.state); // on any mismatch this returns false and we replay from tick 0
      ui.render();
    }

    catchUp(() => {
      void persist(true);
      updateCountdown();
      if (expectedTicks() >= TOTAL_TICKS) judge();
      const liveStep = () => {
        const target = expectedTicks();
        let n = 0;
        while (sim.tickCount < target && n < 200) { sim.tick(); n++; }
        if (n > 0) renderer.dirty = true;
        updateHud();
        updateCountdown();
        void persist();
        if (target >= TOTAL_TICKS) judge();
      };
      setInterval(liveStep, 1000);
      // coming back to a backgrounded tab: catch up on the spot
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          liveStep();
          renderer.dirty = true;
        } else {
          void persist(true);
        }
      });
    });
  };

  void boot();
}

applyStaticLabels();
updateHud();
