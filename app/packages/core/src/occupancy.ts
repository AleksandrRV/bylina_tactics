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

/**
 * Найти граневое укрытие на грани между двумя клетками.
 * edge: 0=N, 1=E, 2=S, 3=W.
 * При переходе из (fx,fy) в (tx,ty) проверяем грань клетки (fx,fy)
 * в направлении движения и грань клетки (tx,ty) с противоположной стороны.
 */
export function edgeCoverBetween(
  entities: readonly EntityState[],
  fx: number,
  fy: number,
  tx: number,
  ty: number,
): EntityState | null {
  const dx = tx - fx;
  const dy = ty - fy;
  // Грань клетки (fx,fy) в направлении движения.
  let fromEdge: number;
  let toEdge: number;
  if (dx === 1) { fromEdge = 1; toEdge = 3; } // east
  else if (dx === -1) { fromEdge = 3; toEdge = 1; } // west
  else if (dy === 1) { fromEdge = 2; toEdge = 0; } // south
  else if (dy === -1) { fromEdge = 0; toEdge = 2; } // north
  else return null;

  // Ищем укрытие на грани fromEdge клетки (fx,fy).
  for (const entity of entities) {
    if (!isCover(entity) || entity.dead || entity.edge === undefined) continue;
    if (entity.x === fx && entity.y === fy && entity.edge === fromEdge) return entity;
  }
  // Ищем укрытие на грани toEdge клетки (tx,ty).
  for (const entity of entities) {
    if (!isCover(entity) || entity.dead || entity.edge === undefined) continue;
    if (entity.x === tx && entity.y === ty && entity.edge === toEdge) return entity;
  }
  return null;
}

/** Проход сквозь клетку. Документ математики, §4. */
export function canTransit(
  grid: Grid,
  entities: readonly EntityState[],
  walker: EntityState,
  x: number,
  y: number,
  fromX?: number,
  fromY?: number,
): boolean {
  const tile = tileAt(grid, x, y);
  if (!tile) return false;
  if (tile.blockLOS) return false;
  if (tile.pit && !walker.flying) return false;
  for (const occupant of livingAt(entities, x, y)) {
    if (occupant.id === walker.id) continue;
    // Граневые укрытия (edge !== undefined) не занимают клетку.
    if (occupant.edge !== undefined) continue;
    if (isCover(occupant) || isFoe(walker, occupant)) return false;
    if (occupant.obstacle && occupant.owner === 0 && !isCover(occupant)) return false;
  }
  // Проверить граневое укрытие на грани перехода.
  if (fromX !== undefined && fromY !== undefined) {
    const edgeCover = edgeCoverBetween(entities, fromX, fromY, x, y);
    if (edgeCover && edgeCover.coverType === 2) return false; // полное граневое блокирует
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
    // Граневые укрытия не занимают клетку — можно встать.
    if (occupant.edge !== undefined) continue;
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
    if (!canTransit(grid, entities, walker, toX, fromY, fromX, fromY)) return Number.POSITIVE_INFINITY;
    if (!canTransit(grid, entities, walker, fromX, toY, fromX, fromY)) return Number.POSITIVE_INFINITY;
  }

  if (to.blockLOS) return Number.POSITIVE_INFINITY;
  if (to.pit && !walker.flying) return Number.POSITIVE_INFINITY;

  for (const occupant of livingAt(entities, toX, toY)) {
    if (occupant.id === walker.id) continue;
    // Граневые укрытия не занимают клетку.
    if (occupant.edge !== undefined) continue;
    if (isCover(occupant) || isFoe(walker, occupant)) return Number.POSITIVE_INFINITY;
    if (occupant.obstacle && occupant.owner === 0 && !isCover(occupant)) return Number.POSITIVE_INFINITY;
  }

  // Проверить граневое укрытие на грани перехода.
  let edgeCoverCost = 0;
  if (dx !== 0 || dy !== 0) {
    // Для диагонального шага проверяем обе грани.
    const checkEdge = (fx: number, fy: number, tx: number, ty: number): number => {
      const edgeCover = edgeCoverBetween(entities, fx, fy, tx, ty);
      if (!edgeCover) return 0;
      if (edgeCover.coverType === 2) return Number.POSITIVE_INFINITY; // полное блокирует
      return 1; // полуукрытие: +1 МП
    };
    if (dx !== 0 && dy !== 0) {
      // Диагональ: проверяем обе оси.
      // A diagonal intersects two boundaries on each L-shaped route. Check
      // both halves so a full edge at the destination cannot be bypassed.
      const costs = [
        checkEdge(fromX, fromY, fromX + dx, fromY),
        checkEdge(fromX + dx, fromY, toX, toY),
        checkEdge(fromX, fromY, fromX, fromY + dy),
        checkEdge(fromX, fromY + dy, toX, toY),
      ];
      if (costs.some((cost) => cost === Number.POSITIVE_INFINITY)) return Number.POSITIVE_INFINITY;
      edgeCoverCost = Math.max(...costs);
    } else {
      edgeCoverCost = checkEdge(fromX, fromY, toX, toY);
      if (edgeCoverCost === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
    }
  }

  const dz = to.z - from.z;
  if (Math.abs(dz) === 2 && !walker.flying) return Number.POSITIVE_INFINITY;
  if (walker.flying) return 1 + edgeCoverCost;
  if (dz === 1) return 2 + edgeCoverCost;
  return 1 + edgeCoverCost;
}
