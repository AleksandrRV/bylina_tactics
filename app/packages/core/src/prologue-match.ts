import { ENEMY_OWNER, PLAYER_OWNER } from "./debug-map.js";
import type { SpawnUnitConfig } from "./defaults.js";
import { tileAt } from "./grid.js";
import { spawnUnitState } from "./match.js";
import { compilePrologueLayout, type PrologueLayout } from "./prologue-layout.js";
import type { EntityState, MatchState } from "./types.js";

export interface PrologueMatchOptions {
  layout: PrologueLayout;
  units: SpawnUnitConfig[];
  seed?: number;
  /** Скрыть клетки эвакуации до сюжетного момента (М2). */
  hideExtract?: boolean;
}

function pickUnit(units: SpawnUnitConfig[], id: string): SpawnUnitConfig {
  const found = units.find((unit) => unit.id === id);
  if (!found) throw new Error(`Unknown prologue unit: ${id}`);
  return found;
}

function stickEntity(id: number, x: number, y: number, z: number): EntityState {
  return {
    id,
    configId: "stick",
    owner: 0,
    x,
    y,
    z,
    dir: 0,
    ap: 0,
    maxAp: 0,
    mobility: 0,
    hp: 1,
    maxHp: 1,
    aim: 0,
    defense: 0,
    vision: 0,
    weaponId: "",
    obstacle: false,
    dead: false,
    flying: false,
    coverType: 0,
    overwatch: false,
    defending: false,
    movementSpent: 0,
    countsForElimination: false,
  };
}

/**
 * Стартовая партия миссии пролога по авторской раскладке.
 * Скриптовые враги (legend.scripted) не появляются до контроллера.
 */
export function createPrologueMatch(options: PrologueMatchOptions): MatchState {
  const compiled = compilePrologueLayout(options.layout);
  if (options.hideExtract) {
    for (const tile of compiled.grid.tiles) tile.extract = false;
  }
  const entities: EntityState[] = [...compiled.covers];
  let id = 1;
  const legend = (options.layout.legend ?? {}) as Record<
    string,
    {
      kind?: string;
      unitId?: string;
      side?: string;
      scripted?: boolean;
      state?: string;
      itemId?: string;
      weapons?: string[];
    }
  >;

  const spawnAt = (marker: string, unitId: string, owner: number, extra?: (entity: EntityState) => void): void => {
    for (const pos of compiled.markers[marker] ?? []) {
      const tile = tileAt(compiled.grid, pos.x, pos.y);
      const spawned = spawnUnitState(
        id++,
        pickUnit(options.units, unitId),
        owner,
        pos.x,
        pos.y,
        tile?.z ?? 1,
        owner === PLAYER_OWNER ? 1 : 3,
      );
      if (spawned.configId === "strelets") {
        spawned.skillIds = (spawned.skillIds ?? []).filter((skillId) => skillId !== "aimed_eye");
      }
      extra?.(spawned);
      entities.push(spawned);
    }
  };

  for (const [ch, entry] of Object.entries(legend)) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.kind === "pickup") {
      const pos = compiled.markers[ch]?.[0];
      if (pos) {
        const tile = tileAt(compiled.grid, pos.x, pos.y);
        entities.push(stickEntity(id++, pos.x, pos.y, tile?.z ?? 1));
      }
      continue;
    }
    if (entry.kind === "stranded" && entry.unitId) {
      spawnAt(ch, entry.unitId, PLAYER_OWNER, (entity) => {
        entity.immobileTurns = 99;
        entity.countsForElimination = false;
        entity.maxAp = 0;
        entity.ap = 0;
      });
      continue;
    }
    if (entry.kind === "spawn" && entry.unitId) {
      if (entry.scripted) continue;
      const owner = entry.side === "enemy" ? ENEMY_OWNER : PLAYER_OWNER;
      spawnAt(ch, entry.unitId, owner, (entity) => {
        // Снаряжение из раскладки (0.20.45): М2 продолжает М1, и герой
        // выходит на ночь уже с дубиной — канон §6.1 и реплика «их будет
        // больше, чем палки». В М1 того же поля нет: дубину он найдёт.
        if (!entry.weapons || entry.weapons.length === 0) return;
        entity.weaponIds = [...entry.weapons];
        entity.weaponId = entry.weapons[0]!;
      });
    }
  }

  return {
    turnNumber: 1,
    activeOwner: PLAYER_OWNER,
    grid: compiled.grid,
    entities,
    rngSeed: String((options.seed ?? 1) >>> 0),
    rngState: String((options.seed ?? 1) >>> 0),
  };
}

export { PLAYER_OWNER, ENEMY_OWNER };
