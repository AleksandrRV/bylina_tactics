import type { CellPos } from "./types.js";

export type StatusId = "poison" | "panic" | "immobile" | "hidden" | "flying" | "timed";

export type SkillEffect =
  | { type: "damage"; minDmg: number; maxDmg: number; crit?: number; critBonus?: number }
  | { type: "heal"; amount: number }
  | { type: "applyStatus"; status: StatusId; duration: number; magnitude?: number }
  | { type: "removeStatus"; status: StatusId }
  | { type: "knockback" }
  | { type: "destroyCover" }
  | {
      type: "spawn";
      unitId: string;
      /** Явная причина появления: призыв, иллюзия или воскрешение. Без поля — прежняя эвристика. */
      spawnKind?: "summon" | "illusion" | "resurrection";
    }
  | { type: "displace" }
  | { type: "flee" }
  | { type: "reveal" };

export interface SkillStats {
  id: string;
  apCost: number;
  endsTurn: boolean;
  range: number;
  requiresLOS: boolean;
  category: "melee" | "ranged" | "self";
  resolution: "attack" | "will" | "auto";
  envDmg: number;
  ignoreHalfCover?: boolean;
  detectsHidden?: boolean;
  affectsEnvironment?: boolean;
  extract?: boolean;
  radius?: number;
  willPower?: number;
  filter?: "enemies" | "allies" | "all" | "cover";
  /** Обездвиживание действует и на летающих (§15.4); по умолчанию полёт отменяет его. */
  affectsFlying?: boolean;
  /** Число собственных ходов между применениями; обязательно для непризывных умений. */
  cooldownTurns?: number;
  /** Жёсткий предел применений одной сущностью за бой. */
  maxUsesPerBattle?: number;
  effects: SkillEffect[];
}

export interface SkillPreview {
  available: boolean;
  reason?: "NO_LOS" | "OUT_OF_RANGE" | "NO_AP" | "ON_COOLDOWN" | "NO_USES" | "ILLEGAL" | "NOT_FOUND";
  targetPos?: CellPos;
  chance?: number;
  dmgMin?: number;
  dmgMax?: number;
  cover?: 0 | 1 | 2;
  heightMod?: -1 | 0 | 1;
  flanked?: boolean;
  /**
   * Клетки области действия (0.20.21, этап 2.6): для умений с радиусом —
   * все клетки в радиусе с допустимым перепадом ярусов (§ areaTargets);
   * для точечных — клетка цели либо пара «цель + назначение» у переноса.
   * Чистая информация для предпросмотра интерфейсом, на правила не влияет.
   */
  areaCells?: CellPos[];
}

export type SpawnEffect = Extract<SkillEffect, { type: "spawn" }>;

export type SpawnCause = "SUMMON" | "ILLUSION" | "RESURRECTION";

/**
 * Причина появления сущности эффектом `spawn`. Явное поле `spawnKind` в
 * конфигурации имеет приоритет; при его отсутствии применяется прежняя
 * эвристика (иллюзия по записи, воскрешение по имени умения) для
 * совместимости с существующими записями.
 */
export function spawnCause(effect: SpawnEffect, skillId: string): SpawnCause {
  if (effect.spawnKind === "illusion") return "ILLUSION";
  if (effect.spawnKind === "resurrection") return "RESURRECTION";
  if (effect.spawnKind === "summon") return "SUMMON";
  if (effect.unitId === "illusion") return "ILLUSION";
  if (skillId.includes("raise")) return "RESURRECTION";
  return "SUMMON";
}

/** Является ли эффект появления воскрешением (по явному признаку либо эвристике). */
export function isResurrectionSpawn(effect: SpawnEffect, skillId: string): boolean {
  return spawnCause(effect, skillId) === "RESURRECTION";
}
