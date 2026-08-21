import { distH, tileAt } from "./grid.js";
import { effectiveCoverTier, terrainCoverTier } from "./los.js";
import { isCover } from "./occupancy.js";
import type { EntityState, Grid } from "./types.js";

export interface CoverEval {
  penalty: number;
  coverType: 0 | 1 | 2;
  flanked: boolean;
  details: CoverDetail[];
}

export interface CoverDetail {
  x: number;
  y: number;
  z: number;
  type: "full_cover" | "half_cover" | "wall" | "terrain_full" | "terrain_half";
  rawTier: 0 | 1 | 2;
  effectiveTier: 0 | 1 | 2;
  heightDiff: number;
  label: string;
}

function sgn(value: number): number {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

export function wholeCellCoverOnFireLine(sx: number, sy: number, dx: number, dy: number): boolean {
  if (sx !== 0 && sy !== 0) {
    return (dx === sx && dy === 0) || (dx === 0 && dy === sy) || (dx === sx && dy === sy);
  }
  if (sx !== 0) return dx === sx && (dy === 0 || dy === 1 || dy === -1);
  if (sy !== 0) return dy === sy && (dx === 0 || dx === 1 || dx === -1);
  return false;
}

const EDGE_VECTOR: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/**
 * Граневое укрытие защищает цель, только если луч входит в её клетку через
 * указанную границу. Укрытие может храниться с любой из двух сторон границы.
 */
export function edgeCoverOnFireLine(attacker: EntityState, target: EntityState, cover: EntityState): boolean {
  if (cover.edge === undefined) return false;
  const vector = EDGE_VECTOR[cover.edge];
  if (!vector) return false;
  const [ex, ey] = vector;
  const nx = cover.x + ex;
  const ny = cover.y + ey;
  const sx = sgn(attacker.x - target.x);
  const sy = sgn(attacker.y - target.y);

  let fromTargetX: number;
  let fromTargetY: number;
  if (target.x === cover.x && target.y === cover.y) {
    fromTargetX = ex;
    fromTargetY = ey;
  } else if (target.x === nx && target.y === ny) {
    fromTargetX = -ex;
    fromTargetY = -ey;
  } else {
    return false;
  }

  return fromTargetX !== 0 ? sx === fromTargetX : sy === fromTargetY;
}

export function isCoverCandidate(target: EntityState, cover: EntityState): boolean {
  if (!isCover(cover) || cover.dead || Math.abs(target.z - cover.z) > 1) return false;
  if (cover.edge !== undefined) {
    const vector = EDGE_VECTOR[cover.edge];
    if (!vector) return false;
    return (
      (cover.x === target.x && cover.y === target.y) ||
      (cover.x + vector[0] === target.x && cover.y + vector[1] === target.y)
    );
  }
  return distH(target.x, target.y, cover.x, cover.y) === 1;
}

export function isCoverOnFireLine(attacker: EntityState, target: EntityState, cover: EntityState): boolean {
  if (cover.edge !== undefined) return edgeCoverOnFireLine(attacker, target, cover);
  return wholeCellCoverOnFireLine(
    sgn(attacker.x - target.x),
    sgn(attacker.y - target.y),
    cover.x - target.x,
    cover.y - target.y,
  );
}

/** Документ математики, §9. */
export function evaluateCover(
  attacker: EntityState,
  target: EntityState,
  entities: readonly EntityState[],
  grid: Grid,
  options: { melee: boolean; ignoreHalfCover: boolean; flyingTarget: boolean },
): CoverEval {
  if (options.flyingTarget) return { penalty: 0, coverType: 0, flanked: false, details: [] };

  const details: CoverDetail[] = [];
  const candidates = entities.filter((entity) => isCoverCandidate(target, entity));
  let best: 0 | 1 | 2 = 0;
  let directionalCandidate = false;

  for (const cover of candidates) {
    if (!isCoverOnFireLine(attacker, target, cover)) continue;
    directionalCandidate = true;
    const eTier = effectiveCoverTier(cover.coverType, false, attacker.z, target.z, cover.z);
    const heightDiff = cover.z - attacker.z;
    details.push({
      x: cover.x,
      y: cover.y,
      z: cover.z,
      type: cover.coverType === 2 ? "full_cover" : "half_cover",
      rawTier: cover.coverType,
      effectiveTier: eTier,
      heightDiff,
      label: `${cover.coverType === 2 ? "Полное укрытие" : "Полуукрытие"} (${cover.x},${cover.y}) z=${cover.z} h=${heightDiff >= 0 ? "+" : ""}${heightDiff} → ${eTier === 0 ? "игнор" : eTier === 1 ? "−25" : "−50"}`,
    });
    if (eTier > best) best = eTier;
  }

  // Глухая стена в соседней с целью клетке даёт полное укрытие, если сама
  // клетка не лежит в промежуточном суперпокрытии (в таком случае LOS уже нет).
  const sx = sgn(attacker.x - target.x);
  const sy = sgn(attacker.y - target.y);
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if ((dx === 0 && dy === 0) || !wholeCellCoverOnFireLine(sx, sy, dx, dy)) continue;
      const tile = tileAt(grid, target.x + dx, target.y + dy);
      if (!tile?.blockLOS) continue;
      directionalCandidate = true;
      best = 2;
      details.push({
        x: tile.x,
        y: tile.y,
        z: tile.z,
        type: "wall",
        rawTier: 2,
        effectiveTier: 2,
        heightDiff: tile.z - attacker.z,
        label: `Глухая стена (${tile.x},${tile.y}) → −50`,
      });
    }
  }

  if (!options.melee) {
    const terrainTier = terrainCoverTier(grid, attacker.x, attacker.y, attacker.z, target.x, target.y);
    if (terrainTier > 0) {
      details.push({
        x: -1,
        y: -1,
        z: attacker.z + terrainTier,
        type: terrainTier === 2 ? "terrain_full" : "terrain_half",
        rawTier: terrainTier,
        effectiveTier: terrainTier,
        heightDiff: terrainTier,
        label: `Перепад высот +${terrainTier} → ${terrainTier === 1 ? "−25" : "−50"}`,
      });
      if (terrainTier > best) best = terrainTier;
    }
  }

  let penalty = best === 2 ? 50 : best === 1 ? 25 : 0;
  if (options.ignoreHalfCover && penalty === 25) penalty = 0;
  if (options.melee) penalty = 0;

  // Высота может обнулить направленное укрытие, но не превращает его во фланг.
  const flanked = candidates.length > 0 && !directionalCandidate;
  return { penalty, coverType: best, flanked, details };
}
