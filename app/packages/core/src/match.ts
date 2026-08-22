import { ENEMY_OWNER, PLAYER_OWNER } from "./debug-map.js";
import { tileAt } from "./grid.js";
import { createMulberry32 } from "./rng.js";
import { enemySpawns, generateBattlefield, playerSpawns, QUICK_MATCH_MAP, type MapGenConfig } from "./mapgen.js";
import { DEFAULT_TRAINING_UNITS, type SpawnUnitConfig } from "./defaults.js";
import type { EntityState, Grid, MatchState, MissionObjective } from "./types.js";

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

export function spawnUnitState(
  id: number,
  config: SpawnUnitConfig,
  owner: number,
  x: number,
  y: number,
  z: number,
  dir: number,
  rosterIndex?: number,
): EntityState {
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
    rosterIndex,
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
  /** Цель миссии: уничтожение объекта, спасение лица, разведка (0.13.0). */
  objective?: MissionObjective;
  /** Генералы миссии (0.18.0): записи из конфигурации сценария (base-design §6.2). */
  generals?: readonly string[];
  /** Генералы, погибшие ранее в кампании: не появляются вновь (0.18.0). */
  excludedGenerals?: readonly string[];
  seed: number;
}

/** Ближайшая свободная клетка к точке (x0, y0): без ямы, стены, укрытия и сущности. */
function freeCellNear(
  grid: Grid,
  covers: readonly EntityState[],
  entities: readonly EntityState[],
  x0: number,
  y0: number,
): { x: number; y: number } | null {
  const limit = Math.max(grid.width, grid.height);
  for (let r = 0; r < limit; r += 1) {
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = x0 + dx;
        const y = y0 + dy;
        const tile = tileAt(grid, x, y);
        if (!tile || tile.pit || tile.blockLOS) continue;
        if (covers.some((cover) => cover.x === x && cover.y === y)) continue;
        if (entities.some((entity) => !entity.dead && entity.obstacle && entity.x === x && entity.y === y)) continue;
        return { x, y };
      }
    }
  }
  return null;
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
    objective: options.objective,
  };

  roster.forEach((entry, index) => {
    const config = pickUnit(options.units, entry.unitId);
    const point = players[index];
    if (!point) {
      throw new Error(`Deployment of ${roster.length} fighters exceeds ${players.length} player spawn cells`);
    }
    const z = tileAt(generated.grid, point.x, point.y)?.z ?? 1;
    const spawned = spawnUnitState(index + 1, config, PLAYER_OWNER, point.x, point.y, z, 1, index);
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

  // Генералы (0.18.0): появляются у восточного края по правилам конфигурации
  // миссии. Погибшие ранее в кампании генералы не возвращаются.
  const generals = (options.generals ?? []).filter((generalId) => !(options.excludedGenerals ?? []).includes(generalId));
  generals.forEach((generalId, index) => {
    const config = pickUnit(options.units, generalId);
    const point = freeCellNear(generated.grid, generated.covers, state.entities, state.grid.width - 3, Math.floor(state.grid.height / 2));
    if (!point) throw new Error(`No free spawn cell for general ${generalId}`);
    const z = tileAt(generated.grid, point.x, point.y)?.z ?? 1;
    state.entities.push(spawnUnitState(500 + index, config, ENEMY_OWNER, point.x, point.y, z, 3));
  });

  // Разведка: сценарий даёт бойцам высадки действие эвакуации — любой из них
  // может покинуть поле из зоны эвакуации (base-design §3.2, тип «Разведка»).
  if (options.objective?.kind === "recon") {
    for (const entity of state.entities) {
      if (entity.owner === PLAYER_OWNER && entity.coverType === 0 && entity.maxAp > 0 && !(entity.skillIds ?? []).includes("evacuate")) {
        entity.skillIds = [...(entity.skillIds ?? []), "evacuate"];
      }
    }
  }

  // Цель миссии: идол/строение для уничтожения у восточного края, сопровождаемый
  // для спасения рядом с высадкой. Уникальные идентификаторы 1000/1001 не
  // пересекаются с бойцами (1…5) и противниками (10+).
  const objective = options.objective;
  if (objective?.kind === "destroy") {
    const config = pickUnit(options.units, objective.unitId);
    const point = freeCellNear(generated.grid, generated.covers, state.entities, state.grid.width - 3, Math.floor(state.grid.height / 2));
    if (!point) throw new Error(`No free spawn cell for objective ${objective.unitId}`);
    const z = tileAt(generated.grid, point.x, point.y)?.z ?? 1;
    const idol = spawnUnitState(1000, config, 0, point.x, point.y, z, 3);
    idol.ap = 0;
    idol.maxAp = 0;
    idol.countsForElimination = false;
    state.entities.push(idol);
  }
  if (objective?.kind === "rescue") {
    const config = pickUnit(options.units, objective.unitId);
    const point = freeCellNear(generated.grid, generated.covers, state.entities, 2, Math.floor(state.grid.height / 2));
    if (!point) throw new Error(`No free spawn cell for escortee ${objective.unitId}`);
    const z = tileAt(generated.grid, point.x, point.y)?.z ?? 1;
    const escortee = spawnUnitState(1001, config, PLAYER_OWNER, point.x, point.y, z, 1);
    escortee.countsForElimination = false;
    state.entities.push(escortee);
  }
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

export interface PvpMatchOptions {
  units: SpawnUnitConfig[];
  map: MapGenConfig;
  /** Состав стороны 1 (записи из общего набора). */
  side1: readonly string[];
  /** Состав стороны 2. */
  side2: readonly string[];
  /** Условие победы (0.16.0): уничтожение либо вынос предмета «молодильное яблоко». */
  objective?: "elimination" | "apple";
  seed: number;
}

/**
 * Сражение состязательного режима «Потешные бои» (base-design §7, roadmap 0.14.0).
 * Две стороны на одном поле: сторона 1 появляется у западного края, сторона 2 —
 * у восточного. Условие победы — уничтожение всех юнитов противника либо вынос
 * предмета «молодильное яблоко» на клетку домашнего края своей стороны (math §17).
 */
export function createPvpMatch(options: PvpMatchOptions): MatchState {
  const rng = createMulberry32(options.seed);
  const map = options.map;
  const allSide1Spawns = playerSpawns(map.height);
  if (options.side1.length > allSide1Spawns.length) {
    throw new Error(`Map ${map.width}x${map.height} has only ${allSide1Spawns.length} side-1 spawn cells for requested ${options.side1.length}`);
  }
  const side1Spawns = allSide1Spawns.slice(0, options.side1.length);
  const side2Spawns = enemySpawns(options.side2.length, map.width, map.height);
  if (side2Spawns.length !== options.side2.length) {
    throw new Error(`Map ${map.width}x${map.height} has only ${side2Spawns.length} side-2 spawn cells for requested ${options.side2.length}`);
  }
  const generated = generateBattlefield(map, rng, side1Spawns, side2Spawns);

  const state: MatchState = {
    turnNumber: 1,
    activeOwner: PLAYER_OWNER,
    grid: generated.grid,
    entities: [...generated.covers],
    rngSeed: String(options.seed >>> 0),
    rngState: String(rng.getState()),
  };

  side1Spawns.forEach((point, index) => {
    const config = pickUnit(options.units, options.side1[index]!);
    const z = tileAt(generated.grid, point.x, point.y)?.z ?? 1;
    state.entities.push(spawnUnitState(index + 1, config, PLAYER_OWNER, point.x, point.y, z, 1));
  });
  side2Spawns.forEach((point, index) => {
    const config = pickUnit(options.units, options.side2[index]!);
    const z = tileAt(generated.grid, point.x, point.y)?.z ?? 1;
    state.entities.push(spawnUnitState(10 + index, config, ENEMY_OWNER, point.x, point.y, z, 3));
  });

  // Предмет «молодильное яблоко» (math §17): клетки домашнего края — западный
  // край для стороны 1, восточный для стороны 2; предмет лежит в центре поля.
  if (options.objective === "apple") {
    for (let y = 1; y <= map.height - 2; y += 1) {
      const west = tileAt(generated.grid, 0, y);
      const east = tileAt(generated.grid, map.width - 1, y);
      if (west) west.homeOwner = PLAYER_OWNER;
      if (east) east.homeOwner = ENEMY_OWNER;
    }
    const midX = Math.floor(map.width / 2);
    const midY = Math.floor(map.height / 2);
    const appleCell = freeCellNear(generated.grid, generated.covers, state.entities, midX, midY);
    if (!appleCell) throw new Error("No free cell for the apple objective");
    state.apple = { pos: { x: appleCell.x, y: appleCell.y, z: tileAt(generated.grid, appleCell.x, appleCell.y)?.z ?? 1 }, carrierId: null };
  }

  state.rngState = String(rng.getState());
  return state;
}
