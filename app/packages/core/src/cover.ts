import { distH } from "./grid.js";
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
  type: "full_cover" | "half_cover" | "terrain_full" | "terrain_half";
  rawTier: 0 | 1 | 2;
  effectiveTier: 0 | 1 | 2;
  heightDiff: number;
  label: string;
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
  grid: Grid,
  options: { melee: boolean; ignoreHalfCover: boolean; flyingTarget: boolean },
): CoverEval {
  if (options.flyingTarget) {
    return { penalty: 0, coverType: 0, flanked: false, details: [] };
  }

  const details: CoverDetail[] = [];

  // Entity-based covers adjacent to target.
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

  // Terrain cover (elevation between attacker and target).
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

  const hasAnyCover = candidates.length > 0 || details.some((d) => d.type.startsWith("terrain"));
  const flanked = hasAnyCover && best === 0;
  return { penalty, coverType: best, flanked, details };
}
