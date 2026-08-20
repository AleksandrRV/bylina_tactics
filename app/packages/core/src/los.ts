import { tileAt } from "./grid.js";
import type { Grid } from "./types.js";

interface Cell {
  x: number;
  y: number;
}

/**
 * Клетки, внутренность которых пересекает отрезок центров.
 * При проходе через узел сетки посещаются обе смежные клетки (суперпокрытие).
 */
export function supercover(ax: number, ay: number, bx: number, by: number): Cell[] {
  const x0 = ax + 0.5;
  const y0 = ay + 0.5;
  const x1 = bx + 0.5;
  const y1 = by + 0.5;
  const cells: Cell[] = [];
  let ix = Math.floor(x0);
  let iy = Math.floor(y0);
  const ixe = Math.floor(x1);
  const iye = Math.floor(y1);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const tdx = stepX === 0 ? Number.POSITIVE_INFINITY : 1 / Math.abs(dx);
  const tdy = stepY === 0 ? Number.POSITIVE_INFINITY : 1 / Math.abs(dy);
  let tmaxX =
    stepX === 0
      ? Number.POSITIVE_INFINITY
      : (stepX > 0 ? ix + 1 - x0 : x0 - ix) * tdx;
  let tmaxY =
    stepY === 0
      ? Number.POSITIVE_INFINITY
      : (stepY > 0 ? iy + 1 - y0 : y0 - iy) * tdy;

  const seen = new Set<string>();
  const push = (x: number, y: number): void => {
    const key = `${x},${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    cells.push({ x, y });
  };

  push(ix, iy);
  let guard = 0;
  while ((ix !== ixe || iy !== iye) && guard < 512) {
    guard += 1;
    if (tmaxX < tmaxY - 1e-12) {
      ix += stepX;
      tmaxX += tdx;
      push(ix, iy);
    } else if (tmaxY < tmaxX - 1e-12) {
      iy += stepY;
      tmaxY += tdy;
      push(ix, iy);
    } else {
      push(ix + stepX, iy);
      push(ix, iy + stepY);
      ix += stepX;
      iy += stepY;
      tmaxX += tdx;
      tmaxY += tdy;
      push(ix, iy);
    }
  }
  return cells;
}

function rayZ(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  cx: number,
  cy: number,
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 1e-12) {
    t = ((cx + 0.5 - x0) * dx + (cy + 0.5 - y0) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
  }
  return z0 + t * (z1 - z0);
}

/** Документ математики, §7. Укрытия и юниты луч не прерывают. */
export function hasLineOfSight(
  grid: Grid,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): boolean {
  if (ax === bx && ay === by) return true;
  const cells = supercover(ax, ay, bx, by);
  const x0 = ax + 0.5;
  const y0 = ay + 0.5;
  const z0 = az + 0.5;
  const x1 = bx + 0.5;
  const y1 = by + 0.5;
  const z1 = bz + 0.5;
  for (const cell of cells) {
    if ((cell.x === ax && cell.y === ay) || (cell.x === bx && cell.y === by)) continue;
    const tile = tileAt(grid, cell.x, cell.y);
    if (!tile) return false;
    if (tile.blockLOS) return false;
    const rz = rayZ(x0, y0, z0, x1, y1, z1, cell.x, cell.y);
    if (rz < tile.z) return false;
  }
  return true;
}
