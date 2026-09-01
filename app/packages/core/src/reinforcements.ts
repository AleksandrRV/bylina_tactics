import { tileAt } from "./grid.js";
import { PLAYER_OWNER, ENEMY_OWNER } from "./debug-map.js";
import type { CellPos, EntityState, MatchState } from "./types.js";
import type { FogState } from "./fog.js";

type ReinforcementMode = "threshold" | "onKill";
type SpawnEdge = "north" | "south" | "east" | "west";

export interface ReinforcementsConfig {
  enabled?: boolean;
  mode?: ReinforcementMode;
  thresholdEnemyCount?: number;
  delayTurns?: number;
  pool: string[];
  countPerWave?: number;
  maxConcurrentEnemies: number;
  spawnEdge?: SpawnEdge;
  spawnCells?: { x: number; y: number }[];
  perKill?: number;
  perTurnNoKill?: number;
}

export interface ReinforcementsState {
  timer: number | null;
  telegraph: CellPos[];
  pendingCount: number;
  killsThisNavTurn: number;
  /**
   * Номер хода, в котором сервис уже отработал (0.21.19).
   *
   * Сервис вызывается перед каждой командой хода Нави, а подкрепление
   * приходит один раз за ход (campaign.md §12.1, §7.2 п. 10). Без этой
   * метки каждый вызов добавлял свою порцию: в М2 за один ход Нави
   * выходило до девяноста крыс вместо одной-двух.
   */
  tickedTurn: number | null;
}

interface ReinforcementTick {
  state: ReinforcementsState;
  telegraph: CellPos[];
  spawns: { unitId: string; at: CellPos }[];
}

/**
 * Живые противники, которых держит потолок подкреплений (campaign.md §12.1).
 *
 * Считается всякий живой боец Нави, кроме ложных целей: идол и иллюзии не
 * противники. Пометка «в счёт истребления» здесь роли не играет — это
 * признак условия победы, а не численности. В М2 вся стая выходит с
 * `countsForElimination: false` (миссия выигрывается эвакуацией, а не
 * истреблением, §7.2), и прежний счёт по этой пометке видел на поле ноль
 * противников: потолок восемь не наступал никогда, и стая росла без конца.
 */
function livingEnemies(match: MatchState): EntityState[] {
  return match.entities.filter(
    (entity) => !entity.dead && entity.owner === ENEMY_OWNER && entity.coverType === 0 && !entity.decoy,
  );
}

function occupied(match: MatchState, x: number, y: number): boolean {
  return match.entities.some((entity) => !entity.dead && entity.obstacle && entity.x === x && entity.y === y);
}

function edgeCells(match: MatchState, edge: SpawnEdge): CellPos[] {
  const { width, height } = match.grid;
  const cells: CellPos[] = [];
  if (edge === "north") {
    for (let x = 0; x < width; x += 1) {
      const tile = tileAt(match.grid, x, 0);
      if (tile) cells.push({ x, y: 0, z: tile.z });
    }
  } else if (edge === "south") {
    for (let x = 0; x < width; x += 1) {
      const tile = tileAt(match.grid, x, height - 1);
      if (tile) cells.push({ x, y: height - 1, z: tile.z });
    }
  } else if (edge === "west") {
    for (let y = 0; y < height; y += 1) {
      const tile = tileAt(match.grid, 0, y);
      if (tile) cells.push({ x: 0, y, z: tile.z });
    }
  } else {
    for (let y = 0; y < height; y += 1) {
      const tile = tileAt(match.grid, width - 1, y);
      if (tile) cells.push({ x: width - 1, y, z: tile.z });
    }
  }
  return cells;
}

function candidateCells(match: MatchState, config: ReinforcementsConfig, fog?: FogState): CellPos[] {
  const listed = config.spawnCells?.map((cell) => {
    const tile = tileAt(match.grid, cell.x, cell.y);
    return { x: cell.x, y: cell.y, z: tile?.z ?? 1 };
  });
  const pool = listed && listed.length > 0 ? listed : edgeCells(match, config.spawnEdge ?? "north");
  const visible = fog?.[PLAYER_OWNER]?.visible;
  const free = pool.filter((cell) => {
    const tile = tileAt(match.grid, cell.x, cell.y);
    if (!tile || tile.pit || tile.blockLOS) return false;
    if (occupied(match, cell.x, cell.y)) return false;
    return true;
  });
  const hidden = visible ? free.filter((cell) => !visible.has(`${cell.x},${cell.y}`)) : free;
  return hidden.length > 0 ? hidden : free;
}

export function createReinforcementsState(): ReinforcementsState {
  return { timer: null, telegraph: [], pendingCount: 0, killsThisNavTurn: 0, tickedTurn: null };
}

export function noteEnemyKill(state: ReinforcementsState): ReinforcementsState {
  return { ...state, killsThisNavTurn: state.killsThisNavTurn + 1 };
}

/**
 * Тик сервиса в начале хода Нави. Возвращает телеграф и фактические спавны.
 */
export function tickReinforcements(
  match: MatchState,
  config: ReinforcementsConfig,
  state: ReinforcementsState,
  fog?: FogState,
): ReinforcementTick {
  if (config.enabled === false) {
    return { state, telegraph: [], spawns: [] };
  }
  // Один тик на ход (0.21.19): сервис вызывается перед каждой командой
  // Нави, а подкрепление приходит один раз за ход. Повторный вызов в том же
  // ходу ничего не меняет, но и не гасит телеграф, уже показанный игроку.
  if (state.tickedTurn === match.turnNumber) {
    return { state, telegraph: state.telegraph, spawns: [] };
  }
  const living = livingEnemies(match).length;
  const cap = config.maxConcurrentEnemies;
  const mode = config.mode ?? "threshold";
  const delay = config.delayTurns ?? 1;
  const next: ReinforcementsState = { ...state, tickedTurn: match.turnNumber, telegraph: [] };

  if (mode === "onKill") {
    const extra =
      state.killsThisNavTurn > 0 ? (config.perKill ?? 2) * state.killsThisNavTurn : (config.perTurnNoKill ?? 1);
    const room = Math.max(0, cap - living);
    const count = Math.min(extra, room);
    next.killsThisNavTurn = 0;
    if (count <= 0) return { state: next, telegraph: [], spawns: [] };
    const cells = candidateCells(match, config, fog);
    const telegraph = cells.slice(0, count);
    if (delay <= 0) {
      const spawns = telegraph.map((at, index) => ({
        unitId: config.pool[index % config.pool.length]!,
        at,
      }));
      return { state: { ...next, telegraph: [] }, telegraph: [], spawns };
    }
    return {
      state: { ...next, timer: delay, pendingCount: count, telegraph },
      telegraph,
      spawns: [],
    };
  }

  // threshold
  if (living < (config.thresholdEnemyCount ?? 5)) {
    if (next.timer === null) {
      next.timer = delay;
      const room = Math.max(0, cap - living);
      const count = Math.min(config.countPerWave ?? 2, room);
      const cells = candidateCells(match, config, fog).slice(0, count);
      next.pendingCount = count;
      next.telegraph = cells;
      return { state: next, telegraph: cells, spawns: [] };
    }
    next.timer = Math.max(0, (next.timer ?? 0) - 1);
    if (next.timer > 0) {
      return { state: next, telegraph: next.telegraph, spawns: [] };
    }
    const room = Math.max(0, cap - living);
    const count = Math.min(next.pendingCount, room);
    const cells = candidateCells(match, config, fog).slice(0, count);
    const spawns = cells.map((at, index) => ({
      unitId: config.pool[index % config.pool.length]!,
      at,
    }));
    next.timer = null;
    next.pendingCount = 0;
    next.telegraph = [];
    return { state: next, telegraph: [], spawns };
  }

  next.timer = null;
  next.pendingCount = 0;
  next.telegraph = [];
  return { state: next, telegraph: [], spawns: [] };
}
