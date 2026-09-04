import type { WeaponStats } from "./weapons.js";

export interface SpawnUnitConfig {
  id: string;
  /** Сторона записи: люди дружины без оружия получают базовый «удар». */
  side?: "druzhina" | "nav" | "pvp";
  maxHealth: number;
  maxAP: number;
  mobility: number;
  aim: number;
  defense: number;
  will?: number;
  vision: number;
  weapons: string[];
  skills?: string[];
  tags?: ("flying" | "hiddenStart")[];
  decoy?: boolean;
  preferredRange?: number;
  timedLife?: number;
  fleeHp?: number;
  camouflageMinCover?: boolean;
  providesCamouflage?: boolean;
}

export const SWORD: WeaponStats = {
  id: "sword",
  category: "melee",
  apCost: 1,
  endsTurn: true,
  range: 1,
  requiresLOS: false,
  aimMod: 0,
  minDmg: 4,
  maxDmg: 6,
  crit: 10,
  critBonus: 2,
};

/** Базовый удар кулаком: ближняя атака человека без экипированного оружия. */
export const STRIKE: WeaponStats = {
  id: "strike",
  category: "melee",
  apCost: 1,
  endsTurn: true,
  range: 1,
  requiresLOS: false,
  aimMod: 0,
  minDmg: 1,
  maxDmg: 2,
  crit: 5,
  critBonus: 1,
};

export const BOW: WeaponStats = {
  id: "bow",
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

export const SLING: WeaponStats = {
  id: "sling",
  category: "ranged",
  apCost: 1,
  endsTurn: true,
  range: 5,
  requiresLOS: true,
  aimMod: 0,
  minDmg: 2,
  maxDmg: 4,
  crit: 10,
  critBonus: 1,
};

export const CLAWS: WeaponStats = {
  id: "claws",
  category: "melee",
  apCost: 1,
  endsTurn: true,
  range: 1,
  requiresLOS: false,
  aimMod: 0,
  minDmg: 2,
  maxDmg: 3,
  crit: 10,
  critBonus: 1,
};

export const BRANCH: WeaponStats = {
  id: "branch",
  category: "ranged",
  apCost: 1,
  endsTurn: true,
  range: 7,
  requiresLOS: true,
  aimMod: 0,
  minDmg: 2,
  maxDmg: 4,
  crit: 10,
  critBonus: 1,
};

export const NEEDLE: WeaponStats = {
  id: "needle",
  category: "melee",
  apCost: 1,
  endsTurn: true,
  range: 1,
  requiresLOS: false,
  aimMod: 0,
  minDmg: 2,
  maxDmg: 4,
  crit: 10,
  critBonus: 1,
};

export const MACE: WeaponStats = {
  id: "mace",
  category: "melee",
  apCost: 1,
  endsTurn: true,
  range: 1,
  requiresLOS: false,
  aimMod: -5,
  minDmg: 5,
  maxDmg: 7,
  crit: 10,
  critBonus: 2,
  envDmg: 1,
};

const PISHCHAL: WeaponStats = {
  id: "pishchal",
  category: "ranged",
  apCost: 2,
  endsTurn: true,
  range: 10,
  requiresLOS: true,
  aimMod: 10,
  minDmg: 6,
  maxDmg: 8,
  crit: 20,
  critBonus: 3,
  envDmg: 1,
  closeRangePenalty: { distHLessThan: 4, penalty: 30 },
};

// Запасные записи юнитов обучения (0.20.2: приведены в соответствие с
// боевыми записями содержимого — оружие, умения и воля совпадают, чтобы
// автономный прогон без файлов содержимого не менял поведение режима).
export const DEFAULT_TRAINING_UNITS: Record<string, SpawnUnitConfig> = {
  bogatyr: {
    id: "bogatyr",
    side: "druzhina",
    maxHealth: 12,
    maxAP: 2,
    mobility: 5,
    aim: 70,
    defense: 10,
    will: 40,
    vision: 12,
    // Оружие не привязано к классу (0.21.25): без экипировки — базовый «удар».
    weapons: [],
    skills: ["breach"],
  },
  strelets: {
    id: "strelets",
    side: "druzhina",
    maxHealth: 8,
    maxAP: 2,
    mobility: 6,
    aim: 85,
    defense: 0,
    will: 30,
    vision: 14,
    weapons: [],
    skills: ["aimed_eye"],
  },
  znaharka: {
    id: "znaharka",
    side: "druzhina",
    maxHealth: 7,
    maxAP: 2,
    mobility: 6,
    aim: 75,
    defense: 0,
    will: 55,
    vision: 12,
    weapons: [],
    skills: ["heal", "cleanse", "summon_forest_beast"],
  },
  upyr: {
    id: "upyr",
    side: "nav",
    maxHealth: 8,
    maxAP: 2,
    mobility: 5,
    aim: 60,
    defense: 0,
    will: 20,
    vision: 10,
    weapons: ["claws"],
  },
  leshy: {
    id: "leshy",
    side: "nav",
    maxHealth: 8,
    maxAP: 2,
    mobility: 5,
    aim: 78,
    defense: 5,
    will: 35,
    vision: 12,
    weapons: ["branch"],
    skills: ["roots"],
    camouflageMinCover: true,
    providesCamouflage: true,
    preferredRange: 6,
  },
  kikimora: {
    id: "kikimora",
    side: "nav",
    maxHealth: 7,
    maxAP: 2,
    mobility: 6,
    aim: 68,
    defense: 0,
    will: 25,
    vision: 10,
    weapons: ["needle"],
    skills: ["poison_needles", "raise_skeleton"],
  },
};

export function defaultTrainingWeapons(): Record<string, WeaponStats> {
  return {
    [STRIKE.id]: STRIKE,
    [SWORD.id]: SWORD,
    [BOW.id]: BOW,
    [SLING.id]: SLING,
    [CLAWS.id]: CLAWS,
    [BRANCH.id]: BRANCH,
    [NEEDLE.id]: NEEDLE,
    [MACE.id]: MACE,
    [PISHCHAL.id]: PISHCHAL,
  };
}

export function weaponStatsFromRecord(record: {
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
  envDmg?: number;
}): WeaponStats {
  return {
    id: record.id,
    category: record.category,
    apCost: record.apCost,
    endsTurn: record.endsTurn,
    range: record.range,
    requiresLOS: record.requiresLOS,
    aimMod: record.aimMod,
    minDmg: record.minDmg,
    maxDmg: record.maxDmg,
    crit: record.crit,
    critBonus: record.critBonus,
    ignoreHalfCover: record.ignoreHalfCover,
    closeRangePenalty: record.closeRangePenalty,
    envDmg: record.envDmg,
  };
}
