// Verification harness (run: npm run verify)
//
// 1. determinism — same seed, same tick count ⇒ byte-identical world
// 2. snapshot    — serialize mid-run, resume, ⇒ identical to a straight run
// 3. i18n        — every string the world generated translates to Spanish
//
// Math.random is poisoned for the duration of the sim runs: the shared
// world must draw exclusively from the seeded generator.
import { setSeed } from '../src/rng';
import { setNextAgentId } from '../src/agents';
import { Sim } from '../src/sim';
import { setLang, tr } from '../src/i18n';
import { itemLabel } from '../src/items';

const TICKS = Number(process.env.TICKS ?? 24000); // ≈ 60 sim-years

const realRandom = Math.random;
Math.random = () => {
  throw new Error('Math.random() called inside the simulation!');
};

function freshWorld(seed: number): Sim {
  setNextAgentId(1);
  setSeed(seed);
  return new Sim();
}

// ---- 1. determinism ----
const a = freshWorld(123);
for (let i = 0; i < TICKS; i++) a.tick();
const b = freshWorld(123);
for (let i = 0; i < TICKS; i++) b.tick();
if (a.serialize() !== b.serialize()) {
  console.error('FAIL: same seed produced different worlds');
  process.exit(1);
}
console.log(`PASS determinism: two runs of the same seed are byte-identical after ${TICKS} ticks`);

// ---- 2. snapshot resume ----
const c = freshWorld(456);
for (let i = 0; i < TICKS / 2; i++) c.tick();
const snap = c.serialize();
for (let i = 0; i < TICKS / 2; i++) c.tick();
const straight = c.serialize();

const d = freshWorld(456); // boot generates a fresh world, then the snapshot replaces it
if (!d.loadFrom(snap)) {
  console.error('FAIL: snapshot did not load');
  process.exit(1);
}
for (let i = 0; i < TICKS / 2; i++) d.tick();
if (d.serialize() !== straight) {
  console.error('FAIL: resumed world drifted from the straight run');
  process.exit(1);
}
console.log('PASS snapshot: resuming mid-run matches the straight run exactly');
console.log(`     snapshot size at ${TICKS} ticks: ${(straight.length / 1024 / 1024).toFixed(2)} MB`);

Math.random = realRandom;

// ---- 3. i18n coverage over everything the world generated ----
setLang('es');
const corpus = new Map<string, string>(); // text -> source kind
const add = (txt: string | null | undefined, src: string) => {
  if (txt) corpus.set(txt, src);
};
for (const e of a.chronicle) add(e.text, 'chronicle');
for (const ag of a.agents) {
  for (const h of ag.history) add(h.text, 'history');
  add(ag.deathCause, 'deathCause');
  add(ag.appearance, 'appearance');
  add(ag.belief, 'belief');
  for (const p of ag.personality) add(p, 'personality');
  for (const bp of ag.body) {
    add(bp.name, 'bodypart');
    for (const w of bp.wounds) add(w, 'wound');
  }
  for (const it of ag.equipment) {
    add(itemLabel(it), 'itemLabel');
    add(it.story, 'itemStory');
  }
  for (const m of ag.mutations) {
    add(m.name, 'mutationName');
    add(m.desc, 'mutationDesc');
  }
  if (ag.disease) add(ag.disease.name, 'disease');
}
for (const f of a.factions) {
  add(f.myth, 'myth');
  add(f.ethos, 'ethos');
  add(f.government, 'government');
  add(f.leaderTitle, 'leaderTitle');
  for (const tech of f.research.done) add(tech, 'tech');
}
for (const bld of a.buildings) add(bld.name, 'buildingName');
for (const w of a.wars) add(w.name, 'warName');

// untranslated = the OUTPUT still contains English function words — this
// also catches nested fragments that a matching outer rule passed through
// untranslated (lines of pure proper nouns are fine)
const englishTell = /\b(the|of|and|was|their|from|with|has|is|in a|to the|who|by)\b/;
let ok = 0;
const misses: [string, string][] = [];
for (const [txt, src] of corpus) {
  const out = tr(txt);
  if (!englishTell.test(out)) ok++;
  else misses.push([src, `${txt}  →  ${out}`]);
}
const pct = ((ok / corpus.size) * 100).toFixed(2);
console.log(`i18n coverage: ${ok}/${corpus.size} distinct strings translated (${pct}%)`);
if (misses.length) {
  console.log('--- untranslated ---');
  for (const [src, txt] of misses.slice(0, 50)) console.log(`[${src}] ${txt}`);
  process.exit(1);
}
console.log('PASS i18n: full coverage of the generated corpus');
