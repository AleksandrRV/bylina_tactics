import { evaluateCover } from "./cover.js";
import { distH, tileAt } from "./grid.js";
import { effectiveCoverTier, evaluateObstacles, traceRay } from "./los.js";
import { heightRangeMod, inMeleeReach, inRangedReach } from "./range.js";
import { clampChance, type Rng } from "./rng.js";
import type { CellPos, EntityState, Grid } from "./types.js";
import type { WeaponStats } from "./weapons.js";

export interface ObstacleDetail {
  x: number;
  y: number;
  z: number;
  type: "wall" | "full_cover" | "half_cover" | "terrain_full" | "terrain_half";
  intersection: "full" | "glancing";
  adjacentTo: "attacker" | "target" | "none";
  heightDiff: number; // coverZ - attackerZ (positive = cover above attacker)
  penalty: number; // how much this obstacle reduces hit chance
  label: string;
}

export interface HitBreakdown {
  baseAim: number;
  weaponMod: number;
  heightAim: number;
  targetDefense: number;
  defendBonus: number;
  adjacentDefenseBonus: number;
  obstaclePenalty: number;
  rangePenalty: number;
  coverPenalty: number;
  finalChance: number;
  obstacles: ObstacleDetail[];
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
  obstaclePenalty?: number;
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
  }, grid);

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

  // Подробная разбивка расчёта попадания.
  const breakdown = computeBreakdown(
    grid, entities, attacker, target, weapon, melee,
    heightMod, heightAim, cover, obstacles, rangePenalty, obstaclePenalty,
    defendBonus,
  );

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
): AttackResolution | null {
  const preview = previewAttack(grid, entities, attacker, target, weapon);
  if (!preview.available || preview.chance === undefined) return null;

  const cover = evaluateCover(attacker, target, entities, {
    melee: weapon.category === "melee",
    ignoreHalfCover: Boolean(weapon.ignoreHalfCover),
    flyingTarget: target.flying,
  }, grid);
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

function computeBreakdown(
  grid: Grid,
  entities: readonly EntityState[],
  attacker: EntityState,
  target: EntityState,
  weapon: WeaponStats,
  melee: boolean,
  heightMod: -1 | 0 | 1,
  heightAim: number,
  cover: { penalty: number; coverType: 0 | 1 | 2; flanked: boolean; adjacentDefenseBonus: number },
  obstacles: { blocked: boolean; obstaclePenalty: number; breakCell: CellPos | null },
  rangePenalty: number,
  obstaclePenalty: number,
  defendBonus: number,
): HitBreakdown {
  const obstacleDetails: ObstacleDetail[] = [];

  if (!melee) {
    const traced = traceRay(attacker.x, attacker.y, target.x, target.y);
    for (const cell of traced) {
      if ((cell.x === attacker.x && cell.y === attacker.y) || (cell.x === target.x && cell.y === target.y)) continue;
      const tile = tileAt(grid, cell.x, cell.y);
      if (!tile) continue;
      const distToAttacker = Math.max(Math.abs(cell.x - attacker.x), Math.abs(cell.y - attacker.y));
      const distToTarget = Math.max(Math.abs(cell.x - target.x), Math.abs(cell.y - target.y));
      const adjacentTo: "attacker" | "target" | "none" = distToAttacker <= 1 ? "attacker" : distToTarget <= 1 ? "target" : "none";
      const heightDiff = tile.z - attacker.z;

      // Стена.
      if (tile.blockLOS) {
        obstacleDetails.push({
          x: cell.x, y: cell.y, z: tile.z,
          type: "wall",
          intersection: cell.type,
          adjacentTo,
          heightDiff,
          penalty: cell.type === "full" ? -100 : -50,
          label: `Стена (${cell.x},${cell.y}) z=${tile.z} [${cell.type === "full" ? "полное" : "касательное"}]${adjacentTo !== "none" ? ` [у ${adjacentTo === "attacker" ? "атакующего" : "цели"}]` : ""} → ${cell.type === "full" ? "БЛОК" : "−50"}`,
        });
      }

      // Перепад высот.
      if (!tile.blockLOS && !tile.pit && tile.z > attacker.z) {
        const tier = tile.z - attacker.z >= 2 ? "terrain_full" : "terrain_half";
        const pen = tier === "terrain_full" ? (cell.type === "full" ? -50 : -25) : (cell.type === "full" ? -50 : -25);
        obstacleDetails.push({
          x: cell.x, y: cell.y, z: tile.z,
          type: tier as "terrain_full" | "terrain_half",
          intersection: cell.type,
          adjacentTo,
          heightDiff,
          penalty: pen,
          label: `Высота +${tile.z - attacker.z} (${cell.x},${cell.y}) z=${tile.z} [${cell.type === "full" ? "полное" : "касательное"}] → −${pen < 0 ? -pen : pen}`,
        });
      }

      // Укрытия-сущности.
      for (const entity of entities) {
        if (!entity || entity.dead || entity.coverType === 0) continue;
        if (entity.x !== cell.x || entity.y !== cell.y) continue;
        const eTier = effectiveCoverTier(entity.coverType, false, target.z, entity.z);
        if (eTier === 0) continue;
        const pen = eTier === 2 ? (cell.type === "full" ? -100 : -50) : (cell.type === "full" ? -50 : -25);
        obstacleDetails.push({
          x: cell.x, y: cell.y, z: entity.z,
          type: eTier === 2 ? "full_cover" : "half_cover",
          intersection: cell.type,
          adjacentTo,
          heightDiff: entity.z - attacker.z,
          penalty: pen,
          label: `${eTier === 2 ? "Полное укрытие" : "Полуукрытие"} (${cell.x},${cell.y}) z=${entity.z} h=${entity.z - attacker.z >= 0 ? "+" : ""}${entity.z - attacker.z} [${cell.type === "full" ? "полное" : "касательное"}]${adjacentTo !== "none" ? ` [у ${adjacentTo === "attacker" ? "атакующего" : "цели"}]` : ""} → ${pen < 0 ? pen : "−" + pen}`,
        });
      }
    }
  }

  return {
    baseAim: attacker.aim,
    weaponMod: weapon.aimMod,
    heightAim,
    targetDefense: target.defense,
    defendBonus,
    adjacentDefenseBonus: cover.adjacentDefenseBonus,
    obstaclePenalty,
    rangePenalty,
    coverPenalty: cover.penalty,
    finalChance: clampChance(
      attacker.aim + weapon.aimMod + heightAim
      - target.defense - defendBonus - cover.adjacentDefenseBonus
      - obstaclePenalty - rangePenalty,
    ),
    obstacles: obstacleDetails,
  };
}
