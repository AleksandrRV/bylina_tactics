import { tileAt } from "./grid.js";
import type { EntityState, Grid } from "./types.js";

interface Cell {
  x: number;
  y: number;
}

export type IntersectionType = "full" | "glancing";

export interface TracedCell extends Cell {
  type: IntersectionType;
  /** Вершина решётки, которой касается луч; заполнено для glancing-клеток. */
  corner?: { x: number; y: number };
}

export function traceRay(ax: number, ay: number, bx: number, by: number): TracedCell[] {
  const x0 = ax + 0.5;
  const y0 = ay + 0.5;
  const x1 = bx + 0.5;
  const y1 = by + 0.5;
  const cells: TracedCell[] = [];
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
  let tmaxX = stepX === 0 ? Number.POSITIVE_INFINITY : (stepX > 0 ? ix + 1 - x0 : x0 - ix) * tdx;
  let tmaxY = stepY === 0 ? Number.POSITIVE_INFINITY : (stepY > 0 ? iy + 1 - y0 : y0 - iy) * tdy;

  const seen = new Set<string>();
  const push = (x: number, y: number, type: IntersectionType, corner?: { x: number; y: number }): void => {
    const key = `${x},${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    cells.push(corner ? { x, y, type, corner } : { x, y, type });
  };

  push(ix, iy, "full");
  let guard = 0;
  while ((ix !== ixe || iy !== iye) && guard < 512) {
    guard += 1;
    if (tmaxX < tmaxY - 1e-12) {
      ix += stepX;
      tmaxX += tdx;
      push(ix, iy, "full");
    } else if (tmaxY < tmaxX - 1e-12) {
      iy += stepY;
      tmaxY += tdy;
      push(ix, iy, "full");
    } else {
      // Пересечение вершины: обе касающиеся клетки принадлежат одной вершине (§7.4).
      const corner = {
        x: ix + (stepX > 0 ? 1 : 0),
        y: iy + (stepY > 0 ? 1 : 0),
      };
      push(ix + stepX, iy, "glancing", corner);
      push(ix, iy + stepY, "glancing", corner);
      ix += stepX;
      iy += stepY;
      tmaxX += tdx;
      tmaxY += tdy;
      push(ix, iy, "full");
    }
  }
  return cells;
}

export function supercover(ax: number, ay: number, bx: number, by: number): Cell[] {
  return traceRay(ax, ay, bx, by);
}

function rayZ(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, cx: number, cy: number): number {
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

function isAnyCover(entity: EntityState): boolean {
  return entity.coverType > 0;
}

function sgnDir(value: number): number {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}

export interface ObstacleResult {
  blocked: boolean;
  obstaclePenalty: number;
  breakCell: { x: number; y: number; z: number } | null;
}

export function evaluateObstacles(
  grid: Grid,
  entities: readonly EntityState[],
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): ObstacleResult {
  if (ax === bx && ay === by) return { blocked: false, obstaclePenalty: 0, breakCell: null };

  const traced = traceRay(ax, ay, bx, by);
  const x0 = ax + 0.5,
    y0 = ay + 0.5,
    z0 = az + 0.5;
  const x1 = bx + 0.5,
    y1 = by + 0.5,
    z1 = bz + 0.5;

  let blocked = false;
  let maxPenalty = 0;
  let breakCell: { x: number; y: number; z: number } | null = null;

  // §7.4: линию прерывает только пара glancing-касаний в одной вершине.
  const glancingByCorner = new Map<string, { x: number; y: number; count: number }>();
  let glancingCount = 0;

  for (const cell of traced) {
    if ((cell.x === ax && cell.y === ay) || (cell.x === bx && cell.y === by)) continue;

    const tile = tileAt(grid, cell.x, cell.y);
    if (!tile) {
      blocked = true;
      breakCell = { x: cell.x, y: cell.y, z: 0 };
      break;
    }

    const rz = rayZ(x0, y0, z0, x1, y1, z1, cell.x, cell.y);
    if (rz < tile.z) {
      const heightDiff = tile.z - rz;
      if (heightDiff > 1.01) {
        blocked = true;
        breakCell = { x: cell.x, y: cell.y, z: tile.z };
        break;
      } else {
        let tier = tile.z - az >= 2 ? 2 : tile.z - az >= 1 ? 1 : 0;
        if (cell.type === "glancing") tier = Math.max(0, tier - 1);
        maxPenalty = Math.max(maxPenalty, tier === 2 ? 50 : tier === 1 ? 25 : 0);
      }
    }

    if (tile.blockLOS) {
      if (cell.type === "full") {
        blocked = true;
        breakCell = { x: cell.x, y: cell.y, z: tile.z };
        break;
      }
      glancingCount += 1;
      const corner = cell.corner;
      if (corner) {
        const key = `${corner.x},${corner.y}`;
        const entry = glancingByCorner.get(key);
        if (entry) entry.count += 1;
        else glancingByCorner.set(key, { x: corner.x, y: corner.y, count: 1 });
      }
    }
  }

  if (!blocked) {
    for (const entry of glancingByCorner.values()) {
      if (entry.count >= 2) {
        blocked = true;
        breakCell = { x: entry.x, y: entry.y, z: 0 };
        break;
      }
    }
    if (!blocked) {
      if (glancingCount > 0) maxPenalty = Math.max(maxPenalty, 50);
    }
  }

  return { blocked, obstaclePenalty: maxPenalty, breakCell };
}

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
  const traced = traceRay(ax, ay, bx, by);
  const x0 = ax + 0.5,
    y0 = ay + 0.5,
    z0 = az + 0.5;
  const x1 = bx + 0.5,
    y1 = by + 0.5,
    z1 = bz + 0.5;

  // §7.4: линию прерывает только пара glancing-касаний в одной вершине.
  const glancingByCorner = new Map<string, number>();

  for (const cell of traced) {
    if ((cell.x === ax && cell.y === ay) || (cell.x === bx && cell.y === by)) continue;
    const tile = tileAt(grid, cell.x, cell.y);
    if (!tile) return false;

    const rz = rayZ(x0, y0, z0, x1, y1, z1, cell.x, cell.y);
    if (tile.z - rz > 1.01) return false;

    if (tile.blockLOS) {
      if (cell.type === "full") return false;
      const corner = cell.corner;
      if (corner) {
        const key = `${corner.x},${corner.y}`;
        glancingByCorner.set(key, (glancingByCorner.get(key) ?? 0) + 1);
      }
    }
  }

  for (const count of glancingByCorner.values()) {
    if (count >= 2) return false;
  }

  return true;
}

/**
 * Эффективная ступень укрытия с учётом высоты атакующего и защищающегося.
 *
 * Правила:
 * 1. Стена (blockLOS) всегда полное укрытие (2).
 * 2. Со стороны защищающегося: если укрытие ниже защищающегося на 1 → полу; на 2+ → игнор.
 * 3. Со стороны атакующего: если атакующий выше укрытия на 1 → полное→полу, полу→игнор; на 2+ → игнор.
 * 4. Итог: минимум из двух перспектив.
 */
export function effectiveCoverTier(
  coverType: 0 | 1 | 2,
  isWall: boolean,
  attackerZ: number,
  defenderZ: number,
  coverZ: number,
): 0 | 1 | 2 {
  if (coverType === 0 && !isWall) return 0;
  if (isWall) return 2;

  // Перспектива защищающегося: укрытие ниже защищающегося менее эффективно.
  let defenderTier = coverType;
  const defDiff = defenderZ - coverZ;
  if (defDiff >= 2) defenderTier = 0;
  else if (defDiff === 1) defenderTier = coverType === 2 ? 1 : 0;

  // Перспектива атакующего: атакующий выше укрытия видит поверх него.
  let attackerTier = coverType;
  const atkDiff = attackerZ - coverZ;
  if (atkDiff >= 2) attackerTier = 0;
  else if (atkDiff === 1) attackerTier = coverType === 2 ? 1 : 0;

  return Math.min(defenderTier, attackerTier) as 0 | 1 | 2;
}

/**
 * Перепад высот как укрытие. Возвышение между атакующим и защищающимся:
 * - Высота +1 над атакующим → полуукрытие (1).
 * - Высота +2 над атакующим → полное укрытие (2).
 * Учитывается только если возвышение на линии огня и поверхность
 * действительно поднимается над лучом (0 < h ≤ 1, §7.2).
 */
export function terrainCoverTier(
  grid: Grid,
  attackerX: number,
  attackerY: number,
  attackerZ: number,
  defenderX: number,
  defenderY: number,
  defenderZ: number,
): 0 | 1 | 2 {
  const cells = traceRay(attackerX, attackerY, defenderX, defenderY);
  const x0 = attackerX + 0.5;
  const y0 = attackerY + 0.5;
  const z0 = attackerZ + 0.5;
  const x1 = defenderX + 0.5;
  const y1 = defenderY + 0.5;
  const z1 = defenderZ + 0.5;
  let best: 0 | 1 | 2 = 0;
  for (const cell of cells) {
    if ((cell.x === attackerX && cell.y === attackerY) || (cell.x === defenderX && cell.y === defenderY)) continue;
    const tile = tileAt(grid, cell.x, cell.y);
    if (!tile || tile.pit || tile.blockLOS) continue;
    const h = tile.z - rayZ(x0, y0, z0, x1, y1, z1, cell.x, cell.y);
    // Поверхность не поднимается над лучом — укрытия нет (§7.2).
    if (h <= 0 || h > 1.01) continue;
    const diff = tile.z - attackerZ;
    let tier: 0 | 1 | 2 = diff >= 2 ? 2 : diff === 1 ? 1 : 0;
    if (cell.type === "glancing") tier = Math.max(0, tier - 1) as 0 | 1 | 2;
    if (tier > best) best = tier;
  }
  return best;
}
