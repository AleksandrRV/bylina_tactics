import { tileAt } from "./grid.js";
import type { EntityState, Grid } from "./types.js";

interface Cell {
  x: number;
  y: number;
}

export type IntersectionType = "full" | "glancing";

export interface TracedCell extends Cell {
  type: IntersectionType;
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
  const push = (x: number, y: number, type: IntersectionType): void => {
    const key = `${x},${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    cells.push({ x, y, type });
  };

  push(ix, iy, "full");
  let guard = 0;
  while ((ix !== ixe || iy !== iye) && guard < 512) {
    guard += 1;
    if (tmaxX < tmaxY - 1e-12) {
      ix += stepX; tmaxX += tdx;
      push(ix, iy, "full");
    } else if (tmaxY < tmaxX - 1e-12) {
      iy += stepY; tmaxY += tdy;
      push(ix, iy, "full");
    } else {
      push(ix + stepX, iy, "glancing");
      push(ix, iy + stepY, "glancing");
      ix += stepX; iy += stepY;
      tmaxX += tdx; tmaxY += tdy;
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

/**
 * Эффективная ступень укрытия с учётом высоты относительно защищаемого.
 *
 * diff = defenderZ − coverZ (положительное = укрытие ниже защищаемого).
 * - diff ≤ 0: обычная эффективность.
 * - diff = 1: полу → 0, полное → 1, стена → 2.
 * - diff ≥ 2: полу → 0, полное → 0, стена → 2.
 */
export function effectiveCoverTier(
  coverType: 0 | 1 | 2,
  isWall: boolean,
  defenderZ: number,
  coverZ: number,
): 0 | 1 | 2 {
  if (coverType === 0 && !isWall) return 0;
  if (isWall) return 2;

  const diff = defenderZ - coverZ;
  if (diff <= 0) return coverType;
  if (diff === 1) {
    if (coverType === 1) return 0;
    if (coverType === 2) return 1;
  }
  return 0;
}

/**
 * Перепад высот местности как укрытие для защитника.
 * Возвышение рядом с защитником на направлении от атакующего:
 * - tile.z = defenderZ + 1 → полуукрытие (1).
 * - tile.z = defenderZ + 2 → полное укрытие (2).
 */
export function terrainCoverTier(
  grid: Grid,
  attackerX: number,
  attackerY: number,
  defenderX: number,
  defenderY: number,
  defenderZ: number,
): 0 | 1 | 2 {
  const sdx = sgnDir(attackerX - defenderX);
  const sdy = sgnDir(attackerY - defenderY);

  let best: 0 | 1 | 2 = 0;

  const candidates: [number, number][] = [];
  if (sdx !== 0 && sdy !== 0) {
    candidates.push([defenderX + sdx, defenderY]);
    candidates.push([defenderX, defenderY + sdy]);
    candidates.push([defenderX + sdx, defenderY + sdy]);
  } else if (sdx !== 0) {
    candidates.push([defenderX + sdx, defenderY]);
    candidates.push([defenderX + sdx, defenderY + 1]);
    candidates.push([defenderX + sdx, defenderY - 1]);
  } else if (sdy !== 0) {
    candidates.push([defenderX, defenderY + sdy]);
    candidates.push([defenderX + 1, defenderY + sdy]);
    candidates.push([defenderX - 1, defenderY + sdy]);
  }

  for (const [cx, cy] of candidates) {
    const tile = tileAt(grid, cx, cy);
    if (!tile || tile.pit) continue;
    const heightDiff = tile.z - defenderZ;
    if (heightDiff >= 2) { best = 2; break; }
    if (heightDiff === 1 && best < 1) best = 1;
  }

  return best;
}

export interface ObstacleResult {
  blocked: boolean;
  obstaclePenalty: number;
  breakCell: { x: number; y: number; z: number } | null;
}

export function evaluateObstacles(
  grid: Grid,
  entities: readonly EntityState[],
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): ObstacleResult {
  if (ax === bx && ay === by) return { blocked: false, obstaclePenalty: 0, breakCell: null };

  const traced = traceRay(ax, ay, bx, by);
  const x0 = ax + 0.5, y0 = ay + 0.5, z0 = az + 0.5;
  const x1 = bx + 0.5, y1 = by + 0.5, z1 = bz + 0.5;

  let blocked = false;
  let maxPenalty = 0;
  let breakCell: { x: number; y: number; z: number } | null = null;

  const intermediateCovers: { entity: EntityState; type: IntersectionType; effectiveTier: 0 | 1 | 2 }[] = [];
  const glancingWalls: { x: number; y: number }[] = [];

  for (const cell of traced) {
    if ((cell.x === ax && cell.y === ay) || (cell.x === bx && cell.y === by)) continue;

    const tile = tileAt(grid, cell.x, cell.y);
    if (!tile) { blocked = true; breakCell = { x: cell.x, y: cell.y, z: 0 }; break; }

    const rz = rayZ(x0, y0, z0, x1, y1, z1, cell.x, cell.y);
    if (rz < tile.z) {
      const heightDiff = tile.z - rz;
      if (heightDiff > 1.01) {
        blocked = true; breakCell = { x: cell.x, y: cell.y, z: tile.z }; break;
      } else {
        maxPenalty = Math.max(maxPenalty, cell.type === "full" ? 50 : 25);
      }
    }

    if (tile.blockLOS) {
      if (cell.type === "full") { blocked = true; breakCell = { x: cell.x, y: cell.y, z: tile.z }; break; }
      glancingWalls.push({ x: cell.x, y: cell.y });
    }

    for (const entity of entities) {
      if (!isAnyCover(entity) || entity.dead) continue;
      if (entity.x !== cell.x || entity.y !== cell.y) continue;
      const tileZ = tile.pit ? 0 : tile.z;
      if (Math.abs(entity.z - tileZ) > 1) continue;
      // Высота относительно защищаемого (цели bz).
      const eTier = effectiveCoverTier(entity.coverType, false, bz, entity.z);
      if (eTier === 0) continue;
      intermediateCovers.push({ entity, type: cell.type, effectiveTier: eTier });
    }
  }

  if (!blocked) {
    if (glancingWalls.length >= 2) {
      for (let i = 0; i < glancingWalls.length && !blocked; i++) {
        for (let j = i + 1; j < glancingWalls.length; j++) {
          const a = glancingWalls[i]!;
          const b = glancingWalls[j]!;
          if (Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1) {
            blocked = true; breakCell = { x: a.x, y: a.y, z: 0 }; break;
          }
        }
      }
    }
    if (!blocked) {
      if (glancingWalls.length > 0) maxPenalty = Math.max(maxPenalty, 50);
      maxPenalty = Math.max(maxPenalty, computeObstaclePenalty(intermediateCovers, ax, ay));
    }
  }

  return { blocked, obstaclePenalty: maxPenalty, breakCell };
}

function computeObstaclePenalty(
  covers: { entity: EntityState; type: IntersectionType; effectiveTier: 0 | 1 | 2 }[],
  ax: number, ay: number,
): number {
  let penalty = 0;
  const groups: { tier: 1 | 2; ids: Set<number> }[] = [];

  for (const { entity, type, effectiveTier } of covers) {
    if (effectiveTier === 0) continue;
    const distToAttacker = Math.max(Math.abs(entity.x - ax), Math.abs(entity.y - ay));
    const adjacent = distToAttacker <= 1;

    if (type === "full") {
      if (effectiveTier === 2) return 100;
      penalty = Math.max(penalty, 50);
    } else {
      if (adjacent) continue;
      let merged = false;
      for (const group of groups) {
        if (group.tier !== effectiveTier) continue;
        for (const id of group.ids) {
          const other = covers.find((c) => c.entity.id === id);
          if (other && Math.max(Math.abs(entity.x - other.entity.x), Math.abs(entity.y - other.entity.y)) <= 1) {
            group.ids.add(entity.id); merged = true; break;
          }
        }
        if (merged) break;
      }
      if (!merged) groups.push({ tier: effectiveTier, ids: new Set([entity.id]) });
    }
  }

  for (const group of groups) {
    if (group.ids.size >= 2) {
      if (group.tier === 2) return 100;
      penalty = Math.max(penalty, 50);
    } else {
      penalty = Math.max(penalty, group.tier === 2 ? 50 : 25);
    }
  }

  return penalty;
}

export function hasLineOfSight(
  grid: Grid,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): boolean {
  if (ax === bx && ay === by) return true;
  const traced = traceRay(ax, ay, bx, by);
  const x0 = ax + 0.5, y0 = ay + 0.5, z0 = az + 0.5;
  const x1 = bx + 0.5, y1 = by + 0.5, z1 = bz + 0.5;

  const glancingFull: Cell[] = [];

  for (const cell of traced) {
    if ((cell.x === ax && cell.y === ay) || (cell.x === bx && cell.y === by)) continue;
    const tile = tileAt(grid, cell.x, cell.y);
    if (!tile) return false;

    const rz = rayZ(x0, y0, z0, x1, y1, z1, cell.x, cell.y);
    if (rz < tile.z) return false;

    if (tile.blockLOS) {
      if (cell.type === "full") return false;
      glancingFull.push(cell);
    }
  }

  if (glancingFull.length >= 2) {
    for (let i = 0; i < glancingFull.length; i++) {
      for (let j = i + 1; j < glancingFull.length; j++) {
        const a = glancingFull[i]!;
        const b = glancingFull[j]!;
        if (Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1) return false;
      }
    }
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
 * Учитывается только если возвышение на линии огня.
 */
export function terrainCoverTier(
  grid: Grid,
  attackerX: number,
  attackerY: number,
  attackerZ: number,
  defenderX: number,
  defenderY: number,
): 0 | 1 | 2 {
  const cells = supercover(attackerX, attackerY, defenderX, defenderY);
  let best: 0 | 1 | 2 = 0;
  for (const cell of cells) {
    if ((cell.x === attackerX && cell.y === attackerY) || (cell.x === defenderX && cell.y === defenderY)) continue;
    const tile = tileAt(grid, cell.x, cell.y);
    if (!tile || tile.pit || tile.blockLOS) continue;
    const diff = tile.z - attackerZ;
    if (diff >= 2 && best < 2) best = 2;
    else if (diff === 1 && best < 1) best = 1;
  }
  return best;
}
