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
 * Надбавка к диагональному шагу (0.20.43). Стоимость диагонали — половина
 * самого дешёвого обходного маршрута (два ортогональных шага) плюс половина
 * очка: диагональ дороже ортогонали, но дешевле обхода уголком.
 */
export const DIAGONAL_SURCHARGE = 0.5;

/**
 * Цена пересечения одной грани: 0 — грани нет, 1 — полуукрытие,
 * {@link Number.POSITIVE_INFINITY} — полное укрытие, прохода нет.
 */
function edgeCoverStepCost(
  entities: readonly EntityState[],
  fx: number,
  fy: number,
  tx: number,
  ty: number,
): number {
  const edgeCover = edgeCoverBetween(entities, fx, fy, tx, ty);
  if (!edgeCover) return 0;
  if (edgeCover.coverType === 2) return Number.POSITIVE_INFINITY;
  return 1;
}

/**
 * Базовая цена ортогонального шага A → B без учёта граневых укрытий:
 * границы поля, рельеф, яма, стена, занятость клетки. Документ математики,
 * §5.1 (0.20.43: выделено из `edgeCost`, чтобы диагональ считалась из двух
 * ортогональных плеч).
 */
function stepBaseCost(
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
  if (to.blockLOS) return Number.POSITIVE_INFINITY;
  if (to.pit && !walker.flying) return Number.POSITIVE_INFINITY;

  for (const occupant of livingAt(entities, toX, toY)) {
    if (occupant.id === walker.id) continue;
    // Граневые укрытия не занимают клетку.
    if (occupant.edge !== undefined) continue;
    if (isCover(occupant) || isFoe(walker, occupant)) return Number.POSITIVE_INFINITY;
    if (occupant.obstacle && occupant.owner === 0 && !isCover(occupant)) return Number.POSITIVE_INFINITY;
  }

  const dz = to.z - from.z;
  if (Math.abs(dz) === 2 && !walker.flying) return Number.POSITIVE_INFINITY;
  if (walker.flying) return 1;
  if (dz === 1) return 2;
  return 1;
}

/**
 * Стоимость ортогонального шага A → B (0.20.43): база плюс цена грани
 * укрытия. Документ математики, §5.1.
 */
export function orthogonalEdgeCost(
  grid: Grid,
  entities: readonly EntityState[],
  walker: EntityState,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): number {
  const base = stepBaseCost(grid, entities, walker, fromX, fromY, toX, toY);
  if (!Number.isFinite(base)) return Number.POSITIVE_INFINITY;
  const cover = edgeCoverStepCost(entities, fromX, fromY, toX, toY);
  if (!Number.isFinite(cover)) return Number.POSITIVE_INFINITY;
  return base + cover;
}

/**
 * Стоимость диагонального шага A → B (0.20.43).
 *
 * Диагональ «вверх-вправо» оценивается двумя обходными маршрутами —
 * «сначала вправо, потом вверх» и «сначала вверх, потом вправо». Берётся
 * дешёвый, делится пополам и к результату прибавляется
 * {@link DIAGONAL_SURCHARGE}:
 *
 * `cost = min(вправо + вверх, вверх + вправо) / 2 + 0.5`
 *
 * Отсюда же следует правило среза угла: если оба плеча непроходимы, ни один
 * маршрут не существует и диагонали нет; если непроходимо одно плечо, второй
 * маршрут жив, и боец проходит по диагонали мимо угла — прежнее правило
 * («обе смежные клетки обязаны принимать проход») было строже нужного.
 *
 * Полное граневое укрытие на любой из четырёх граней обоих маршрутов
 * закрывает диагональ целиком: иначе его можно было бы обойти вторым плечом.
 */
export function diagonalEdgeCost(
  grid: Grid,
  entities: readonly EntityState[],
  walker: EntityState,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): number {
  const shoulderX = stepBaseCost(grid, entities, walker, fromX, fromY, toX, fromY);
  const shoulderY = stepBaseCost(grid, entities, walker, fromX, fromY, fromX, toY);
  const exitX = stepBaseCost(grid, entities, walker, toX, fromY, toX, toY);
  const exitY = stepBaseCost(grid, entities, walker, fromX, toY, toX, toY);
  // Оба маршрута: «сначала по X» и «сначала по Y». Непроходимое плечо
  // обращает маршрут в бесконечность, а не запрещает диагональ.
  const cheapest = Math.min(shoulderX + exitX, shoulderY + exitY);
  if (!Number.isFinite(cheapest)) return Number.POSITIVE_INFINITY;

  const boundaries = [
    edgeCoverStepCost(entities, fromX, fromY, toX, fromY),
    edgeCoverStepCost(entities, toX, fromY, toX, toY),
    edgeCoverStepCost(entities, fromX, fromY, fromX, toY),
    edgeCoverStepCost(entities, fromX, toY, toX, toY),
  ];
  if (boundaries.some((cost) => !Number.isFinite(cost))) return Number.POSITIVE_INFINITY;
  // Полуукрытие на грани маршрута прибавляется один раз — максимум из четырёх
  // граней, а не сумма (документ математики, §4).
  return cheapest / 2 + DIAGONAL_SURCHARGE + Math.max(...boundaries);
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
  if (!inBounds(grid, fromX, fromY) || !inBounds(grid, toX, toY)) return Number.POSITIVE_INFINITY;
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (dx === 0 && dy === 0) return 0;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return Number.POSITIVE_INFINITY;
  if (dx !== 0 && dy !== 0) return diagonalEdgeCost(grid, entities, walker, fromX, fromY, toX, toY);
  return orthogonalEdgeCost(grid, entities, walker, fromX, fromY, toX, toY);
}
