import { Tile, TerrainType } from './types';
import { ri, chance, pick } from './rng';

export const W = 120;
export const H = 80;

export function makeWorld(): Tile[] {
  const tiles: Tile[] = new Array(W * H);
  for (let i = 0; i < tiles.length; i++) {
    tiles[i] = { terrain: 'grass', amount: 0, buildingId: null };
  }

  // Grow organic blobs of terrain via random walks.
  const blob = (terrain: TerrainType, seeds: number, steps: number, amount: number) => {
    for (let s = 0; s < seeds; s++) {
      let x = ri(2, W - 3);
      let y = ri(2, H - 3);
      for (let k = 0; k < steps; k++) {
        const t = tiles[y * W + x];
        if (t.terrain === 'grass') {
          t.terrain = terrain;
          t.amount = amount + ri(0, amount);
        }
        x = Math.max(1, Math.min(W - 2, x + ri(-1, 1)));
        y = Math.max(1, Math.min(H - 2, y + ri(-1, 1)));
      }
    }
  };

  blob('water', 6, 220, 0);
  blob('mountain', 7, 180, 60);
  blob('forest', 16, 120, 25);
  // Ore veins hug the mountains: convert some mountain tiles.
  let veins = 0;
  for (let tries = 0; tries < 4000 && veins < 90; tries++) {
    const x = ri(1, W - 2), y = ri(1, H - 2);
    const t = tiles[y * W + x];
    if (t.terrain === 'mountain' && chance(0.25)) {
      t.terrain = 'ore';
      t.amount = 20 + ri(0, 20);
      veins++;
    }
  }
  return tiles;
}

export function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < W && y < H;
}

export function tileAt(tiles: Tile[], x: number, y: number): Tile {
  return tiles[y * W + x];
}

export function passable(tiles: Tile[], x: number, y: number): boolean {
  if (!inBounds(x, y)) return false;
  const t = tiles[y * W + x].terrain;
  return t !== 'water';
}

/** Find nearest tile matching predicate within maxDist (chebyshev). Returns null if none. */
export function findNearestTile(
  tiles: Tile[], fromX: number, fromY: number, maxDist: number,
  match: (t: Tile, x: number, y: number) => boolean
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  const x0 = Math.max(0, fromX - maxDist), x1 = Math.min(W - 1, fromX + maxDist);
  const y0 = Math.max(0, fromY - maxDist), y1 = Math.min(H - 1, fromY + maxDist);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const t = tiles[y * W + x];
      if (!match(t, x, y)) continue;
      const d = Math.abs(x - fromX) + Math.abs(y - fromY);
      if (d < bestD) { bestD = d; best = { x, y }; }
    }
  }
  return best;
}

/** A free, passable, building-less grass tile near (x,y). */
export function findFreeSpotNear(tiles: Tile[], x: number, y: number, maxDist: number): { x: number; y: number } | null {
  return findNearestTile(tiles, x, y, maxDist, (t) =>
    t.buildingId === null && (t.terrain === 'grass' || t.terrain === 'farmland')
  );
}
