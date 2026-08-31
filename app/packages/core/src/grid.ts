import type { Grid, Tile } from "./types.js";

function tileIndex(grid: Grid, x: number, y: number): number {
  return y * grid.width + x;
}

export function inBounds(grid: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height;
}

export function tileAt(grid: Grid, x: number, y: number): Tile | undefined {
  if (!inBounds(grid, x, y)) return undefined;
  return grid.tiles[tileIndex(grid, x, y)];
}

export function distH(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.floor(Math.sqrt(dx * dx + dy * dy));
}

export const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export function isCardinal(dx: number, dy: number): boolean {
  return dx === 0 || dy === 0;
}

/** Ориентация после шага P → Q. Документ математики, §2.3. */
export function facingAfterStep(fromX: number, fromY: number, toX: number, toY: number, previous: number): number {
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (dx === 0 && dy === 0) return previous;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax > ay) return dx > 0 ? 1 : 3;
  if (ay > ax) return dy > 0 ? 2 : 0;
  return dx !== 0 ? (dx > 0 ? 1 : 3) : previous;
}

export function makeGrid(width: number, height: number, fillZ = 1): Grid {
  const tiles: Tile[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      tiles.push({ x, y, z: fillZ, pit: false, blockLOS: false });
    }
  }
  return { width, height, tiles };
}
