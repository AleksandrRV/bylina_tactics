import { evaluateCover } from "./cover.js";
import { distH } from "./grid.js";
import { evaluateObstacles } from "./los.js";
import { heightRangeMod, inMeleeReach, inRangedReach } from "./range.js";
import { clampChance, type Rng } from "./rng.js";
import type { CellPos, EntityState, Grid } from "./types.js";
import type { WeaponStats } from "./weapons.js";

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
  /** Клетка, до которой линия прицеливания сплошная (препятствие или макс. дальность). */
  breakCell?: CellPos | null;
  /** Суммарный штраф от промежуточных препятствий (§9.5). */
  obstaclePenalty?: number;
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
): HitPreview {
  if (attacker.dead || target.dead || target.coverType > 0) {
    return { available: false, reason: "ILLEGAL" };
  }
  if (attacker.owner === target.owner) return { available: false, reason: "ILLEGAL" };
  if (attacker.ap < weapon.apCost) return { available: false, reason: "NO_AP" };

  const melee = weapon.category === "melee";
  const heightMod = heightRangeMod(attacker.z, target.z);
  const inReach = melee
    ? inMeleeReach(attacker.x, attacker.y, attacker.z, target.x, target.y, target.z)
    : inRangedReach(attacker.x, attacker.y, attacker.z, target.x, target.y, target.z, weapon.range);

  // Вычислить breakCell для визуализации (нужен даже при OUT_OF_RANGE).
  let breakCell: CellPos | null = null;
  if (!inReach && !melee) {
    // Цель вне дальности: breakCell на максимальной дальности.
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

  if (!inReach) return { available: false, reason: "OUT_OF_RANGE", heightMod, breakCell };

  // §7, §9.3: оценка промежуточных препятствий.
  const obstacles = evaluateObstacles(
    grid,
    entities,
    attacker.x,
    attacker.y,
    attacker.z,
    target.x,
    target.y,
    target.z,
  );

  if (weapon.requiresLOS && obstacles.blocked) {
    return { available: false, reason: "NO_LOS", heightMod, breakCell: obstacles.breakCell };
  }

  const cover = evaluateCover(attacker, target, entities, {
    melee,
    ignoreHalfCover: Boolean(weapon.ignoreHalfCover),
    flyingTarget: target.flying,
  });

  let rangePenalty = 0;
  if (weapon.closeRangePenalty && distH(attacker.x, attacker.y, target.x, target.y) < weapon.closeRangePenalty.distHLessThan) {
    rangePenalty = weapon.closeRangePenalty.penalty;
  }

  // §9.5: итоговый штраф P = max(укрытие_цели, промежуточные), ограничение 75.
  const obstaclePenalty = melee ? obstacles.obstaclePenalty : Math.min(75, Math.max(cover.penalty, obstacles.obstaclePenalty));

  // §10.1: формула попадания.
  const heightAim = heightMod === 1 ? 20 : heightMod === -1 ? -20 : 0;
  const defendBonus = target.defending ? 25 : 0;
  const chance = clampChance(
    attacker.aim + weapon.aimMod + heightAim
    - target.defense - defendBonus - cover.adjacentDefenseBonus
    - obstaclePenalty - rangePenalty,
  );

  // Обновить breakCell из препятствий (если есть).
  if (obstacles.breakCell) breakCell = obstacles.breakCell;

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
    obstaclePenalty,
  };
}

export function resolveAttack(
  grid: Grid,
  entities: readonly EntityState[],
  attacker: EntityState,
  target: EntityState,
  weapon: WeaponStats,
  rng: Rng,
): AttackResolution | null {
  const preview = previewAttack(grid, entities, attacker, target, weapon);
  if (!preview.available || preview.chance === undefined) return null;

  const cover = evaluateCover(attacker, target, entities, {
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
  const raw = base + (crit ? weapon.critBonus : 0);
  const defendReduction = target.defending ? 2 : 0;
  const damage = Math.max(0, raw - defendReduction);
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
