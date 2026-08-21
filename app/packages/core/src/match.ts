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

function spawn(id: number, config: SpawnUnitConfig, owner: number, x: number, y: number, z: number, dir: number): EntityState {
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
    obstacle: true,
    dead: false,
    flying: config.tags?.includes("flying") ?? false,
    hidden: config.tags?.includes("hiddenStart") ?? false,
    decoy: config.decoy ?? false,
    coverType: 0,
    overwatch: false,
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
    const point = players[index] ?? players[0]!;
    const z = tileAt(generated.grid, point.x, point.y)?.z ?? 1;
    state.entities.push(spawn(index + 1, config, PLAYER_OWNER, point.x, point.y, z, 1));
  });

  enemies.forEach((point, index) => {
    const type = pool[rng.nextInt(0, pool.length - 1)] ?? pool[0];
    const config = pickUnit(options.units, type);
    const z = tileAt(generated.grid, point.x, point.y)?.z ?? 1;
    state.entities.push(spawn(10 + index, config, ENEMY_OWNER, point.x, point.y, z, 3));
  });
  state.rngState = String(rng.getState());
  return state;
}
