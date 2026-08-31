import { distH } from "./grid.js";
import { hasLineOfSight } from "./los.js";
import { effectiveRange } from "./range.js";
import type { EntityState, Grid, MatchState } from "./types.js";

/**
 * Документ математики, §8.1. Клетка T наблюдается юнитом U тогда и только тогда,
 * когда одновременно:
 *   1. InRange(U, T, vision) с поправкой высоты (§3);
 *   2. Существует линия наблюдения из U в T.
 *
 * Ориентация обзор не ограничивает.
 */
function isCellObservedByUnit(grid: Grid, unit: EntityState, tileX: number, tileY: number, tileZ: number): boolean {
  if (unit.dead || unit.coverType > 0) return false;
  // Собственная клетка наблюдается всегда: DistH = 0 ≤ effectiveRange для любой
  // дальности обзора, включая vision = 0 (§8.1 math: InRange(U, T, vision)).
  const d = distH(unit.x, unit.y, tileX, tileY);
  if (d === 0) return true;
  if (unit.vision <= 0) return false;
  const maxRange = effectiveRange(unit.z, tileZ, unit.vision);
  if (d > maxRange) return false;
  return hasLineOfSight(grid, unit.x, unit.y, unit.z, tileX, tileY, tileZ);
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * Вычислить множество клеток, наблюдаемых всеми живыми юнитами заданной стороны.
 */
export function computeVisibleCells(state: MatchState, owner: number): Set<string> {
  const visible = new Set<string>();
  // Фильтр не исключает юнитов с vision = 0: собственная клетка наблюдается
  // при любой дальности обзора (§8.1), остальные клетки отсеет isCellObservedByUnit.
  const observers = state.entities.filter((entity) => !entity.dead && entity.coverType === 0 && entity.owner === owner);
  if (observers.length === 0) return visible;

  for (const tile of state.grid.tiles) {
    for (const unit of observers) {
      if (isCellObservedByUnit(state.grid, unit, tile.x, tile.y, tile.z)) {
        visible.add(cellKey(tile.x, tile.y));
        break;
      }
    }
  }
  return visible;
}

/** Состояние тумана войны для одной стороны. */
export interface FogOfOwner {
  /** Клетки, которые сторона когда-либо наблюдала. */
  explored: Set<string>;
  /** Клетки, которые сторона наблюдает прямо сейчас. */
  visible: Set<string>;
}

export interface FogState {
  [owner: number]: FogOfOwner;
}

/** Создать начальное состояние тумана: разведать клетки вокруг стартовых юнитов стороны. */
export function createFogState(state: MatchState, owners: number[]): FogState {
  const fog: FogState = {};
  for (const owner of owners) {
    const visible = computeVisibleCells(state, owner);
    fog[owner] = { explored: new Set(visible), visible };
  }
  return fog;
}

/**
 * Обновить туман после изменения состояния мира. Запись для стороны
 * создаётся при её первом появлении на поле: скриптовые подкрепления и
 * противники пролога выходят на карту уже после старта партии.
 */
export function refreshFog(fog: FogState, state: MatchState, owners: number[]): void {
  for (const owner of owners) {
    const visible = computeVisibleCells(state, owner);
    const entry = fog[owner];
    if (!entry) {
      fog[owner] = { explored: new Set(visible), visible };
      continue;
    }
    for (const key of visible) entry.explored.add(key);
    entry.visible = visible;
  }
}

/** Разряд клетки по §8.3 для заданной стороны. */
export type CellVisibility = "hidden" | "explored" | "visible";

export function cellVisibility(fog: FogOfOwner | undefined, key: string): CellVisibility {
  if (!fog) return "visible";
  if (fog.visible.has(key)) return "visible";
  if (fog.explored.has(key)) return "explored";
  return "hidden";
}
