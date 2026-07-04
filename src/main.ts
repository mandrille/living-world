import { Sim } from './sim';
import { Renderer } from './render';
import { UI } from './ui';
import { setSeed } from './rng';

// ============================================================
// ONE WORLD. Everyone who opens this page sees the same world,
// computed deterministically from the age's seed and anchored
// to the real clock. Each age lasts seven real days, ends in
// the Judgment, and a new age begins by itself.
// ============================================================
const BASE_SEED = 20260704;
const WORLD_START = 1783123200000; // 2026-07-04T00:00:00Z — the first dawn of age 1
const TICK_MS = 20_000; // the world takes one step every 20 real seconds
const WEEK_MS = 7 * 24 * 3600 * 1000;
const TOTAL_TICKS = Math.floor(WEEK_MS / TICK_MS); // 30,240 ticks ≈ 75 sim-years per age

// dev override: ?seed=N runs a private sandbox at a gentle fixed pace
const params = new URLSearchParams(location.search);
const devSeed = Number(params.get('seed'));
const SANDBOX = Number.isFinite(devSeed) && devSeed > 0;

const age = SANDBOX ? 0 : Math.max(0, Math.floor((Date.now() - WORLD_START) / WEEK_MS));
const ageStart = WORLD_START + age * WEEK_MS;
const seed = SANDBOX ? devSeed : BASE_SEED + age * 7919;
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
  dateEl.textContent = sim.dateString();
  popEl.textContent = `☺ ${sim.livingCount()} souls · ${sim.wars.length} war(s)`;
}

document.getElementById('btn-zoom-in')!.addEventListener('click', () => renderer.zoomCenter(1.3));
document.getElementById('btn-zoom-out')!.addEventListener('click', () => renderer.zoomCenter(1 / 1.3));
document.getElementById('seed')!.textContent = SANDBOX ? `sandbox ${seed}` : `age ${age + 1}`;

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
    () => flash(shareBtn, '✓ link copied'),
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
if (!SANDBOX) {
  const expectedTicks = () =>
    Math.max(0, Math.min(TOTAL_TICKS, Math.floor((Date.now() - ageStart) / TICK_MS)));

  const updateCountdown = () => {
    const left = ageStart + WEEK_MS - Date.now();
    if (left <= 0) {
      countdownEl.textContent = '⌛ the Judgment has come';
      return;
    }
    const d = Math.floor(left / 86400000);
    const h = Math.floor((left % 86400000) / 3600000);
    const m = Math.floor((left % 3600000) / 60000);
    countdownEl.textContent = `⌛ the age ends in ${d}d ${h}h ${m}m`;
  };

  const judge = () => {
    if (judged) return;
    judged = true;
    const ranked = sim.factions
      .map((f) => ({ f, score: sim.factionScore(f) }))
      .sort((a, b) => b.score - a.score);
    const winner = ranked[0];

    sim.log('misc', `⚖ The age ends after seven days of the watchers' time. ${winner.f.name} stands above all.`);

    let html = `<h1>The Judgment of Age ${age + 1}</h1>`;
    html += `<p class="winner">☼ ${winner.f.symbol} ${winner.f.name} claims the age ☼</p>`;
    html += `<table><tr><th></th><th>People</th><th>Souls</th><th>Stores</th><th class="score">Score</th></tr>`;
    for (const { f, score } of ranked) {
      const res = Math.floor(f.stock.food + f.stock.wood + f.stock.stone + f.stock.metal);
      html += `<tr>
        <td style="color:${f.color}">${f.symbol}</td>
        <td style="color:${f.color}">${f.name}${f.alive ? '' : ' †'}</td>
        <td>${sim.factionPop(f.id)}</td><td>${f.alive ? res : 0}</td>
        <td class="score">${score}</td></tr>`;
    }
    html += `</table>`;
    html += `<p class="muted">Souls ×10 + stores + knowledge. This world is frozen now; walk it as long as you like.</p>`;
    const nextReady = Date.now() >= ageStart + WEEK_MS;
    html += `<button id="btn-close-overlay">Walk the silent world</button>`;
    if (nextReady) html += `<button id="btn-next-age">Begin Age ${age + 2} ⟶</button>`;
    overlayContent.innerHTML = html;
    overlay.classList.remove('hidden');
    document.getElementById('btn-close-overlay')!.addEventListener('click', () => overlay.classList.add('hidden'));
    document.getElementById('btn-next-age')?.addEventListener('click', () => location.reload());
  };
  (window as any).__judge = judge;

  // catch up to where the world really is, in digestible slices
  const catchUp = (onDone: () => void) => {
    const target = expectedTicks();
    if (sim.tickCount >= target) { onDone(); return; }
    overlayContent.innerHTML = `<h1>The Chronicler Recounts</h1>
      <p class="progress" id="catchup-msg">…</p>
      <div class="bar"><div id="catchup-bar"></div></div>`;
    overlay.classList.remove('hidden');
    const msg = document.getElementById('catchup-msg')!;
    const bar = document.getElementById('catchup-bar')!;
    const step = () => {
      // large slices: hidden tabs throttle timers to one callback per second
      const t0 = performance.now();
      while (sim.tickCount < target && performance.now() - t0 < 150) sim.tick();
      msg.textContent = `…the events of Year ${sim.year}…`;
      bar.style.width = `${Math.floor((sim.tickCount / target) * 100)}%`;
      renderer.dirty = true;
      updateHud();
      if (sim.tickCount < target) {
        setTimeout(step, 0);
      } else {
        overlay.classList.add('hidden');
        onDone();
      }
    };
    step();
  };

  catchUp(() => {
    updateCountdown();
    if (expectedTicks() >= TOTAL_TICKS) judge();
    setInterval(() => {
      const target = expectedTicks();
      let n = 0;
      while (sim.tickCount < target && n < 200) { sim.tick(); n++; }
      if (n > 0) renderer.dirty = true;
      updateHud();
      updateCountdown();
      if (target >= TOTAL_TICKS) judge();
    }, 1000);
  });
}

updateHud();
