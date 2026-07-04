import { Sim } from './sim';
import { Renderer } from './render';
import { UI } from './ui';
import { setSeed } from './rng';
import { Faction } from './types';

// ---- world parameters from the URL ----
// local sandbox:   ?seed=12345
// shared 7-day world: ?world=12345&start=1730000000000  (same link = same world for everyone)
const params = new URLSearchParams(location.search);
const sharedSeed = Number(params.get('world'));
const sharedStart = Number(params.get('start'));
const SHARED = Number.isFinite(sharedSeed) && sharedSeed > 0 && Number.isFinite(sharedStart) && sharedStart > 0;

const TICK_MS = 20_000; // one shared-world tick per 20 real seconds
const WEEK_MS = 7 * 24 * 3600 * 1000;
const TOTAL_TICKS = Math.floor(WEEK_MS / TICK_MS); // 30,240 ticks ≈ 75 sim-years

let seed: number;
if (SHARED) {
  seed = sharedSeed;
} else {
  seed = Number(params.get('seed'));
  if (!Number.isFinite(seed) || seed <= 0) {
    seed = 1 + Math.floor(Math.random() * 2147483646);
  }
}
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

function updateHud() {
  dateEl.textContent = sim.dateString();
  popEl.textContent = `☺ ${sim.livingCount()} souls · ${sim.wars.length} war(s)`;
}

document.getElementById('btn-zoom-in')!.addEventListener('click', () => renderer.zoomCenter(1.3));
document.getElementById('btn-zoom-out')!.addEventListener('click', () => renderer.zoomCenter(1 / 1.3));
document.getElementById('seed')!.textContent = SHARED ? `world ${seed}` : `seed ${seed}`;
document.getElementById('btn-new')!.addEventListener('click', () => {
  const s = 1 + Math.floor(Math.random() * 2147483646);
  location.search = SHARED ? `?world=${s}&start=${Date.now()}` : `?seed=${s}`;
});

const flash = (btn: HTMLElement, text: string) => {
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = old; }, 1800);
};

// ---- sharing: hand the same world to someone else ----
const shareBtn = document.getElementById('btn-share')!;
shareBtn.addEventListener('click', () => {
  const url = SHARED
    ? location.href
    : `${location.origin}${location.pathname}?world=${seed}&start=${Date.now()}`;
  navigator.clipboard.writeText(url).then(
    () => flash(shareBtn, SHARED ? '✓ link copied' : '✓ 7-day world link copied'),
    () => flash(shareBtn, url.slice(0, 24) + '…') // clipboard blocked: at least show it
  );
});

// ---- save/load: local sandbox only ----
const SAVE_KEY = 'simulation-save';
const saveBtn = document.getElementById('btn-save')!;
const loadBtn = document.getElementById('btn-load')!;
if (SHARED) {
  saveBtn.style.display = 'none';
  loadBtn.style.display = 'none';
} else {
  saveBtn.addEventListener('click', () => {
    try {
      localStorage.setItem(SAVE_KEY, sim.serialize());
      flash(saveBtn, '✓ saved');
    } catch {
      flash(saveBtn, '✗ too large');
    }
  });
  loadBtn.addEventListener('click', () => {
    const data = localStorage.getItem(SAVE_KEY);
    if (!data || !sim.loadFrom(data)) {
      flash(loadBtn, '✗ no save');
      return;
    }
    renderer.dirty = true;
    ui.render();
    flash(loadBtn, '✓ loaded');
  });
}

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
// LOCAL SANDBOX MODE
// ============================================================
let speed = 1;
let judged = false;

function paused(): boolean {
  return SHARED ? judged : speed === 0;
}

if (!SHARED) {
  countdownEl.style.display = 'none';
  const speedButtons: Record<string, number> = {
    'btn-pause': 0, 'btn-1x': 1, 'btn-3x': 3, 'btn-10x': 10,
  };
  for (const [id, s] of Object.entries(speedButtons)) {
    document.getElementById(id)!.addEventListener('click', () => {
      speed = s;
      for (const other of Object.keys(speedButtons)) {
        document.getElementById(other)!.classList.toggle('active', other === id);
      }
    });
  }
  setInterval(() => {
    if (speed > 0) {
      for (let i = 0; i < speed; i++) sim.tick();
      renderer.dirty = true;
    }
    updateHud();
  }, 100);
}

// ============================================================
// SHARED WEEK-WORLD MODE
// ============================================================
if (SHARED) {
  // the pace is the world's, not ours
  for (const id of ['btn-pause', 'btn-1x', 'btn-3x', 'btn-10x']) {
    document.getElementById(id)!.style.display = 'none';
  }
  countdownEl.style.display = '';

  const expectedTicks = () =>
    Math.max(0, Math.min(TOTAL_TICKS, Math.floor((Date.now() - sharedStart) / TICK_MS)));

  const updateCountdown = () => {
    const left = sharedStart + WEEK_MS - Date.now();
    if (left <= 0) {
      countdownEl.textContent = '⌛ the Judgment has come';
      return;
    }
    const d = Math.floor(left / 86400000);
    const h = Math.floor((left % 86400000) / 3600000);
    const m = Math.floor((left % 3600000) / 60000);
    countdownEl.textContent = `⌛ Judgment in ${d}d ${h}h ${m}m`;
  };

  const judge = () => {
    if (judged) return;
    judged = true;
    const ranked = sim.factions
      .map((f) => ({ f, score: sim.factionScore(f) }))
      .sort((a, b) => b.score - a.score);
    const winner = ranked[0];

    sim.log('misc', `⚖ The Age ends after seven days of the watchers' time. ${winner.f.name} stands above all.`);

    let html = `<h1>The Judgment</h1>`;
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
    html += `<p class="muted">Souls ×10 + stores + knowledge. The world is frozen now; walk it as long as you like.</p>`;
    html += `<button id="btn-close-overlay">Walk the silent world</button>`;
    overlayContent.innerHTML = html;
    overlay.classList.remove('hidden');
    document.getElementById('btn-close-overlay')!.addEventListener('click', () => overlay.classList.add('hidden'));
  };

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
      // large slices: hidden tabs throttle timers to one callback per second,
      // so each slice must carry real weight
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

  (window as any).__judge = judge; // for testing the verdict screen

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
