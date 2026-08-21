import { ENEMY_OWNER, PLAYER_OWNER } from "./debug-map.js";
import { tileAt } from "./grid.js";
import { createMulberry32 } from "./rng.js";
import { enemySpawns, generateBattlefield, playerSpawns, QUICK_MATCH_MAP, type MapGenConfig } from "./mapgen.js";
import { DEFAULT_TRAINING_UNITS, type SpawnUnitConfig } from "./defaults.js";
import type { EntityState, MatchState } from "./types.js";

function pickUnit(units: SpawnUnitConfig[] | undefined, id: string): SpawnUnitConfig {
  if (units) {
    const found = units.find((unit) => unit.id === id);
    if (!found) throw new Error(`Unknown unit config: ${id}`);
    return found;
  }
  const fallback = DEFAULT_TRAINING_UNITS[id];
  if (!fallback) throw new Error(`Unknown training unit: ${id}`);
  return fallback;
}

export function spawnUnitState(id: number, config: SpawnUnitConfig, owner: number, x: number, y: number, z: number, dir: number): EntityState {
  const weaponIds = [...config.weapons];
  return {
    id,
    configId: config.id,
    owner,
    x,
    y,
    z,
    dir,
    ap: config.maxAP,
    maxAp: config.maxAP,
    mobility: config.mobility,
    hp: config.maxHealth,
    maxHp: config.maxHealth,
    aim: config.aim,
    defense: config.defense,
    will: config.will ?? 0,
    vision: config.vision,
    weaponId: weaponIds[0] ?? "",
    weaponIds,
    skillIds: [...(config.skills ?? [])],
    skillCooldowns: {},
    skillUses: {},
    obstacle: true,
    dead: false,
    flying: config.tags?.includes("flying") ?? false,
    hidden: config.tags?.includes("hiddenStart") ?? false,
    decoy: config.decoy ?? false,
    timedLife: config.timedLife,
    countsForElimination: true,
    fleeHp: config.fleeHp,
    camouflageMinCover: config.camouflageMinCover ?? false,
    providesCamouflage: config.providesCamouflage ?? false,
    coverType: 0,
    overwatch: false,
    defending: false,
    movementSpent: 0,
  };
}

export interface QuickMatchOptions {
  units?: SpawnUnitConfig[];
  map?: MapGenConfig;
  playerSlots?: readonly [string, string, string];
  enemyPool?: readonly [string, string, string];
  enemyCount: number;
  seed: number;
}

export type RosterMods = {
  aimMod?: number;
  defenseMod?: number;
  mobilityMod?: number;
  /** Изменение максимума здоровья высадки (снаряжение). */
  maxHpMod?: number;
  /** Дополнительное оружие из снаряжения. */
  extraWeaponIds?: readonly string[];
  /** Начальный запас здоровья высадки (сохранённый после прошлой миссии). */
  hp?: number;
};

export interface RosterSlot extends RosterMods {
  /** Запись юнита высадки. */
  unitId: string;
}

export interface MissionMatchOptions {
  units: SpawnUnitConfig[];
  map: MapGenConfig;
  /** Высадка: записи бойцов, от одного до пяти. */
  playerSlots: readonly (string | RosterSlot)[];
  /** Состав противников миссии: тип и число. */
  enemies: readonly { unitId: string; count: number }[];
  seed: number;
}

/**
 * Сражение миссии кампании: карта из конфигурации миссии и явный состав
 * противников. Состав появления противников детерминирован порядком записей.
 */
export function createMissionMatch(options: MissionMatchOptions): MatchState {
  const rng = createMulberry32(options.seed);
  const map = options.map;
  const players = playerSpawns(map.height);
  const expanded: string[] = [];
  for (const entry of options.enemies) {
    for (let index = 0; index < entry.count; index += 1) expanded.push(entry.unitId);
  }
  const enemies = enemySpawns(expanded.length, map.width, map.height);
  if (enemies.length !== expanded.length) {
    throw new Error(`Map ${map.width}x${map.height} has only ${enemies.length} enemy spawn cells for requested ${expanded.length}`);
  }
  const generated = generateBattlefield(map, rng, players, enemies);
  const roster = options.playerSlots.map((slot) => {
    const unitId = typeof slot === "string" ? slot : slot.unitId;
    const mods: RosterMods = typeof slot === "string" ? {} : slot;
    return { unitId, mods };
  });

  const state: MatchState = {
    turnNumber: 1,
    activeOwner: PLAYER_OWNER,
    grid: generated.grid,
    entities: [...generated.covers],
    rngSeed: String(options.seed >>> 0),
    rngState: String(rng.getState()),
  };

  roster.forEach((entry, index) => {
    const config = pickUnit(options.units, entry.unitId);
    const point = players[index];
    if (!point) {
      throw new Error(`Deployment of ${roster.length} fighters exceeds ${players.length} player spawn cells`);
    }
    const z = tileAt(generated.grid, point.x, point.y)?.z ?? 1;
    const spawned = spawnUnitState(index + 1, config, PLAYER_OWNER, point.x, point.y, z, 1);
    if (entry.mods.aimMod) spawned.aim += entry.mods.aimMod;
    if (entry.mods.defenseMod) spawned.defense += entry.mods.defenseMod;
    if (entry.mods.mobilityMod) spawned.mobility = Math.max(1, spawned.mobility + entry.mods.mobilityMod);
    if (entry.mods.maxHpMod) {
      spawned.maxHp = Math.max(1, spawned.maxHp + entry.mods.maxHpMod);
      if (spawned.hp > spawned.maxHp) spawned.hp = spawned.maxHp;
    }
    if (entry.mods.extraWeaponIds) {
      const owned = new Set(spawned.weaponIds);
      const extra: string[] = [];
      for (const weaponId of entry.mods.extraWeaponIds) {
        if (owned.has(weaponId)) continue;
        owned.add(weaponId);
        extra.push(weaponId);
      }
      spawned.weaponIds = [...(spawned.weaponIds ?? []), ...extra];
      if (spawned.weaponId === "" && extra.length > 0) spawned.weaponId = extra[0]!;
    }
    if (entry.mods.hp !== undefined) spawned.hp = Math.max(1, Math.min(spawned.maxHp, entry.mods.hp));
    state.entities.push(spawned);
  });

  enemies.forEach((point, index) => {
    const type = expanded[index]!;
    const config = pickUnit(options.units, type);
    const z = tileAt(generated.grid, point.x, point.y)?.z ?? 1;
    state.entities.push(spawnUnitState(10 + index, config, ENEMY_OWNER, point.x, point.y, z, 3));
  });
  state.rngState = String(rng.getState());
  return state;
}

/** Случайная карта и случайный состав Нави. Численность задаётся трудностью. */
export function createQuickMatch(options: QuickMatchOptions): MatchState {
  const rng = createMulberry32(options.seed);
  const map = options.map ?? QUICK_MATCH_MAP;
  const slots = options.playerSlots ?? (["bogatyr", "strelets", "znaharka"] as const);
  const pool = options.enemyPool ?? (["upyr", "leshy", "kikimora"] as const);
  const players = playerSpawns(map.height);
  const enemies = enemySpawns(options.enemyCount, map.width, map.height);
  if (enemies.length !== options.enemyCount) {
    throw new Error(`Map ${map.width}x${map.height} has only ${enemies.length} enemy spawn cells for requested ${options.enemyCount}`);
  }
  const generated = generateBattlefield(map, rng, players, enemies);
  const roster = slots.map((id) => pickUnit(options.units, id));

  const state: MatchState = {
    turnNumber: 1,
    activeOwner: PLAYER_OWNER,
    grid: generated.grid,
    entities: [...generated.covers],
    rngSeed: String(options.seed >>> 0),
    rngState: String(rng.getState()),
  };

  roster.forEach((config, index) => {
    const point = players[index];
    if (!point) {
      throw new Error(`Quick match roster of ${roster.length} exceeds ${players.length} player spawn cells`);
    }
    const z = tileAt(generated.grid, point.x, point.y)?.z ?? 1;
    state.entities.push(spawnUnitState(index + 1, config, PLAYER_OWNER, point.x, point.y, z, 1));
  });

  enemies.forEach((point, index) => {
    const type = pool[rng.nextInt(0, pool.length - 1)] ?? pool[0];
    const config = pickUnit(options.units, type);
    const z = tileAt(generated.grid, point.x, point.y)?.z ?? 1;
    state.entities.push(spawnUnitState(10 + index, config, ENEMY_OWNER, point.x, point.y, z, 3));
  });
  state.rngState = String(rng.getState());
  return state;
}
