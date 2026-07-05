// The world clock. Shared by the page (src/main.ts) and the headless
// snapshot generator (scripts/build-snapshot.ts) — they must agree on
// every value or visitors and the published snapshot would live in
// different worlds.
export const BASE_SEED = 20260704;
export const WORLD_START = 1783123200000; // 2026-07-04T00:00:00Z — the first dawn of age 1
export const TICK_MS = 10_000; // the world takes one step every 10 real seconds
export const WEEK_MS = 7 * 24 * 3600 * 1000;
export const TOTAL_TICKS = Math.floor(WEEK_MS / TICK_MS); // 60,480 ticks ≈ 151 sim-years per age

export function ageAt(now: number): number {
  return Math.max(0, Math.floor((now - WORLD_START) / WEEK_MS));
}

export function ageStartOf(age: number): number {
  return WORLD_START + age * WEEK_MS;
}

export function seedOf(age: number): number {
  return BASE_SEED + age * 7919;
}

export function expectedTicksAt(now: number, age: number): number {
  return Math.max(0, Math.min(TOTAL_TICKS, Math.floor((now - ageStartOf(age)) / TICK_MS)));
}
