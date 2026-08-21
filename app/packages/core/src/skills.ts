import type { CellPos } from "./types.js";

export type StatusId = "poison" | "panic" | "immobile" | "hidden" | "flying" | "timed";

export type SkillEffect =
  | { type: "damage"; minDmg: number; maxDmg: number; crit?: number; critBonus?: number }
  | { type: "heal"; amount: number }
  | { type: "applyStatus"; status: StatusId; duration: number; magnitude?: number }
  | { type: "removeStatus"; status: StatusId }
  | { type: "knockback" }
  | { type: "destroyCover" }
  | { type: "spawn"; unitId: string }
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
}
