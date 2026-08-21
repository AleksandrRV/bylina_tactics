import { distH } from "./grid.js";
import { isCover } from "./occupancy.js";
import type { EntityState } from "./types.js";

export interface CoverEval {
  penalty: number;
  coverType: 0 | 1 | 2;
  flanked: boolean;
  /** Бонус смежных укрытий цели от входящих атак (§9.6). */
  adjacentDefenseBonus: number;
}

function sgn(value: number): number {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}

function onFireLine(sx: number, sy: number, dx: number, dy: number): boolean {
  if (sx !== 0 && sy !== 0) {
    return (dx === sx && dy === 0) || (dx === 0 && dy === sy) || (dx === sx && dy === sy);
  }
  if (sx !== 0 && sy === 0) {
    return dx === sx && (dy === 0 || dy === 1 || dy === -1);
  }
  if (sx === 0 && sy !== 0) {
    return dy === sy && (dx === 0 || dx === 1 || dx === -1);
  }
  return false;
}

/**
 * Проверить, пересекает ли луч грань укрытия (§9.7).
 * Если у укрытия задан edge, учитывается только при пересечении этой грани.
 */
function edgeBlocksRay(cover: EntityState, attackerX: number, attackerY: number): boolean {
  if (cover.edge === undefined) return true; // целоклеточное укрытие — всегда учитывается
  // Определить направление от укрытия к атакующему.
  const dx = attackerX - cover.x;
  const dy = attackerY - cover.y;
  // edge: 0=N, 1=E, 2=S, 3=W
  // Луч пересекает грань, если атакующий находится со стороны этой грани.
  if (cover.edge === 0 && dy < 0) return true; // N: атакующий севернее
  if (cover.edge === 1 && dx > 0) return true; // E: атакующий восточнее
  if (cover.edge === 2 && dy > 0) return true; // S: атакующий южнее
  if (cover.edge === 3 && dx < 0) return true; // W: атакующий западнее
  return false;
}

/** Документ математики, §9. Укрытие цели + бонус смежных укрытий. */
export function evaluateCover(
  attacker: EntityState,
  target: EntityState,
  entities: readonly EntityState[],
  options: { melee: boolean; ignoreHalfCover: boolean; flyingTarget: boolean },
): CoverEval {
  if (options.flyingTarget) {
    return { penalty: 0, coverType: 0, flanked: false, adjacentDefenseBonus: 0 };
  }

  // §9.1: кандидаты — укрытия в клетках, смежных с целью.
  const candidates = entities.filter(
    (entity) =>
      isCover(entity) &&
      !entity.dead &&
      distH(target.x, target.y, entity.x, entity.y) === 1 &&
      Math.abs(target.z - entity.z) <= 1,
  );

  const sx = sgn(attacker.x - target.x);
  const sy = sgn(attacker.y - target.y);
  let best: 0 | 1 | 2 = 0;
  for (const cover of candidates) {
    const dx = cover.x - target.x;
    const dy = cover.y - target.y;
    if (!onFireLine(sx, sy, dx, dy)) continue;
    // §9.7: граневое укрытие учитывается только при пересечении его грани.
    if (!edgeBlocksRay(cover, attacker.x, attacker.y)) continue;
    if (cover.coverType > best) best = cover.coverType;
  }

  let penalty = best === 2 ? 50 : best === 1 ? 25 : 0;
  if (options.ignoreHalfCover && penalty === 25) penalty = 0;
  if (options.melee) penalty = 0;

  const flanked = candidates.length > 0 && best === 0;

  // §9.6: бонус смежных укрытий цели (защита от входящих атак).
  let adjacentDefenseBonus = 0;
  for (const entity of entities) {
    if (!isCover(entity) || entity.dead) continue;
    if (distH(target.x, target.y, entity.x, entity.y) > 1) continue;
    if (Math.abs(target.z - entity.z) > 1) continue;
    if (entity.coverType === 2) adjacentDefenseBonus = Math.max(adjacentDefenseBonus, 30);
    else if (entity.coverType === 1) adjacentDefenseBonus = Math.max(adjacentDefenseBonus, 15);
  }

  return { penalty, coverType: best, flanked, adjacentDefenseBonus };
}
