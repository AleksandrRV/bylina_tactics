import { distH } from "./grid.js";
import { isCover } from "./occupancy.js";
import type { EntityState } from "./types.js";

export interface CoverEval {
  penalty: number;
  coverType: 0 | 1 | 2;
  flanked: boolean;
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

/** Документ математики, §9. */
export function evaluateCover(
  attacker: EntityState,
  target: EntityState,
  entities: readonly EntityState[],
  options: { melee: boolean; ignoreHalfCover: boolean; flyingTarget: boolean },
): CoverEval {
  if (options.flyingTarget) {
    return { penalty: 0, coverType: 0, flanked: false };
  }

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
    if (cover.coverType > best) best = cover.coverType;
  }

  let penalty = best === 2 ? 50 : best === 1 ? 25 : 0;
  if (options.ignoreHalfCover && penalty === 25) penalty = 0;
  if (options.melee) penalty = 0;

  const flanked = candidates.length > 0 && best === 0;
  return { penalty, coverType: best, flanked };
}
