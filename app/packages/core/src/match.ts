import { ENEMY_OWNER, PLAYER_OWNER } from "./debug-map.js";
import { tileAt } from "./grid.js";
import { createMulberry32 } from "./rng.js";
import { enemySpawns, generateBattlefield, playerSpawns, QUICK_MATCH_MAP, type MapGenConfig } from "./mapgen.js";
import { DEFAULT_TRAINING_UNITS, type SpawnUnitConfig } from "./training-map.js";
import type { EntityState, MatchState } from "./types.js";

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
): EntityState {
  const weaponId = config.weapons[0] ?? "";
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
    weaponId,
    obstacle: true,
    dead: false,
    flying: false,
    coverType: 0,
  };
}

export interface QuickMatchOptions {
  units?: SpawnUnitConfig[];
  map?: MapGenConfig;
  enemyPool?: readonly [string, string, string];
  enemyCount: number;
  seed: number;
}

/**
 * Случайная карта и случайный состав Нави. Численность задаётся трудностью.
 */
export function createQuickMatch(options: QuickMatchOptions): MatchState {
  const rng = createMulberry32(options.seed);
  const map = options.map ?? QUICK_MATCH_MAP;
  const pool = options.enemyPool ?? (["upyr", "leshy", "kikimora"] as const);
  const players = playerSpawns(map.height);
  const enemies = enemySpawns(options.enemyCount, map.width, map.height);
  const generated = generateBattlefield(map, rng, players, enemies);

  const bogatyr = pickUnit(options.units, "bogatyr");
  const strelets = pickUnit(options.units, "strelets");
  const znaharka = pickUnit(options.units, "znaharka");
  const roster = [bogatyr, strelets, znaharka];

  const state: MatchState = {
    turnNumber: 1,
    activeOwner: PLAYER_OWNER,
    grid: generated.grid,
    entities: [...generated.covers],
  };

  roster.forEach((config, index) => {
    const point = players[index] ?? players[0]!;
    const z = tileAt(generated.grid, point.x, point.y)?.z ?? 1;
    state.entities.push(spawn(index + 1, config, PLAYER_OWNER, point.x, point.y, z, 1));
  });

  enemies.forEach((point, index) => {
    const type = pool[rng.nextInt(0, pool.length - 1)] ?? "upyr";
    const config = pickUnit(options.units, type);
    const z = tileAt(generated.grid, point.x, point.y)?.z ?? 1;
    state.entities.push(spawn(10 + index, config, ENEMY_OWNER, point.x, point.y, z, 3));
  });

  return state;
}
