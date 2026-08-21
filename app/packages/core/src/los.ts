import { tileAt } from "./grid.js";
import type { EntityState, Grid } from "./types.js";

interface Cell {
  x: number;
  y: number;
}

export type IntersectionType = "full" | "glancing";

export interface TracedCell extends Cell {
  /** Тип пересечения луча с клеткой. */
  type: IntersectionType;
}

/**
 * Клетки, внутренность которых пересекает отрезок центров.
 * При проходе через узел сетки (tmaxX ≈ tmaxY) обе добавляемые одновременно
 * клетки помечаются как касательные (glancing). Документ математики, §7.1.
 */
export function traceRay(ax: number, ay: number, bx: number, by: number): TracedCell[] {
  const x0 = ax + 0.5;
  const y0 = ay + 0.5;
  const x1 = bx + 0.5;
  const y1 = by + 0.5;
  const cells: TracedCell[] = [];
  let ix = Math.floor(x0);
  let iy = Math.floor(y0);
  const ixe = Math.floor(x1);
  const iye = Math.floor(y1);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const tdx = stepX === 0 ? Number.POSITIVE_INFINITY : 1 / Math.abs(dx);
  const tdy = stepY === 0 ? Number.POSITIVE_INFINITY : 1 / Math.abs(dy);
  let tmaxX =
    stepX === 0
      ? Number.POSITIVE_INFINITY
      : (stepX > 0 ? ix + 1 - x0 : x0 - ix) * tdx;
  let tmaxY =
    stepY === 0
      ? Number.POSITIVE_INFINITY
      : (stepY > 0 ? iy + 1 - y0 : y0 - iy) * tdy;

  const seen = new Set<string>();
  const push = (x: number, y: number, type: IntersectionType): void => {
    const key = `${x},${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    cells.push({ x, y, type });
  };

  push(ix, iy, "full");
  let guard = 0;
  while ((ix !== ixe || iy !== iye) && guard < 512) {
    guard += 1;
    if (tmaxX < tmaxY - 1e-12) {
      ix += stepX;
      tmaxX += tdx;
      push(ix, iy, "full");
    } else if (tmaxY < tmaxX - 1e-12) {
      iy += stepY;
      tmaxY += tdy;
      push(ix, iy, "full");
    } else {
      // Проход через узел: обе клетки — касательные.
      push(ix + stepX, iy, "glancing");
      push(ix, iy + stepY, "glancing");
      ix += stepX;
      iy += stepY;
      tmaxX += tdx;
      tmaxY += tdy;
      push(ix, iy, "full");
    }
  }
  return cells;
}

/** Совместимость: возвращает только координаты (без типа). */
export function supercover(ax: number, ay: number, bx: number, by: number): Cell[] {
  return traceRay(ax, ay, bx, by);
}

function rayZ(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  cx: number,
  cy: number,
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 1e-12) {
    t = ((cx + 0.5 - x0) * dx + (cy + 0.5 - y0) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
  }
  return z0 + t * (z1 - z0);
}

/** Является ли клетка полным укрытием (стена blockLOS ≡ coverType 2). Документ §7.2. */
function isFullCover(entity: EntityState): boolean {
  return entity.coverType === 2;
}

/** Является ли клетка укрытием (стена blockLOS ≡ coverType 2, либо coverType 1). */
function isAnyCover(entity: EntityState): boolean {
  return entity.coverType > 0;
}

export interface ObstacleResult {
  /** Линия наблюдения полностью заблокирована. */
  blocked: boolean;
  /** Штраф от промежуточных препятствий (§9.3, §9.5). */
  obstaclePenalty: number;
  /** Клетка, на которой луч прерывается (для визуализации). */
  breakCell: { x: number; y: number; z: number } | null;
}

/**
 * Оценка всех промежуточных препятствий на луче от атакующего к цели (§7, §9.3–9.5).
 *
 * Стена (blockLOS) и полное укрытие (coverType = 2) равнозначны.
 * Касательное пересечение = 50% эффективность.
 * Смежные с атакующим укрытия: полу игнорируются, полные при касательной тоже.
 * Группировка: смежные касательные одной ступени = одно полное.
 */
export function evaluateObstacles(
  grid: Grid,
  entities: readonly EntityState[],
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): ObstacleResult {
  if (ax === bx && ay === by) return { blocked: false, obstaclePenalty: 0, breakCell: null };

  const traced = traceRay(ax, ay, bx, by);
  const x0 = ax + 0.5;
  const y0 = ay + 0.5;
  const z0 = az + 0.5;
  const x1 = bx + 0.5;
  const y1 = by + 0.5;
  const z1 = bz + 0.5;

  let blocked = false;
  let maxPenalty = 0;
  let breakCell: { x: number; y: number; z: number } | null = null;

  // Собрать промежуточные укрытия-сущности для группировки.
  const intermediateCovers: { entity: EntityState; type: IntersectionType }[] = [];
  // Собрать касательные стены (blockLOS) для группировки.
  const glancingWalls: { x: number; y: number }[] = [];

  for (const cell of traced) {
    // Пропустить клетки атакующего и цели.
    if ((cell.x === ax && cell.y === ay) || (cell.x === bx && cell.y === by)) continue;

    const tile = tileAt(grid, cell.x, cell.y);
    if (!tile) {
      blocked = true;
      breakCell = { x: cell.x, y: cell.y, z: 0 };
      break;
    }

    // Перепад высот: rz < tile.z → поверхность прерывает луч.
    // Но если перепад ровно 1 ярус — считаем полуукрытием (§7.3).
    const rz = rayZ(x0, y0, z0, x1, y1, z1, cell.x, cell.y);
    if (rz < tile.z) {
      const heightDiff = tile.z - rz;
      if (heightDiff > 1.01) {
        // Перепад более 1 яруса — полная блокировка.
        blocked = true;
        breakCell = { x: cell.x, y: cell.y, z: tile.z };
        break;
      } else {
        // Перепад ровно 1 ярус — полуукрытие (штраф −25).
        // Учитываем как промежуточное укрытие.
        if (cell.type === "full") {
          maxPenalty = Math.max(maxPenalty, 50); // полное пересечение полуукрытия = -50
        } else {
          maxPenalty = Math.max(maxPenalty, 25); // касательное полуукрытие = -25
        }
      }
    }

    // Стена (blockLOS) = полное укрытие (§7.2).
    if (tile.blockLOS) {
      if (cell.type === "full") {
        blocked = true;
        breakCell = { x: cell.x, y: cell.y, z: tile.z };
        break;
      }
      // Касательная стена — собираем для группировки.
      glancingWalls.push({ x: cell.x, y: cell.y });
    }

    // Сущности-укрытия в промежуточной клетке.
    for (const entity of entities) {
      if (!isAnyCover(entity) || entity.dead) continue;
      if (entity.x !== cell.x || entity.y !== cell.y) continue;
      if (Math.abs(entity.z - (tile.pit ? 0 : tile.z)) > 1) continue;
      intermediateCovers.push({ entity, type: cell.type });
    }
  }

  if (!blocked) {
    // Группировка касательных стен: 2+ смежных → блокировка (§7.3).
    if (glancingWalls.length >= 2) {
      for (let i = 0; i < glancingWalls.length && !blocked; i++) {
        for (let j = i + 1; j < glancingWalls.length; j++) {
          const a = glancingWalls[i]!;
          const b = glancingWalls[j]!;
          if (Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1) {
            blocked = true;
            breakCell = { x: a.x, y: a.y, z: 0 };
            break;
          }
        }
      }
    }
    if (!blocked) {
      // Одиночные касательные стены → штраф 50.
      if (glancingWalls.length > 0) maxPenalty = Math.max(maxPenalty, 50);
      // Обработать промежуточные укрытия-сущности с группировкой (§9.3, §9.4).
      maxPenalty = Math.max(maxPenalty, computeObstaclePenalty(intermediateCovers, ax, ay, az));
    }
  }

  return { blocked, obstaclePenalty: maxPenalty, breakCell };
}

/**
 * Вычислить штраф от промежуточных укрытий-сущностей.
 * Смежные с атакующим (DistH ≤ 1): полу игнорируются, полные при касательной тоже.
 * Группировка смежных касательных одной ступени (§9.4).
 */
function computeObstaclePenalty(
  covers: { entity: EntityState; type: IntersectionType }[],
  ax: number,
  ay: number,
  _az: number,
): number {
  let penalty = 0;
  const groups: { tier: 1 | 2; ids: Set<number> }[] = [];

  for (const { entity, type } of covers) {
    const distToAttacker = Math.max(Math.abs(entity.x - ax), Math.abs(entity.y - ay));
    const adjacent = distToAttacker <= 1;
    const tier: 1 | 2 = entity.coverType as 1 | 2;

    if (type === "full") {
      // Полное пересечение: полное укрытие блокирует, полу = −50.
      if (tier === 2) {
        // Полное укрытие при полном пересечении = блокировка (обрабатывается как breakCell).
        return 100; // сигнал блокировки
      }
      penalty = Math.max(penalty, 50);
    } else {
      // Касательное пересечение.
      if (adjacent) {
        // Смежное с атакующим: полу игнорируется, полное при касательной тоже (§7.4).
        continue;
      }
      // Группировка: собираем касательные укрытия для последующей проверки смежности.
      let merged = false;
      for (const group of groups) {
        if (group.tier !== tier) continue;
        // Проверить смежность с любым членом группы.
        for (const id of group.ids) {
          const other = covers.find((c) => c.entity.id === id);
          if (other && Math.max(Math.abs(entity.x - other.entity.x), Math.abs(entity.y - other.entity.y)) <= 1) {
            group.ids.add(entity.id);
            merged = true;
            break;
          }
        }
        if (merged) break;
      }
      if (!merged) {
        groups.push({ tier, ids: new Set([entity.id]) });
      }
    }
  }

  // Группы из 2+ касательных одной ступени → одно полное пересечение.
  for (const group of groups) {
    if (group.ids.size >= 2) {
      if (group.tier === 2) return 100; // группа полных → блокировка
      penalty = Math.max(penalty, 50); // группа полу → как полное при полном
    } else {
      // Одиночное касательное.
      const singlePenalty = group.tier === 2 ? 50 : 25;
      penalty = Math.max(penalty, singlePenalty);
    }
  }

  return penalty;
}

/** Документ математики, §7. Укрытия и юниты луч не прерывают (только стены и рельеф). */
export function hasLineOfSight(
  grid: Grid,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): boolean {
  if (ax === bx && ay === by) return true;
  const traced = traceRay(ax, ay, bx, by);
  const x0 = ax + 0.5;
  const y0 = ay + 0.5;
  const z0 = az + 0.5;
  const x1 = bx + 0.5;
  const y1 = by + 0.5;
  const z1 = bz + 0.5;

  // Собрать касательные полные укрытия для группировки.
  const glancingFull: Cell[] = [];

  for (const cell of traced) {
    if ((cell.x === ax && cell.y === ay) || (cell.x === bx && cell.y === by)) continue;
    const tile = tileAt(grid, cell.x, cell.y);
    if (!tile) return false;

    // Перепад высот.
    const rz = rayZ(x0, y0, z0, x1, y1, z1, cell.x, cell.y);
    if (rz < tile.z) return false;

    // Стена = полное укрытие (§7.2).
    if (tile.blockLOS) {
      if (cell.type === "full") return false;
      glancingFull.push(cell);
    }

    // Полные укрытия-сущности (coverType = 2) при полном пересечении блокируют.
    // При касательном — собираем для группировки.
    // (Укрытия-сущности проверяются отдельно в evaluateObstacles,
    //  здесь учитываем только тайловые blockLOS для базовой LOS.)
  }

  // Группировка касательных стен: 2+ смежных → блокировка.
  if (glancingFull.length >= 2) {
    for (let i = 0; i < glancingFull.length; i++) {
      for (let j = i + 1; j < glancingFull.length; j++) {
        const a = glancingFull[i]!;
        const b = glancingFull[j]!;
        if (Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1) return false;
      }
    }
  }

  return true;
}
