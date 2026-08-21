import type { CellPos } from "./types.js";

export type SkillEffect =
  | { type: "damage"; minDmg: number; maxDmg: number; crit?: number; critBonus?: number }
  | { type: "heal"; amount: number }
  | { type: "applyStatus"; status: "poison" | "panic" | "immobile" | "hidden" | "flying" | "timed"; duration: number; magnitude?: number }
  | { type: "removeStatus"; status: "poison" | "panic" | "immobile" | "hidden" | "flying" | "timed" }
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
  effects: SkillEffect[];
}

export interface SkillPreview {
  available: boolean;
  reason?: "NO_LOS" | "OUT_OF_RANGE" | "NO_AP" | "ILLEGAL" | "NOT_FOUND";
  targetPos?: CellPos;
  chance?: number;
  dmgMin?: number;
  dmgMax?: number;
  cover?: 0 | 1 | 2;
  heightMod?: -1 | 0 | 1;
  flanked?: boolean;
}
