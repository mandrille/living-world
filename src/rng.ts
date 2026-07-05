// Seeded RNG (mulberry32) so worlds can be reproduced from a seed.
let state = (Date.now() ^ 0x9e3779b9) >>> 0;

export function setSeed(s: number) {
  state = s >>> 0;
}

/** current generator state, for exact save/resume of a running world */
export function getRngState(): number {
  return state;
}

export function setRngState(s: number) {
  state = s >>> 0;
}

export function rand(): number {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** random integer in [min, max] inclusive */
export function ri(min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

export function rf(min: number, max: number): number {
  return min + rand() * (max - min);
}

export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

export function chance(p: number): boolean {
  return rand() < p;
}

export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
