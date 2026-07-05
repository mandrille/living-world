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

/**
 * Find nearest tile matching predicate within maxDist (manhattan).
 * Searches ring by ring and stops at the first hit, so the common case
 * (a resource a few tiles away) costs ~dozens of checks instead of a
 * full (2·maxDist+1)² scan — this dominates catch-up speed.
 * Returns null if none.
 */
export function findNearestTile(
  tiles: Tile[], fromX: number, fromY: number, maxDist: number,
  match: (t: Tile, x: number, y: number) => boolean
): { x: number; y: number } | null {
  for (let r = 0; r <= maxDist; r++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = fromX + dx;
      if (x < 0 || x >= W) continue;
      const ry = r - Math.abs(dx);
      const yA = fromY - ry;
      if (yA >= 0 && yA < H && match(tiles[yA * W + x], x, yA)) return { x, y: yA };
      if (ry > 0) {
        const yB = fromY + ry;
        if (yB >= 0 && yB < H && match(tiles[yB * W + x], x, yB)) return { x, y: yB };
      }
    }
  }
  return null;
}

/** A free, passable, building-less grass tile near (x,y). */
export function findFreeSpotNear(tiles: Tile[], x: number, y: number, maxDist: number): { x: number; y: number } | null {
  return findNearestTile(tiles, x, y, maxDist, (t) =>
    t.buildingId === null && (t.terrain === 'grass' || t.terrain === 'farmland')
  );
}
