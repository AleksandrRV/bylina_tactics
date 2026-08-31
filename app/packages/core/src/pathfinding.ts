import { NEIGHBORS, isCardinal, tileAt } from "./grid.js";
import { canFinish, edgeCost } from "./occupancy.js";
import type { CellPos, EntityState, Grid, ReachableCell } from "./types.js";

interface Node {
  x: number;
  y: number;
  g: number;
  f: number;
  px: number;
  py: number;
  cardinal: boolean;
}

function key(x: number, y: number): string {
  return `${x},${y}`;
}

/** Допустимая эвристика для восьмисвязной сетки с минимальной ценой ребра 1. */
function pathHeuristic(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(bx - ax), Math.abs(by - ay));
}

function better(a: Node, b: Node): boolean {
  if (a.f !== b.f) return a.f < b.f;
  if (a.cardinal !== b.cardinal) return a.cardinal;
  if (a.x !== b.x) return a.x < b.x;
  return a.y < b.y;
}

class MinHeap {
  private data: Node[] = [];

  push(node: Node): void {
    this.data.push(node);
    this.up(this.data.length - 1);
  }

  pop(): Node | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length > 0 && last) {
      this.data[0] = last;
      this.down(0);
    }
    return top;
  }

  get size(): number {
    return this.data.length;
  }

  private up(index: number): void {
    let i = index;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const cur = this.data[i];
      const parent = this.data[p];
      if (!cur || !parent || !better(cur, parent)) break;
      this.data[i] = parent;
      this.data[p] = cur;
      i = p;
    }
  }

  private down(index: number): void {
    let i = index;
    const n = this.data.length;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      const mi = this.data[m];
      const li = this.data[l];
      const ri = this.data[r];
      if (l < n && li && mi && better(li, mi)) m = l;
      const mv = this.data[m];
      if (r < n && ri && mv && better(ri, mv)) m = r;
      if (m === i) break;
      const a = this.data[i];
      const b = this.data[m];
      if (!a || !b) break;
      this.data[i] = b;
      this.data[m] = a;
      i = m;
    }
  }
}

interface PathResult {
  path: CellPos[];
  mpCost: number;
}

export function findPath(
  grid: Grid,
  entities: readonly EntityState[],
  walker: EntityState,
  toX: number,
  toY: number,
): PathResult | null {
  if (walker.x === toX && walker.y === toY) return { path: [{ x: walker.x, y: walker.y, z: walker.z }], mpCost: 0 };
  if (!canFinish(grid, entities, walker, toX, toY)) return null;

  const open = new MinHeap();
  const bestG = new Map<string, number>();
  const came = new Map<string, { x: number; y: number }>();

  const start: Node = {
    x: walker.x,
    y: walker.y,
    g: 0,
    f: pathHeuristic(walker.x, walker.y, toX, toY),
    px: walker.x,
    py: walker.y,
    cardinal: true,
  };
  open.push(start);
  bestG.set(key(walker.x, walker.y), 0);

  while (open.size > 0) {
    const current = open.pop();
    if (!current) break;
    const recorded = bestG.get(key(current.x, current.y));
    if (recorded !== undefined && current.g > recorded) continue;
    if (current.x === toX && current.y === toY) {
      // Итог пути округляется вверх (0.20.43): сумма стоимостей шагов,
      // где диагональ стоит полтора очка.
      return reconstruct(grid, came, walker, toX, toY, Math.ceil(current.g));
    }

    for (const [dx, dy] of NEIGHBORS) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      const cost = edgeCost(grid, entities, walker, current.x, current.y, nx, ny);
      if (!Number.isFinite(cost)) continue;
      const g = current.g + cost;
      const id = key(nx, ny);
      const prev = bestG.get(id);
      if (prev !== undefined && g > prev) continue;
      if (prev === g) continue;
      bestG.set(id, g);
      came.set(id, { x: current.x, y: current.y });
      open.push({
        x: nx,
        y: ny,
        g,
        f: g + pathHeuristic(nx, ny, toX, toY),
        px: current.x,
        py: current.y,
        cardinal: isCardinal(dx, dy),
      });
    }
  }

  return null;
}

function reconstruct(
  grid: Grid,
  came: Map<string, { x: number; y: number }>,
  walker: EntityState,
  toX: number,
  toY: number,
  mpCost: number,
): PathResult {
  const cells: CellPos[] = [];
  let x = toX;
  let y = toY;
  for (;;) {
    const tile = tileAt(grid, x, y);
    cells.push({ x, y, z: tile?.z ?? 0 });
    if (x === walker.x && y === walker.y) break;
    const parent = came.get(key(x, y));
    if (!parent) break;
    x = parent.x;
    y = parent.y;
  }
  cells.reverse();
  return { path: cells, mpCost };
}

export function apCostFor(mpCost: number, mobility: number): 1 | 2 | null {
  if (mpCost <= 0) return null;
  if (mpCost <= mobility) return 1;
  if (mpCost <= mobility * 2) return 2;
  return null;
}

export function listReachable(grid: Grid, entities: readonly EntityState[], walker: EntityState): ReachableCell[] {
  const actionBudget = walker.ap <= 0 ? 0 : walker.ap >= 2 ? walker.mobility * 2 : walker.mobility;
  const turnBudget = Math.max(0, walker.mobility * 2 - (walker.movementSpent ?? 0));
  const maxMp = Math.min(actionBudget, turnBudget);
  if (maxMp <= 0) return [];

  const best = new Map<string, number>();
  const open = new MinHeap();
  open.push({
    x: walker.x,
    y: walker.y,
    g: 0,
    f: 0,
    px: walker.x,
    py: walker.y,
    cardinal: true,
  });
  best.set(key(walker.x, walker.y), 0);

  while (open.size > 0) {
    const current = open.pop();
    if (!current) break;
    const recorded = best.get(key(current.x, current.y));
    if (recorded !== undefined && current.g > recorded) continue;

    for (const [dx, dy] of NEIGHBORS) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      const cost = edgeCost(grid, entities, walker, current.x, current.y, nx, ny);
      if (!Number.isFinite(cost)) continue;
      const g = current.g + cost;
      // Клетка доступна, если округлённая вверх цена пути влезает в бюджет
      // (0.20.43): полтора очка за диагональ округляются до двух.
      if (Math.ceil(g) > maxMp) continue;
      const id = key(nx, ny);
      const prev = best.get(id);
      if (prev !== undefined && g >= prev) continue;
      best.set(id, g);
      open.push({
        x: nx,
        y: ny,
        g,
        f: g,
        px: current.x,
        py: current.y,
        cardinal: isCardinal(dx, dy),
      });
    }
  }

  const result: ReachableCell[] = [];
  for (const [id, raw] of best) {
    const [xs, ys] = id.split(",");
    const x = Number(xs);
    const y = Number(ys);
    if (x === walker.x && y === walker.y) continue;
    if (!canFinish(grid, entities, walker, x, y)) continue;
    // Цена клетки — округлённая вверх сумма шагов (0.20.43).
    const mp = Math.ceil(raw);
    const ap = apCostFor(mp, walker.mobility);
    if (ap === null || ap > walker.ap) continue;
    const tile = tileAt(grid, x, y);
    if (!tile) continue;
    result.push({ x, y, z: tile.z, mpCost: mp, apCost: ap });
  }
  return result;
}
