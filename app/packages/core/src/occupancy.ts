import { inBounds, tileAt } from "./grid.js";
import type { EntityState, Grid } from "./types.js";

export function livingAt(entities: readonly EntityState[], x: number, y: number): EntityState[] {
  return entities.filter((entity) => !entity.dead && entity.x === x && entity.y === y);
}

export function isCover(entity: EntityState): boolean {
  return entity.coverType > 0;
}

export function isFoe(walker: EntityState, other: EntityState): boolean {
  return (
    other.obstacle &&
    !other.dead &&
    !isCover(other) &&
    other.owner !== 0 &&
    other.owner !== walker.owner
  );
}

export function isAlly(walker: EntityState, other: EntityState): boolean {
  return (
    other.id !== walker.id &&
    other.obstacle &&
    !other.dead &&
    !isCover(other) &&
    other.owner === walker.owner
  );
}

/** Проход сквозь клетку. Документ математики, §4. */
export function canTransit(
  grid: Grid,
  entities: readonly EntityState[],
  walker: EntityState,
  x: number,
  y: number,
): boolean {
  const tile = tileAt(grid, x, y);
  if (!tile) return false;
  if (tile.blockLOS) return false;
  if (tile.pit && !walker.flying) return false;
  for (const occupant of livingAt(entities, x, y)) {
    if (occupant.id === walker.id) continue;
    if (isCover(occupant) || isFoe(walker, occupant)) return false;
    if (occupant.obstacle && occupant.owner === 0 && !isCover(occupant)) return false;
  }
  return true;
}

/** Завершение перемещения. Документ математики, §4. */
export function canFinish(
  grid: Grid,
  entities: readonly EntityState[],
  walker: EntityState,
  x: number,
  y: number,
): boolean {
  const tile = tileAt(grid, x, y);
  if (!tile) return false;
  if (tile.blockLOS) return false;
  if (tile.pit && !walker.flying) return false;
  for (const occupant of livingAt(entities, x, y)) {
    if (occupant.id === walker.id) continue;
    if (occupant.obstacle) return false;
  }
  return true;
}

/**
 * Стоимость ребра A → сосед B, либо Infinity, если ребра нет.
 * Документ математики, §5.1.
 */
export function edgeCost(
  grid: Grid,
  entities: readonly EntityState[],
  walker: EntityState,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): number {
  if (!inBounds(grid, toX, toY)) return Number.POSITIVE_INFINITY;
  const from = tileAt(grid, fromX, fromY);
  const to = tileAt(grid, toX, toY);
  if (!from || !to) return Number.POSITIVE_INFINITY;

  const dx = toX - fromX;
  const dy = toY - fromY;
  if (dx !== 0 && dy !== 0) {
    if (!canTransit(grid, entities, walker, toX, fromY)) return Number.POSITIVE_INFINITY;
    if (!canTransit(grid, entities, walker, fromX, toY)) return Number.POSITIVE_INFINITY;
  }

  if (to.blockLOS) return Number.POSITIVE_INFINITY;
  if (to.pit && !walker.flying) return Number.POSITIVE_INFINITY;

  for (const occupant of livingAt(entities, toX, toY)) {
    if (occupant.id === walker.id) continue;
    if (isCover(occupant) || isFoe(walker, occupant)) return Number.POSITIVE_INFINITY;
    if (occupant.obstacle && occupant.owner === 0 && !isCover(occupant)) return Number.POSITIVE_INFINITY;
  }

  const dz = to.z - from.z;
  if (Math.abs(dz) === 2 && !walker.flying) return Number.POSITIVE_INFINITY;
  if (walker.flying) return 1;
  if (dz === 1) return 2;
  return 1;
}
