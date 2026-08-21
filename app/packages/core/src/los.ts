import { tileAt } from "./grid.js";
import type { EntityState, Grid } from "./types.js";

interface Cell {
  x: number;
  y: number;
}

export type IntersectionType = "full" | "glancing";

export interface TracedCell extends Cell {
  /** Тип пересечения луча с клеткой. */
  type: IntersectionType;
}

/**
 * Клетки, внутренность которых пересекает отрезок центров.
 * При проходе через узел сетки (tmaxX ≈ tmaxY) обе добавляемые одновременно
 * клетки помечаются как касательные (glancing). Документ математики, §7.1.
 */
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
  let tmaxX =
    stepX === 0
      ? Number.POSITIVE_INFINITY
      : (stepX > 0 ? ix + 1 - x0 : x0 - ix) * tdx;
  let tmaxY =
    stepY === 0
      ? Number.POSITIVE_INFINITY
      : (stepY > 0 ? iy + 1 - y0 : y0 - iy) * tdy;

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
      ix += stepX;
      tmaxX += tdx;
      push(ix, iy, "full");
    } else if (tmaxY < tmaxX - 1e-12) {
      iy += stepY;
      tmaxY += tdy;
      push(ix, iy, "full");
    } else {
      push(ix + stepX, iy, "glancing");
      push(ix, iy + stepY, "glancing");
      ix += stepX;
      iy += stepY;
      tmaxX += tdx;
      tmaxY += tdy;
      push(ix, iy, "full");
    }
  }
  return cells;
}

/** Совместимость: возвращает только координаты (без типа). */
export function supercover(ax: number, ay: number, bx: number, by: number): Cell[] {
  return traceRay(ax, ay, bx, by);
}

function rayZ(
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
  cx: number, cy: number,
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

function isAnyCover(entity: EntityState): boolean {
  return entity.coverType > 0;
}

/**
 * Эффективная ступень укрытия с учётом разницы высот между атакующим и укрытием.
 *
 * Правила:
 * - Полуукрытие на 1 ниже атакующего → игнорируется (0).
 * - Полное укрытие на 1 ниже → считается полуукрытием (1).
 * - Стена (blockLOS) всегда остаётся стеной (2).
 * - Полное укрытие на 2 ниже → игнорируется (0),
 *   но если цель стоит за ним — считается полуукрытием (1).
 * - Стена на 2 ниже → остаётся стеной (2).
 *
 * Возвращает эффективную ступень: 0 = нет, 1 = полу, 2 = полное.
 */
export function effectiveCoverTier(
  coverType: 0 | 1 | 2,
  isWall: boolean,
  attackerZ: number,
  coverZ: number,
  targetZ?: number,
): 0 | 1 | 2 {
  if (coverType === 0 && !isWall) return 0;
  const diff = attackerZ - coverZ; // положительное = укрытие ниже

  // Стена (blockLOS) всегда полное укрытие.
  if (isWall) return 2;

  if (diff === 1) {
    // Укрытие на 1 ниже атакующего.
    if (coverType === 1) return 0; // полу → игнор
    if (coverType === 2) return 1; // полное → полу
  }
  if (diff >= 2) {
    // Укрытие на 2+ ниже.
    if (coverType === 2) {
      // Полное на 2 ниже: игнор, но если цель за ним — полу.
      if (targetZ !== undefined && targetZ <= coverZ) return 1;
      return 0;
    }
    if (coverType === 1) return 0; // полу на 2+ ниже → игнор
  }
  return coverType;
}

export interface ObstacleResult {
  blocked: boolean;
  obstaclePenalty: number;
  breakCell: { x: number; y: number; z: number } | null;
}

/**
 * Оценка всех промежуточных препятствий на луче от атакующего к цели (§7, §9.3–9.5).
 */
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
        if (cell.type === "full") {
          maxPenalty = Math.max(maxPenalty, 50);
        } else {
          maxPenalty = Math.max(maxPenalty, 25);
        }
      }
    }

    // Стена (blockLOS) — всегда полное укрытие, высота не влияет.
    if (tile.blockLOS) {
      if (cell.type === "full") {
        blocked = true;
        breakCell = { x: cell.x, y: cell.y, z: tile.z };
        break;
      }
      glancingWalls.push({ x: cell.x, y: cell.y });
    }

    // Сущности-укрытия с учётом высоты.
    for (const entity of entities) {
      if (!isAnyCover(entity) || entity.dead) continue;
      if (entity.x !== cell.x || entity.y !== cell.y) continue;
      const tileZ = tile.pit ? 0 : tile.z;
      if (Math.abs(entity.z - tileZ) > 1) continue;
      const eTier = effectiveCoverTier(entity.coverType, false, az, entity.z, bz);
      if (eTier === 0) continue; // игнорируется из-за высоты
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
            blocked = true;
            breakCell = { x: a.x, y: a.y, z: 0 };
            break;
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
      if (effectiveTier === 2) return 100; // полное при полном = блокировка
      penalty = Math.max(penalty, 50); // эффективное полу при полном = -50
    } else {
      if (adjacent) continue;
      let merged = false;
      for (const group of groups) {
        if (group.tier !== effectiveTier) continue;
        for (const id of group.ids) {
          const other = covers.find((c) => c.entity.id === id);
          if (other && Math.max(Math.abs(entity.x - other.entity.x), Math.abs(entity.y - other.entity.y)) <= 1) {
            group.ids.add(entity.id);
            merged = true;
            break;
          }
        }
        if (merged) break;
      }
      if (!merged) {
        groups.push({ tier: effectiveTier, ids: new Set([entity.id]) });
      }
    }
  }

  for (const group of groups) {
    if (group.ids.size >= 2) {
      if (group.tier === 2) return 100;
      penalty = Math.max(penalty, 50);
    } else {
      const singlePenalty = group.tier === 2 ? 50 : 25;
      penalty = Math.max(penalty, singlePenalty);
    }
  }

  return penalty;
}

/** Документ математики, §7. */
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
