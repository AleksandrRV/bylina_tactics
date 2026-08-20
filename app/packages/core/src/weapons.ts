export interface WeaponStats {
  id: string;
  category: "melee" | "ranged";
  apCost: number;
  endsTurn: boolean;
  range: number;
  requiresLOS: boolean;
  aimMod: number;
  minDmg: number;
  maxDmg: number;
  crit: number;
  critBonus: number;
  ignoreHalfCover?: boolean;
  closeRangePenalty?: { distHLessThan: number; penalty: number };
}

export const DEBUG_BOW: WeaponStats = {
  id: "bow_debug",
  category: "ranged",
  apCost: 1,
  endsTurn: true,
  range: 8,
  requiresLOS: true,
  aimMod: 0,
  minDmg: 3,
  maxDmg: 5,
  crit: 15,
  critBonus: 2,
};

export const DEBUG_SWORD: WeaponStats = {
  id: "sword_debug",
  category: "melee",
  apCost: 1,
  endsTurn: true,
  range: 1,
  requiresLOS: false,
  aimMod: 0,
  minDmg: 3,
  maxDmg: 5,
  crit: 10,
  critBonus: 2,
};

export function defaultWeapons(): Record<string, WeaponStats> {
  return {
    [DEBUG_BOW.id]: DEBUG_BOW,
    [DEBUG_SWORD.id]: DEBUG_SWORD,
  };
}
