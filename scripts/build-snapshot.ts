// Compute the one world up to "now" and write snapshot.json.
// Run headless (npx tsx scripts/build-snapshot.ts [outfile]) — the hourly
// GitHub Action publishes the result next to the site on gh-pages, so
// first-time visitors download the current world instead of replaying the
// whole age. The page and this script share src/config.ts, and the sim is
// fully seeded, so this Node-computed world is the same one every browser
// would compute for itself.
import { writeFileSync } from 'fs';
import { setSeed } from '../src/rng';
import { Sim } from '../src/sim';
import { ageAt, seedOf, expectedTicksAt } from '../src/config';

const out = process.argv[2] ?? 'snapshot.json';
const now = Date.now();
const age = ageAt(now);
const seed = seedOf(age);
const target = expectedTicksAt(now, age);

setSeed(seed);
const sim = new Sim();
const t0 = Date.now();
while (sim.tickCount < target) sim.tick();

const state = sim.serialize();
writeFileSync(out, JSON.stringify({
  v: 1,
  seed,
  age,
  savedAt: now,
  tickCount: sim.tickCount,
  state,
}));

console.log(
  `age ${age + 1}, seed ${seed}: simulated ${target} ticks (Year ${sim.year}, ${sim.livingCount()} souls) ` +
  `in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${out} (${(state.length / 1e6).toFixed(1)} MB)`
);
