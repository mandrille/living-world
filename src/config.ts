// The world clock. Shared by the page (src/main.ts) and the headless
// snapshot generator (scripts/build-snapshot.ts) — they must agree on
// every value or visitors and the published snapshot would live in
// different worlds.
export const BASE_SEED = 20260704;
export const WORLD_START = 1783123200000; // 2026-07-04T00:00:00Z — the first dawn of age 1
export const WEEK_MS = 7 * 24 * 3600 * 1000;

// The world's heartbeat, as a list of speed epochs. Changing the pace this
// way never rewinds or fast-forwards a running age — history up to the
// cutover keeps its old tick count, and time simply flows faster after.
const SPEED_EPOCHS: { from: number; tickMs: number }[] = [
  { from: WORLD_START, tickMs: 10_000 },
  { from: 1783288800000 /* 2026-07-05T22:00:00Z */, tickMs: 500 }, // two steps per second
];

/** the current heartbeat (ms of real time per world step) */
export const TICK_MS = SPEED_EPOCHS[SPEED_EPOCHS.length - 1].tickMs;

export function ageAt(now: number): number {
  return Math.max(0, Math.floor((now - WORLD_START) / WEEK_MS));
}

export function ageStartOf(age: number): number {
  return WORLD_START + age * WEEK_MS;
}

export function seedOf(age: number): number {
  return BASE_SEED + age * 7919;
}

function ticksBetween(a: number, b: number): number {
  let ticks = 0;
  for (let i = 0; i < SPEED_EPOCHS.length; i++) {
    const start = Math.max(a, SPEED_EPOCHS[i].from);
    const end = Math.min(b, SPEED_EPOCHS[i + 1]?.from ?? Infinity);
    if (end > start) ticks += Math.floor((end - start) / SPEED_EPOCHS[i].tickMs);
  }
  return ticks;
}

/** how many ticks the given age spans in total (varies if a speed change falls inside it) */
export function totalTicksOf(age: number): number {
  return ticksBetween(ageStartOf(age), ageStartOf(age) + WEEK_MS);
}

export function expectedTicksAt(now: number, age: number): number {
  return Math.max(0, Math.min(totalTicksOf(age), ticksBetween(ageStartOf(age), now)));
}
