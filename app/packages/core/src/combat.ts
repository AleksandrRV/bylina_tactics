import { evaluateCover, type CoverDetail } from "./cover.js";
import { distH } from "./grid.js";
import { evaluateObstacles, hasLineOfSight } from "./los.js";
import { heightRangeMod, inMeleeReach, inRangedReach } from "./range.js";
import { clampChance, type Rng } from "./rng.js";
import type { CellPos, EntityState, Grid } from "./types.js";
import type { WeaponStats } from "./weapons.js";

export interface HitBreakdown {
  baseAim: number;
  weaponMod: number;
  heightAim: number;
  targetDefense: number;
  coverPenalty: number;
  rangePenalty: number;
  finalChance: number;
  coverDetails: CoverDetail[];
}

export interface HitPreview {
  available: boolean;
  reason?: "NO_LOS" | "OUT_OF_RANGE" | "NO_AP" | "ILLEGAL" | "NOT_FOUND";
  chance?: number;
  dmgMin?: number;
  dmgMax?: number;
  cover?: 0 | 1 | 2;
  heightMod?: -1 | 0 | 1;
  flanked?: boolean;
  actionType?: "MELEE" | "RANGED";
  breakCell?: CellPos | null;
  breakdown?: HitBreakdown;
}

export interface AttackResolution {
  result: "HIT" | "MISS" | "CRIT";
  damage: number;
  chance: number;
  critChance: number;
  flanked: boolean;
  heightMod: -1 | 0 | 1;
  cover: 0 | 1 | 2;
  actionType: "MELEE" | "RANGED";
}

export function previewAttack(
  grid: Grid,
  entities: readonly EntityState[],
  attacker: EntityState,
  target: EntityState,
  weapon: WeaponStats,
  options: { ignoreAp?: boolean } = {},
): HitPreview {
  if (attacker.dead || target.dead || target.coverType > 0) {
    return { available: false, reason: "ILLEGAL" };
  }
  if (attacker.owner === target.owner) return { available: false, reason: "ILLEGAL" };
  if (!options.ignoreAp && attacker.ap < weapon.apCost) return { available: false, reason: "NO_AP" };

  const melee = weapon.category === "melee";
  const heightMod = heightRangeMod(attacker.z, target.z);
  const inReach = melee
    ? inMeleeReach(attacker.x, attacker.y, attacker.z, target.x, target.y, target.z)
    : inRangedReach(attacker.x, attacker.y, attacker.z, target.x, target.y, target.z, weapon.range);

  let breakCell: CellPos | null = null;
  if (!inReach) {
    // Compute breakCell for aim line visualization (ranged only).
    if (!melee) {
      const range = weapon.range + heightRangeMod(attacker.z, target.z);
      const dx = target.x - attacker.x;
      const dy = target.y - attacker.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      breakCell = {
        x: Math.round(attacker.x + (dx / d) * Math.max(1, range)),
        y: Math.round(attacker.y + (dy / d) * Math.max(1, range)),
        z: attacker.z,
      };
    }
    return { available: false, reason: "OUT_OF_RANGE", heightMod, breakCell };
  }

  const los = hasLineOfSight(grid, attacker.x, attacker.y, attacker.z, target.x, target.y, target.z);
  if (weapon.requiresLOS && !los) {
    // Compute breakCell from obstacles for NO_LOS visualization.
    const obstacles = evaluateObstacles(grid, entities, attacker.x, attacker.y, attacker.z, target.x, target.y, target.z);
    breakCell = obstacles.breakCell;
    return { available: false, reason: "NO_LOS", heightMod, breakCell };
  }

  const cover = evaluateCover(attacker, target, entities, grid, {
    melee,
    ignoreHalfCover: Boolean(weapon.ignoreHalfCover),
    flyingTarget: target.flying,
  });

  let rangePenalty = 0;
  if (weapon.closeRangePenalty && distH(attacker.x, attacker.y, target.x, target.y) < weapon.closeRangePenalty.distHLessThan) {
    rangePenalty = weapon.closeRangePenalty.penalty;
  }

  const heightAim = heightMod === 1 ? 20 : heightMod === -1 ? -20 : 0;
  const baseAim = attacker.aim;
  const weaponMod = weapon.aimMod;
  const targetDefense = target.defense;
  const obstacles = evaluateObstacles(grid, entities, attacker.x, attacker.y, attacker.z, target.x, target.y, target.z);
  const coverPenalty = Math.max(cover.penalty, obstacles.obstaclePenalty);

  const chance = clampChance(
    baseAim + weaponMod + heightAim - targetDefense - coverPenalty - rangePenalty,
  );

  const breakdown: HitBreakdown = {
    baseAim,
    weaponMod,
    heightAim,
    targetDefense,
    coverPenalty,
    rangePenalty,
    finalChance: chance,
    coverDetails: cover.details,
  };

  return {
    available: true,
    chance,
    dmgMin: weapon.minDmg,
    dmgMax: weapon.maxDmg,
    cover: cover.coverType,
    heightMod,
    flanked: cover.flanked,
    actionType: melee ? "MELEE" : "RANGED",
    breakCell,
    breakdown,
  };
}

export function resolveAttack(
  grid: Grid,
  entities: readonly EntityState[],
  attacker: EntityState,
  target: EntityState,
  weapon: WeaponStats,
  rng: Rng,
  options: { ignoreAp?: boolean } = {},
): AttackResolution | null {
  const preview = previewAttack(grid, entities, attacker, target, weapon, options);
  if (!preview.available || preview.chance === undefined) return null;

  const cover = evaluateCover(attacker, target, entities, grid, {
    melee: weapon.category === "melee",
    ignoreHalfCover: Boolean(weapon.ignoreHalfCover),
    flyingTarget: target.flying,
  });
  const critChance = clampChance(weapon.crit + (cover.flanked ? 40 : 0));
  const hitRoll = rng.nextInt(1, 100);
  if (hitRoll > preview.chance) {
    return {
      result: "MISS",
      damage: 0,
      chance: preview.chance,
      critChance,
      flanked: cover.flanked,
      heightMod: preview.heightMod ?? 0,
      cover: cover.coverType,
      actionType: preview.actionType ?? "RANGED",
    };
  }
  const critRoll = rng.nextInt(1, 100);
  const crit = critRoll <= critChance;
  const base = rng.nextInt(weapon.minDmg, weapon.maxDmg);
  const damage = base + (crit ? weapon.critBonus : 0);
  return {
    result: crit ? "CRIT" : "HIT",
    damage,
    chance: preview.chance,
    critChance,
    flanked: cover.flanked,
    heightMod: preview.heightMod ?? 0,
    cover: cover.coverType,
    actionType: preview.actionType ?? "RANGED",
  };
}
