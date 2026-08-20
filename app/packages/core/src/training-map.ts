import { makeGrid, tileAt } from "./grid.js";
import type { EntityState, MatchState } from "./types.js";
import { PLAYER_OWNER, ENEMY_OWNER } from "./debug-map.js";
import type { WeaponStats } from "./weapons.js";

export interface SpawnUnitConfig {
  id: string;
  maxHealth: number;
  maxAP: number;
  mobility: number;
  aim: number;
  defense: number;
  weapons: string[];
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
  minDmg: 3,
  maxDmg: 4,
  crit: 10,
  critBonus: 1,
};

export const DEFAULT_TRAINING_UNITS: Record<string, SpawnUnitConfig> = {
  bogatyr: {
    id: "bogatyr",
    maxHealth: 12,
    maxAP: 2,
    mobility: 5,
    aim: 70,
    defense: 10,
    weapons: ["sword"],
  },
  strelets: {
    id: "strelets",
    maxHealth: 8,
    maxAP: 2,
    mobility: 6,
    aim: 85,
    defense: 0,
    weapons: ["bow"],
  },
  znaharka: {
    id: "znaharka",
    maxHealth: 7,
    maxAP: 2,
    mobility: 6,
    aim: 75,
    defense: 0,
    weapons: ["sling"],
  },
  upyr: {
    id: "upyr",
    maxHealth: 8,
    maxAP: 2,
    mobility: 5,
    aim: 60,
    defense: 0,
    weapons: ["claws"],
  },
};

export function defaultTrainingWeapons(): Record<string, WeaponStats> {
  return {
    [SWORD.id]: SWORD,
    [BOW.id]: BOW,
    [SLING.id]: SLING,
    [CLAWS.id]: CLAWS,
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
  };
}

export const TRAINING_BOGATYR_ID = 1;
export const TRAINING_STRELETS_ID = 2;
export const TRAINING_ZNAHARKA_ID = 3;
export const TRAINING_COVER_ID = 4;
export const TRAINING_UPYR_A_ID = 5;
export const TRAINING_UPYR_B_ID = 6;
export const TRAINING_UPYR_C_ID = 7;

function setZ(state: MatchState, x: number, y: number, z: number): void {
  const tile = tileAt(state.grid, x, y);
  if (tile) tile.z = z;
}

function setPit(state: MatchState, x: number, y: number): void {
  const tile = tileAt(state.grid, x, y);
  if (tile) tile.pit = true;
}

function setWall(state: MatchState, x: number, y: number): void {
  const tile = tileAt(state.grid, x, y);
  if (tile) tile.blockLOS = true;
}

function pickUnit(units: SpawnUnitConfig[] | undefined, id: string): SpawnUnitConfig {
  return units?.find((unit) => unit.id === id) ?? DEFAULT_TRAINING_UNITS[id] ?? DEFAULT_TRAINING_UNITS.upyr!;
}

function spawn(
  id: number,
  config: SpawnUnitConfig,
  owner: number,
  x: number,
  y: number,
  z: number,
  dir: number,
  extra: Partial<EntityState> = {},
): EntityState {
  const maxAp = extra.maxAp ?? config.maxAP;
  const weaponId = extra.weaponId ?? config.weapons[0] ?? "";
  return {
    id,
    configId: extra.configId ?? config.id,
    owner,
    x,
    y,
    z,
    dir,
    ap: extra.ap ?? maxAp,
    maxAp,
    mobility: config.mobility,
    hp: extra.hp ?? config.maxHealth,
    maxHp: config.maxHealth,
    aim: config.aim,
    defense: config.defense,
    weaponId,
    obstacle: extra.obstacle ?? true,
    dead: extra.dead ?? false,
    flying: extra.flying ?? false,
    coverType: extra.coverType ?? 0,
  };
}

/**
 * Фиксированная карта выпуска 0.4.0.
 * Три роли дружины против трёх неподвижных мишеней-упырей.
 */
export function createTrainingMatch(options: { units?: SpawnUnitConfig[] } = {}): MatchState {
  const grid = makeGrid(12, 8, 1);
  const state: MatchState = {
    turnNumber: 1,
    activeOwner: PLAYER_OWNER,
    grid,
    entities: [],
  };

  for (let x = 0; x < 12; x += 1) {
    setZ(state, x, 6, 0);
    setZ(state, x, 7, 0);
  }
  for (let x = 8; x < 12; x += 1) {
    for (let y = 0; y < 3; y += 1) setZ(state, x, y, 2);
  }

  setPit(state, 4, 3);
  setPit(state, 5, 5);
  setWall(state, 6, 0);
  setWall(state, 6, 1);

  const bogatyr = pickUnit(options.units, "bogatyr");
  const strelets = pickUnit(options.units, "strelets");
  const znaharka = pickUnit(options.units, "znaharka");
  const upyr = pickUnit(options.units, "upyr");

  const zAt = (x: number, y: number): number => tileAt(grid, x, y)?.z ?? 0;

  state.entities.push(
    spawn(TRAINING_BOGATYR_ID, bogatyr, PLAYER_OWNER, 4, 4, zAt(4, 4), 1),
    spawn(TRAINING_STRELETS_ID, strelets, PLAYER_OWNER, 2, 2, zAt(2, 2), 1),
    spawn(TRAINING_ZNAHARKA_ID, znaharka, PLAYER_OWNER, 2, 6, zAt(2, 6), 1),
    spawn(TRAINING_COVER_ID, upyr, 0, 8, 4, zAt(8, 4), 0, {
      configId: "cover",
      maxAp: 0,
      ap: 0,
      mobility: 0,
      hp: 2,
      weaponId: "",
      coverType: 2,
      aim: 0,
      defense: 0,
    }),
    spawn(TRAINING_UPYR_A_ID, upyr, ENEMY_OWNER, 8, 2, zAt(8, 2), 3, { maxAp: 0, ap: 0 }),
    spawn(TRAINING_UPYR_B_ID, upyr, ENEMY_OWNER, 9, 4, zAt(9, 4), 3, { maxAp: 0, ap: 0 }),
    spawn(TRAINING_UPYR_C_ID, upyr, ENEMY_OWNER, 8, 6, zAt(8, 6), 3, { maxAp: 0, ap: 0 }),
  );

  return state;
}
