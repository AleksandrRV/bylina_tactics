import { describe, expect, it } from "vitest";
import { traceRay, hasLineOfSight, evaluateObstacles } from "../src/los.js";
import { evaluateCover } from "../src/cover.js";
import { makeGrid, tileAt } from "../src/grid.js";
import type { EntityState, Grid } from "../src/types.js";

function emptyEntity(partial: Partial<EntityState> = {}): EntityState {
  return {
    id: 1,
    configId: "u",
    owner: 1,
    x: 0,
    y: 0,
    z: 1,
    dir: 0,
    ap: 2,
    maxAp: 2,
    mobility: 6,
    hp: 10,
    maxHp: 10,
    aim: 80,
    defense: 0,
    vision: 12,
    weaponId: "",
    obstacle: true,
    dead: false,
    flying: false,
    coverType: 0,
    overwatch: false,
    defending: false,
    ...partial,
  };
}

describe("traceRay", () => {
  it("marks straight-line cells as full intersections", () => {
    const traced = traceRay(0, 0, 4, 0);
    // All intermediate cells should be full.
    for (const cell of traced) {
      if (cell.x === 0 && cell.y === 0) continue;
      if (cell.x === 4 && cell.y === 0) continue;
      expect(cell.type).toBe("full");
    }
  });

  it("marks corner-touching cells as glancing", () => {
    // Diagonal from (0,0) to (3,3) passes through corners.
    const traced = traceRay(0, 0, 3, 3);
    const glancing = traced.filter((c) => c.type === "glancing");
    expect(glancing.length).toBeGreaterThan(0);
  });
});

describe("hasLineOfSight", () => {
  it("is blocked by a wall on a straight line", () => {
    const grid = makeGrid(5, 1, 1);
    const wall = tileAt(grid, 2, 0)!;
    wall.blockLOS = true;
    expect(hasLineOfSight(grid, 0, 0, 1, 4, 0, 1)).toBe(false);
  });

  it("is not blocked by a wall at a glancing intersection (single)", () => {
    const grid = makeGrid(5, 5, 1);
    // Wall at (2, 1), diagonal shot from (0,0) to (4,4) touches (2,1) glancingly.
    const wall = tileAt(grid, 2, 1)!;
    wall.blockLOS = true;
    // Single glancing wall does NOT block.
    expect(hasLineOfSight(grid, 0, 0, 1, 4, 4, 1)).toBe(true);
  });

  it("is blocked by two adjacent glancing walls (grouping)", () => {
    const grid = makeGrid(5, 5, 1);
    // Two adjacent walls both glancing.
    tileAt(grid, 2, 1)!.blockLOS = true;
    tileAt(grid, 1, 2)!.blockLOS = true;
    // Grouped: two adjacent glancing full covers → blocked.
    expect(hasLineOfSight(grid, 0, 0, 1, 4, 4, 1)).toBe(false);
  });
});

describe("evaluateObstacles", () => {
  it("returns blocked=true for a wall in the line of fire", () => {
    const grid = makeGrid(5, 1, 1);
    tileAt(grid, 2, 0)!.blockLOS = true;
    const result = evaluateObstacles(grid, [], 0, 0, 1, 4, 0, 1);
    expect(result.blocked).toBe(true);
    expect(result.breakCell).not.toBeNull();
  });

  it("returns obstaclePenalty for a glancing wall", () => {
    const grid = makeGrid(5, 5, 1);
    tileAt(grid, 2, 1)!.blockLOS = true;
    const result = evaluateObstacles(grid, [], 0, 0, 1, 4, 4, 1);
    expect(result.blocked).toBe(false);
    expect(result.obstaclePenalty).toBe(50); // glancing wall = -50
  });

  it("returns blocked=true for two adjacent glancing walls", () => {
    const grid = makeGrid(5, 5, 1);
    tileAt(grid, 2, 1)!.blockLOS = true;
    tileAt(grid, 1, 2)!.blockLOS = true;
    const result = evaluateObstacles(grid, [], 0, 0, 1, 4, 4, 1);
    expect(result.blocked).toBe(true);
  });
});

describe("evaluateCover with edge-based covers", () => {
  it("ignores edge cover when ray doesn't cross the edge", () => {
    const attacker = emptyEntity({ id: 1, owner: 1, x: 0, y: 2 });
    const target = emptyEntity({ id: 2, owner: 2, x: 4, y: 2 });
    // Cover east of target, but attacker is to the west.
    const cover = emptyEntity({
      id: 3,
      owner: 0,
      x: 5,
      y: 2,
      coverType: 2,
      edge: 1, // east edge
    });
    const result = evaluateCover(attacker, target, [cover], {
      melee: false,
      ignoreHalfCover: false,
      flyingTarget: false,
    });
    // Attacker shoots from west, cover is on east edge → not blocking.
    expect(result.penalty).toBe(0);
  });

  it("applies edge cover when ray crosses the correct edge", () => {
    const attacker = emptyEntity({ id: 1, owner: 1, x: 0, y: 2 });
    const target = emptyEntity({ id: 2, owner: 2, x: 4, y: 2 });
    // Cover west of target, attacker shoots from west → crosses west edge.
    const cover = emptyEntity({
      id: 3,
      owner: 0,
      x: 3,
      y: 2,
      coverType: 2,
      edge: 3, // west edge
    });
    const result = evaluateCover(attacker, target, [cover], {
      melee: false,
      ignoreHalfCover: false,
      flyingTarget: false,
    });
    expect(result.penalty).toBe(50);
  });

  it("adjacent defense bonus for half cover near target", () => {
    const attacker = emptyEntity({ id: 1, owner: 1, x: 0, y: 2 });
    const target = emptyEntity({ id: 2, owner: 2, x: 4, y: 2 });
    const cover = emptyEntity({
      id: 3,
      owner: 0,
      x: 3,
      y: 2,
      coverType: 1,
    });
    const result = evaluateCover(attacker, target, [cover], {
      melee: false,
      ignoreHalfCover: false,
      flyingTarget: false,
    });
    expect(result.adjacentDefenseBonus).toBe(15);
  });

  it("adjacent defense bonus for full cover near target", () => {
    const attacker = emptyEntity({ id: 1, owner: 1, x: 0, y: 2 });
    const target = emptyEntity({ id: 2, owner: 2, x: 4, y: 2 });
    const cover = emptyEntity({
      id: 3,
      owner: 0,
      x: 3,
      y: 2,
      coverType: 2,
    });
    const result = evaluateCover(attacker, target, [cover], {
      melee: false,
      ignoreHalfCover: false,
      flyingTarget: false,
    });
    expect(result.adjacentDefenseBonus).toBe(30);
  });
});
