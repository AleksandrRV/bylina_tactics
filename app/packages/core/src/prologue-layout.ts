import { makeGrid, tileAt } from "./grid.js";
import type { EntityState, Grid, MatchState } from "./types.js";
import { spawnUnitState } from "./match.js";
import type { SpawnUnitConfig } from "./defaults.js";
import { PLAYER_OWNER, ENEMY_OWNER } from "./debug-map.js";

/**
 * Авторская раскладка пролога (ASCII-строки). Семантика символов:
 * `.` пусто, `t` декорация (не блокирует), `P` яма, `W` стена (blockLOS),
 * `c` полуукрытие, `E` эвакуация, `M`/`A`/`V` игроки, `F`/`S`/`U`/`K`/`H` метки.
 * Трясина (`V` с флагом bog) — immobile, не pit.
 */

export interface PrologueLayout {
  rows: string[];
  /**
   * Ярусы рельефа по строкам (0.20.37). Один символ на клетку ряда:
   * `0`/`1`/`2` — ярус, любой другой символ (обычно `-`) — ярус по умолчанию.
   *
   * Отдельный параллельный массив, а не цифры внутри `rows`: любой символ
   * строки, не входящий в служебный набор `. P W E c`, становится маркером и
   * попадает в `markers` — цифры в `rows` засорили бы раскладку ложными
   * маркерами.
   */
  heights?: string[];
  legend?: Record<string, unknown>;
}

export interface CompiledLayout {
  grid: Grid;
  covers: EntityState[];
  markers: Record<string, { x: number; y: number }[]>;
  extractCells: { x: number; y: number }[];
}

/**
 * Назначить клеткам ярусы из параллельного массива `heights`. Символы
 * `0`/`1`/`2` задают ярус; всё остальное (включая отсутствующий символ и
 * лишние строки) оставляет клетку на ярусе по умолчанию. Расхождение числа
 * строк и длин строк с `rows` не считается ошибкой: раскладка остаётся
 * валидной, просто часть клеток наследует `defaultZ`.
 */
function applyHeights(grid: Grid, heights: readonly string[] | undefined): void {
  if (!heights) return;
  for (let y = 0; y < grid.height; y += 1) {
    const row = heights[y];
    if (!row) continue;
    for (let x = 0; x < grid.width; x += 1) {
      const ch = row[x];
      if (ch !== "0" && ch !== "1" && ch !== "2") continue;
      const tile = tileAt(grid, x, y);
      if (tile) tile.z = Number(ch) as 0 | 1 | 2;
    }
  }
}

function coverEntity(id: number, x: number, y: number, z: number, coverType: 1 | 2, obstacle: boolean): EntityState {
  return {
    id,
    configId: "cover",
    owner: 0,
    x,
    y,
    z,
    dir: 0,
    ap: 0,
    maxAp: 0,
    mobility: 0,
    hp: 2,
    maxHp: 2,
    aim: 0,
    defense: 0,
    vision: 0,
    weaponId: "",
    obstacle,
    dead: false,
    flying: false,
    coverType,
    overwatch: false,
    defending: false,
    movementSpent: 0,
  };
}

export function compilePrologueLayout(layout: PrologueLayout, options: { defaultZ?: 0 | 1 | 2 } = {}): CompiledLayout {
  const rows = layout.rows.map((row) => row.replace(/\s+/g, ""));
  const height = rows.length;
  const width = Math.max(0, ...rows.map((row) => row.length));
  const z = options.defaultZ ?? 1;
  const grid = makeGrid(width, height, z);
  applyHeights(grid, layout.heights);
  const covers: EntityState[] = [];
  const markers: Record<string, { x: number; y: number }[]> = {};
  const extractCells: { x: number; y: number }[] = [];
  let coverId = 200;

  const pushMarker = (key: string, x: number, y: number): void => {
    markers[key] ??= [];
    markers[key]!.push({ x, y });
  };

  for (let y = 0; y < height; y += 1) {
    const row = rows[y] ?? "";
    for (let x = 0; x < width; x += 1) {
      const ch = row[x] ?? ".";
      const tile = tileAt(grid, x, y);
      if (!tile) continue;
      if (ch === "P") tile.pit = true;
      if (ch === "W") tile.blockLOS = true;
      if (ch === "E") {
        tile.extract = true;
        extractCells.push({ x, y });
      }
      if (ch === "c") {
        covers.push(coverEntity(coverId++, x, y, tile.z, 1, true));
      }
      if (ch !== "." && ch !== "P" && ch !== "W" && ch !== "E" && ch !== "c") {
        pushMarker(ch, x, y);
      }
    }
  }

  return { grid, covers, markers, extractCells };
}

export function createLayoutMatch(
  layout: PrologueLayout,
  units: { config: SpawnUnitConfig; owner: number; marker: string }[],
  seed = 1,
): MatchState {
  const compiled = compilePrologueLayout(layout);
  const entities: EntityState[] = [...compiled.covers];
  let id = 1;
  for (const entry of units) {
    const pos = compiled.markers[entry.marker]?.[0];
    if (!pos) continue;
    const tile = tileAt(compiled.grid, pos.x, pos.y);
    const spawned = spawnUnitState(id++, entry.config, entry.owner, pos.x, pos.y, tile?.z ?? 1, entry.owner === PLAYER_OWNER ? 1 : 3);
    if (entry.marker === "V" && layout.legend?.bog) {
      spawned.immobileTurns = 99;
    }
    entities.push(spawned);
  }
  return {
    turnNumber: 1,
    activeOwner: PLAYER_OWNER,
    grid: compiled.grid,
    entities,
    rngSeed: String(seed >>> 0),
    rngState: String(seed >>> 0),
  };
}

export { PLAYER_OWNER, ENEMY_OWNER };
