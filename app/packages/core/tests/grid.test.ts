import { describe, expect, it } from "vitest";
import {
  apCostFor,
  canFinish,
  canTransit,
  createTacticsKernel,
  distH,
  edgeCost,
  facingAfterStep,
  findPath,
  listReachable,
  makeGrid,
  tileAt,
  type EntityState,
} from "../src/index.js";

/** Восемь смещений соседних клеток — эталонный перебор в тестах. */
const NEIGHBOR_STEPS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function walker(partial: Partial<EntityState> = {}): EntityState {
  return {
    id: 1,
    configId: "w",
    owner: 1,
    x: 1,
    y: 1,
    z: 1,
    dir: 0,
    ap: 2,
    maxAp: 2,
    mobility: 6,
    hp: 10,
    maxHp: 10,
    aim: 70,
    defense: 0,
    vision: 12,
    weaponId: "bow_debug",
    obstacle: true,
    dead: false,
    flying: false,
    coverType: 0,
    overwatch: false,
    movementSpent: 0,
    ...partial,
  };
}

describe("distH", () => {
  it("treats a diagonal neighbour as distance 1", () => {
    expect(distH(0, 0, 1, 1)).toBe(1);
    expect(distH(2, 2, 2, 2)).toBe(0);
    expect(distH(0, 0, 2, 0)).toBe(2);
  });
});

describe("facingAfterStep", () => {
  it("prefers the X axis when both components are equal", () => {
    expect(facingAfterStep(0, 0, 1, 0, 0)).toBe(1);
    expect(facingAfterStep(0, 0, 0, 1, 0)).toBe(2);
    expect(facingAfterStep(0, 0, 1, 1, 0)).toBe(1);
  });
});

describe("edges and occupancy", () => {
  it("forbids entering a pit and a wall", () => {
    const grid = makeGrid(4, 4, 1);
    const pit = tileAt(grid, 2, 1);
    const wall = tileAt(grid, 1, 2);
    if (pit) pit.pit = true;
    if (wall) wall.blockLOS = true;
    const self = walker();
    expect(canTransit(grid, [self], self, 2, 1)).toBe(false);
    expect(canFinish(grid, [self], self, 2, 1)).toBe(false);
    expect(edgeCost(grid, [self], self, 1, 1, 2, 1)).toBe(Number.POSITIVE_INFINITY);
    expect(edgeCost(grid, [self], self, 1, 1, 1, 2)).toBe(Number.POSITIVE_INFINITY);
  });

  it("charges 2 movement points to climb and 1 to descend", () => {
    const grid = makeGrid(3, 1, 1);
    const high = tileAt(grid, 2, 0);
    if (high) high.z = 2;
    const self = walker({ x: 1, y: 0, z: 1 });
    expect(edgeCost(grid, [self], self, 1, 0, 2, 0)).toBe(2);
    const fromHigh = walker({ x: 2, y: 0, z: 2 });
    expect(edgeCost(grid, [fromHigh], fromHigh, 2, 0, 1, 0)).toBe(1);
  });

  it("forbids a step across two height levels", () => {
    const grid = makeGrid(2, 1, 0);
    const high = tileAt(grid, 1, 0);
    if (high) high.z = 2;
    const self = walker({ x: 0, y: 0, z: 0 });
    expect(edgeCost(grid, [self], self, 0, 0, 1, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it("allows the up-right diagonal when only the right cell is blocked", () => {
    // 0.20.43: диагональ закрыта, только если непроходимы оба плеча.
    const grid = makeGrid(3, 3, 1);
    const wall = tileAt(grid, 1, 0);
    if (wall) wall.blockLOS = true;
    const self = walker({ x: 0, y: 0 });
    // Маршрут «вправо» закрыт стеной, маршрут «вверх, потом вправо» жив:
    // min(Infinity, 1 + 1) / 2 + 0.5 = 1.5.
    expect(edgeCost(grid, [self], self, 0, 0, 1, 1)).toBe(1.5);
  });

  it("forbids the up-right diagonal when both up and right are blocked", () => {
    // Пример из правил: «двигаться вверх-вправо нельзя, если движение вверх
    // заблокировано и движение вправо заблокировано».
    const grid = makeGrid(3, 3, 1);
    const blockers: Array<[number, number]> = [
      [1, 0],
      [0, 1],
    ];
    for (const [x, y] of blockers) {
      const wall = tileAt(grid, x, y);
      if (wall) wall.blockLOS = true;
    }
    const self = walker({ x: 0, y: 0 });
    expect(edgeCost(grid, [self], self, 0, 0, 1, 1)).toBe(Number.POSITIVE_INFINITY);
  });

  it("prices a diagonal as half of the cheapest shoulder route plus a half point", () => {
    const grid = makeGrid(3, 3, 1);
    const self = walker({ x: 0, y: 0 });
    // Ровное поле: (1 + 1) / 2 + 0.5 = 1.5.
    expect(edgeCost(grid, [self], self, 0, 0, 1, 1)).toBe(1.5);

    const hill = makeGrid(3, 3, 1);
    const shoulder = tileAt(hill, 0, 1);
    if (shoulder) shoulder.z = 2;
    const wall = tileAt(hill, 1, 0);
    if (wall) wall.blockLOS = true;
    const climber = walker({ x: 0, y: 0 });
    // Правое плечо — стена, верхнее — подъём: min(Infinity, 2 + 1) / 2 + 0.5 = 2.
    expect(edgeCost(hill, [climber], climber, 0, 0, 1, 1)).toBe(2);
  });

  it("allows walking through an ally but not stopping on that cell", () => {
    const grid = makeGrid(4, 1, 1);
    const self = walker({ x: 0, y: 0 });
    const ally = walker({ id: 2, x: 1, y: 0 });
    expect(canTransit(grid, [self, ally], self, 1, 0)).toBe(true);
    expect(canFinish(grid, [self, ally], self, 1, 0)).toBe(false);
    expect(Number.isFinite(edgeCost(grid, [self, ally], self, 0, 0, 1, 0))).toBe(true);
    const path = findPath(grid, [self, ally], self, 2, 0);
    expect(path?.mpCost).toBe(2);
    expect(path?.path.map((cell) => `${cell.x},${cell.y}`)).toEqual(["0,0", "1,0", "2,0"]);
  });
});

describe("path optimality", () => {
  it("uses an admissible heuristic and returns the least MP cost", () => {
    const rows = [
      "11211110",
      "2011#111",
      "1111#21#",
      "01011210",
      "21112011",
      "12210101",
      "110#1010",
      "011###11",
    ];
    const grid = makeGrid(8, 8, 1);
    rows.forEach((row, y) => [...row].forEach((value, x) => {
      const tile = tileAt(grid, x, y)!;
      if (value === "#") tile.blockLOS = true;
      else tile.z = Number(value);
    }));
    const self = walker({ x: 0, y: 0, z: 1, mobility: 20 });
    // Эталон — полный перебор Дейкстрой на тех же рёбрах: A* с admissible-
    // эвристикой обязан дать ту же сумму шагов, округлённую вверх (0.20.43).
    const reference = (() => {
      const costs = new Map<string, number>();
      costs.set("0,0", 0);
      const queue = [{ x: 0, y: 0, g: 0 }];
      while (queue.length > 0) {
        queue.sort((a, b) => a.g - b.g);
        const current = queue.shift()!;
        if (current.g > (costs.get(`${current.x},${current.y}`) ?? Infinity)) continue;
        for (const step of NEIGHBOR_STEPS) {
          const nx = current.x + step[0];
          const ny = current.y + step[1];
          const cost = edgeCost(grid, [self], self, current.x, current.y, nx, ny);
          if (!Number.isFinite(cost)) continue;
          const g = current.g + cost;
          if (g >= (costs.get(`${nx},${ny}`) ?? Infinity)) continue;
          costs.set(`${nx},${ny}`, g);
          queue.push({ x: nx, y: ny, g });
        }
      }
      return costs.get("7,7");
    })();
    expect(reference).toBeDefined();
    const path = findPath(grid, [self], self, 7, 7);
    expect(path?.mpCost).toBe(Math.ceil(reference!));
    // Диагональ дороже ортогонали, поэтому цена выросла против прежних 9.
    expect(path?.mpCost).toBe(13);
  });

  it("rounds the sum of the steps up to a whole movement point", () => {
    const grid = makeGrid(4, 4, 1);
    const self = walker({ x: 0, y: 0, mobility: 20 });
    // Одна диагональ: 1.5 -> 2 очка движения.
    expect(findPath(grid, [self], self, 1, 1)?.mpCost).toBe(2);
    // Диагональ и ортогональ: 1.5 + 1 = 2.5 -> 3.
    expect(findPath(grid, [self], self, 2, 1)?.mpCost).toBe(3);
    // Две диагонали: 1.5 + 1.5 = 3 -> 3.
    expect(findPath(grid, [self], self, 2, 2)?.mpCost).toBe(3);
  });
});

describe("movement allowance (0.20.43)", () => {
  it("spends one action point for 4 MP and two for 5-8 MP", () => {
    // Базовая норма: 4 очка движения за 1 ОД, рывок — 8 очков за 2 ОД.
    expect(apCostFor(1, 4)).toBe(1);
    expect(apCostFor(4, 4)).toBe(1);
    expect(apCostFor(5, 4)).toBe(2);
    expect(apCostFor(8, 4)).toBe(2);
    expect(apCostFor(9, 4)).toBeNull();
    // Упырь ходит на 3 очка, слизень — на 2.
    expect(apCostFor(3, 3)).toBe(1);
    expect(apCostFor(4, 3)).toBe(2);
    expect(apCostFor(2, 2)).toBe(1);
  });

  it("does not sell a diagonal for a single movement point", () => {
    // Диагональ стоит полтора очка и округляется до двух: при бюджете в
    // одно очко клетка по диагонали недоступна.
    const grid = makeGrid(3, 3, 1);
    const self = walker({ x: 0, y: 0, mobility: 1, ap: 1 });
    const reachable = listReachable(grid, [self], self);
    expect(reachable.find((cell) => cell.x === 1 && cell.y === 1)).toBeUndefined();
    expect(reachable.find((cell) => cell.x === 1 && cell.y === 0)?.mpCost).toBe(1);
  });
});

describe("createTacticsKernel", () => {
  it("reports 0.20.49 and does not touch the document object", () => {
    const kernel = createTacticsKernel();
    expect(kernel.version).toBe("0.20.49");
    expect(typeof globalThis.document).toBe("undefined");
  });

  it("moves the walker, spends action points, and ignores a forged path", () => {
    const kernel = createTacticsKernel();
    const before = kernel.getSnapshot().entities.find((entity) => entity.id === 1);
    expect(before?.ap).toBe(2);
    const reachable = kernel.getReachable(1);
    expect(reachable.length).toBeGreaterThan(0);
    const step = reachable.find((cell) => cell.apCost === 1);
    expect(step).toBeDefined();
    if (!step) return;

    const result = kernel.apply({
      type: "MOVE",
      actorId: 1,
      to: { x: step.x, y: step.y, z: step.z },
      path: [{ x: 99, y: 99, z: 0 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const moved = result.events.find((event) => event.type === "ENTITY_MOVED");
    expect(moved && moved.type === "ENTITY_MOVED" && moved.path[0]?.x).not.toBe(99);
    const after = kernel.getSnapshot().entities.find((entity) => entity.id === 1);
    expect(after?.x).toBe(step.x);
    expect(after?.y).toBe(step.y);
    expect(after?.ap).toBe(2 - step.apCost);
  });

  it("rejects a move onto a pit or the ally", () => {
    const kernel = createTacticsKernel();
    expect(kernel.apply({ type: "MOVE", actorId: 1, to: { x: 3, y: 3, z: 1 } }).ok).toBe(false);
    expect(kernel.apply({ type: "MOVE", actorId: 1, to: { x: 1, y: 6, z: 0 } }).ok).toBe(false);
  });

  it("passes the turn to the other side and later refills the first", () => {
    const kernel = createTacticsKernel();
    const reachable = kernel.getReachable(1);
    const step = reachable[0];
    if (step) {
      kernel.apply({ type: "MOVE", actorId: 1, to: { x: step.x, y: step.y, z: step.z } });
    }
    const afterMove = kernel.getSnapshot().entities.find((entity) => entity.id === 1);
    expect(afterMove && afterMove.ap < 2).toBe(true);
    kernel.apply({ type: "END_TURN", playerId: "1" });
    expect(kernel.getSnapshot().activeOwner).toBe(2);
    kernel.apply({ type: "END_TURN", playerId: "2" });
    const actor = kernel.getSnapshot().entities.find((entity) => entity.id === 1);
    expect(actor?.ap).toBe(2);
    expect(kernel.getSnapshot().activeOwner).toBe(1);
  });

  it("never exceeds two mobility budgets even with maxAP greater than two", () => {
    const grid = makeGrid(12, 1, 1);
    const self = walker({ x: 0, y: 0, mobility: 3, ap: 3, maxAp: 3, vision: 20 });
    const kernel = createTacticsKernel({ initial: { turnNumber: 1, activeOwner: 1, grid, entities: [self] } });
    expect(kernel.apply({ type: "MOVE", actorId: 1, to: { x: 3, y: 0, z: 1 } }).ok).toBe(true);
    expect(kernel.apply({ type: "MOVE", actorId: 1, to: { x: 6, y: 0, z: 1 } }).ok).toBe(true);
    expect(kernel.apply({ type: "MOVE", actorId: 1, to: { x: 7, y: 0, z: 1 } }).ok).toBe(false);
  });

  it("uses a dash when the path exceeds one mobility budget", () => {
    const grid = makeGrid(10, 1, 1);
    const self = walker({ x: 0, y: 0, mobility: 3, ap: 2 });
    const kernel = createTacticsKernel({
      initial: {
        turnNumber: 1,
        activeOwner: 1,
        grid,
        entities: [self],
      },
    });
    const far = kernel.apply({ type: "MOVE", actorId: 1, to: { x: 5, y: 0, z: 1 } });
    expect(far.ok).toBe(true);
    if (!far.ok) return;
    const moved = far.events.find((event) => event.type === "ENTITY_MOVED");
    expect(moved && moved.type === "ENTITY_MOVED" && moved.isDash).toBe(true);
    expect(kernel.getSnapshot().entities[0]?.ap).toBe(0);
  });
});
