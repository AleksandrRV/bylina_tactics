import { evaluateCover, type CoverDetail } from "./cover.js";
import { distH } from "./grid.js";
import { evaluateObstacles, hasLineOfSight } from "./los.js";
import { heightRangeMod, inMeleeReach, inRangedReach } from "./range.js";
import { clampChance, type Rng } from "./rng.js";
import type { CellPos, EntityState, Grid } from "./types.js";
import type { WeaponStats } from "./weapons.js";

/**
 * Исход атаки, заданный сценой миссии: `hit` — попадание со случайным
 * уроном, `miss` — промах, `min` — попадание минимальным уроном оружия
 * (0.20.40), `max` — попадание максимальным уроном (постановочный выстрел).
 */
export type ForceOutcome = "hit" | "miss" | "min" | "max";

export interface AttackOptions {
  ignoreAp?: boolean;
  coverPenaltyOverride?: number;
  coverTypeOverride?: 0 | 1 | 2;
  flankedOverride?: boolean;
  coverDetailsOverride?: CoverDetail[];
  damageReduction?: number;
  /** Area skills with filter all/allies may intentionally hit the source side. */
  allowFriendly?: boolean;
  /**
   * Скриптовый исход (пролог, §13.2): попадание или промах без броска
   * попадания. Урон при «hit» бросается честно; крит не форсируется.
   */
  forceOutcome?: ForceOutcome;
}

interface HitBreakdown {
  baseAim: number;
  weaponMod: number;
  heightAim: number;
  targetDefense: number;
  stanceDefense: number;
  coverPenalty: number;
  rangePenalty: number;
  finalChance: number;
  coverDetails: CoverDetail[];
}

export interface HitPreview {
  available: boolean;
  reason?: "NO_LOS" | "OUT_OF_RANGE" | "NO_AP" | "ON_COOLDOWN" | "NO_USES" | "ILLEGAL" | "NOT_FOUND";
  chance?: number;
  dmgMin?: number;
  dmgMax?: number;
  cover?: 0 | 1 | 2;
  heightMod?: -1 | 0 | 1;
  flanked?: boolean;
  actionType?: "MELEE" | "RANGED";
  breakCell?: CellPos | null;
  breakdown?: HitBreakdown;
  /** Атака по сущности укрытия: испытание попадания не проводится, укрытие
   *  разрушается (§10.4 math). Позволяет интерфейсу показать «разрушить
   *  укрытие» вместо чисел вероятности/урона. */
  coverTarget?: boolean;
  /** Клетки области действия умения (0.20.21, этап 2.6) — для предпросмотра. */
  areaCells?: CellPos[];
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
  options: AttackOptions = {},
): HitPreview {
  if (attacker.dead || target.dead || target.coverType > 0) {
    return { available: false, reason: "ILLEGAL" };
  }
  if (attacker.owner === target.owner && !options.allowFriendly) return { available: false, reason: "ILLEGAL" };
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
    breakCell = obstacles.breakCell;
    return { available: false, reason: "NO_LOS", heightMod, breakCell };
  }

  const cover = evaluateCover(attacker, target, entities, grid, {
    melee,
    ignoreHalfCover: Boolean(weapon.ignoreHalfCover),
    flyingTarget: target.flying,
  });

  let rangePenalty = 0;
  if (
    weapon.closeRangePenalty &&
    distH(attacker.x, attacker.y, target.x, target.y) < weapon.closeRangePenalty.distHLessThan
  ) {
    rangePenalty = weapon.closeRangePenalty.penalty;
  }

  const heightAim = heightMod === 1 ? 20 : heightMod === -1 ? -20 : 0;
  const baseAim = attacker.aim;
  const weaponMod = weapon.aimMod;
  const targetDefense = target.defense;
  const stanceDefense = target.defending ? 25 : 0;
  const obstacles = evaluateObstacles(grid, entities, attacker.x, attacker.y, attacker.z, target.x, target.y, target.z);
  const camouflage =
    !melee &&
    Boolean(target.camouflageMinCover) &&
    entities.some(
      (entity) =>
        !entity.dead &&
        entity.id !== target.id &&
        entity.owner === target.owner &&
        entity.providesCamouflage &&
        distH(target.x, target.y, entity.x, entity.y) === 1,
    );
  const camouflagePenalty = camouflage && !weapon.ignoreHalfCover ? 25 : 0;
  const coverPenalty =
    options.coverPenaltyOverride ?? Math.max(cover.penalty, obstacles.obstaclePenalty, camouflagePenalty);

  const chance = clampChance(
    baseAim + weaponMod + heightAim - targetDefense - stanceDefense - coverPenalty - rangePenalty,
  );

  const breakdown: HitBreakdown = {
    baseAim,
    weaponMod,
    heightAim,
    targetDefense,
    stanceDefense,
    coverPenalty,
    rangePenalty,
    finalChance: chance,
    coverDetails: options.coverDetailsOverride ?? cover.details,
  };

  return {
    available: true,
    chance,
    dmgMin: Math.max(0, weapon.minDmg - (target.defending ? 2 : 0) - (options.damageReduction ?? 0)),
    dmgMax: Math.max(0, weapon.maxDmg - (target.defending ? 2 : 0) - (options.damageReduction ?? 0)),
    cover: options.coverTypeOverride ?? (camouflage && cover.coverType < 1 ? 1 : cover.coverType),
    heightMod,
    // Маскировка не является направленным укрытием и не отменяет фланговый охват (§9.6).
    flanked: options.flankedOverride ?? cover.flanked,
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
  options: AttackOptions = {},
): AttackResolution | null {
  const preview = previewAttack(grid, entities, attacker, target, weapon, options);
  if (!preview.available || preview.chance === undefined) return null;

  const critChance = Math.max(0, Math.min(100, Math.round(weapon.crit + (preview.flanked ? 40 : 0))));
  const flanked = preview.flanked ?? false;
  const heightMod = preview.heightMod ?? 0;
  const cover = preview.cover ?? 0;
  const actionType = preview.actionType ?? "RANGED";
  if (options.forceOutcome === "miss") {
    return { result: "MISS", damage: 0, chance: preview.chance, critChance, flanked, heightMod, cover, actionType };
  }
  if (options.forceOutcome === "min" || options.forceOutcome === "max") {
    // Постановочный удар: бросок не делается. `min` (0.20.40) — укус М1,
    // опасность без случайного увечья; `max` — выстрел Федота в М3, сцена
    // обещает, что раненый упырь падает от одной стрелы.
    const raw = options.forceOutcome === "min" ? weapon.minDmg : weapon.maxDmg;
    const damage = Math.max(0, raw - (target.defending ? 2 : 0) - (options.damageReduction ?? 0));
    return { result: "HIT", damage, chance: preview.chance, critChance, flanked, heightMod, cover, actionType };
  }
  if (options.forceOutcome === "hit") {
    const base = rng.nextInt(weapon.minDmg, weapon.maxDmg);
    const damage = Math.max(0, base - (target.defending ? 2 : 0) - (options.damageReduction ?? 0));
    return { result: "HIT", damage, chance: preview.chance, critChance, flanked, heightMod, cover, actionType };
  }
  const hitRoll = rng.nextInt(1, 100);
  if (hitRoll > preview.chance) {
    return {
      result: "MISS",
      damage: 0,
      chance: preview.chance,
      critChance,
      flanked,
      heightMod,
      cover,
      actionType,
    };
  }
  const critRoll = rng.nextInt(1, 100);
  const crit = critRoll <= critChance;
  const base = rng.nextInt(weapon.minDmg, weapon.maxDmg);
  const rawDamage = base + (crit ? weapon.critBonus : 0);
  const damage = Math.max(0, rawDamage - (target.defending ? 2 : 0) - (options.damageReduction ?? 0));
  return {
    result: crit ? "CRIT" : "HIT",
    damage,
    chance: preview.chance,
    critChance,
    flanked: preview.flanked ?? false,
    heightMod: preview.heightMod ?? 0,
    cover: preview.cover ?? 0,
    actionType: preview.actionType ?? "RANGED",
  };
}
