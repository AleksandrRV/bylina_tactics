import { describe, expect, it } from "vitest";
import { traceRay, hasLineOfSight, evaluateObstacles, effectiveCoverTier } from "../src/los.js";
import { evaluateCover } from "../src/cover.js";
import { makeGrid, tileAt } from "../src/grid.js";
import { canFinish, canTransit, edgeCost } from "../src/occupancy.js";
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
    movementSpent: 0,
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

describe("false positive: obstacle not on ray path", () => {
  it("does NOT block shot when obstacle is at (1,1) and ray goes from (0,0) to (4,1)", () => {
    // А(0,0) 0 0 0 0
    // 0  П(1,1) 0 0 Ц(4,1)
    // The ray from (0,0) to (4,1) does NOT pass through (1,1).
    const grid = makeGrid(5, 2, 1);
    const obstacle = emptyEntity({
      id: 99,
      owner: 0,
      x: 1,
      y: 1,
      z: 1,
      coverType: 2,
      obstacle: true,
    });
    const result = evaluateObstacles(grid, [obstacle], 0, 0, 1, 4, 1, 1);
    expect(result.blocked).toBe(false);
    expect(result.obstaclePenalty).toBe(0);
  });

  it("does NOT block LOS when obstacle is off the ray path", () => {
    const grid = makeGrid(5, 2, 1);
    // Wall at (1,1) should not block ray from (0,0) to (4,1).
    tileAt(grid, 1, 1)!.blockLOS = true;
    expect(hasLineOfSight(grid, 0, 0, 1, 4, 1, 1)).toBe(true);
  });
});

describe("height elevation as half-cover", () => {
  it("counts a 1-level elevation as half-cover, not full block", () => {
    // А(0,0,z=1) 0 В(2,0,z=2) 0 0 Ц(4,0,z=1)
    const grid = makeGrid(5, 1, 1);
    tileAt(grid, 2, 0)!.z = 2;
    const result = evaluateObstacles(grid, [], 0, 0, 1, 4, 0, 1);
    // Should NOT be blocked, but should have a penalty.
    expect(result.blocked).toBe(false);
    expect(result.obstaclePenalty).toBeGreaterThan(0);
    expect(result.obstaclePenalty).toBeLessThanOrEqual(50);
  });
});

describe("height-based cover rules", () => {
  // effectiveCoverTier(coverType, isWall, attackerZ, defenderZ, coverZ)
  it("half-cover 1 level below defender is ignored", () => {
    expect(effectiveCoverTier(1, false, 1, 2, 1)).toBe(0);
  });

  it("full cover 1 level below defender becomes half", () => {
    expect(effectiveCoverTier(2, false, 1, 2, 1)).toBe(1);
  });

  it("wall (blockLOS) is always full regardless of height", () => {
    expect(effectiveCoverTier(2, true, 1, 2, 1)).toBe(2);
    expect(effectiveCoverTier(2, true, 1, 2, 0)).toBe(2);
  });

  it("full cover 2 levels below defender is ignored", () => {
    expect(effectiveCoverTier(2, false, 1, 2, 0)).toBe(0);
  });

  it("half cover at same level stays half", () => {
    expect(effectiveCoverTier(1, false, 1, 1, 1)).toBe(1);
  });

  it("full cover at same level stays full", () => {
    expect(effectiveCoverTier(2, false, 1, 1, 1)).toBe(2);
  });

  it("attacker 1 above cover: full becomes half", () => {
    expect(effectiveCoverTier(2, false, 2, 1, 1)).toBe(1);
  });

  it("attacker 2 above cover: full is ignored", () => {
    expect(effectiveCoverTier(2, false, 3, 1, 1)).toBe(0);
  });

  it("attacker 1 above cover: half is ignored", () => {
    expect(effectiveCoverTier(1, false, 2, 1, 1)).toBe(0);
  });
});

describe("edge-based covers do not occupy cells", () => {
  it("allows standing on a cell with an edge-based cover", () => {
    const grid = makeGrid(3, 3, 1);
    const walker = emptyEntity({ id: 1, x: 0, y: 1 });
    // Edge-based cover at (1,1) on east edge — should NOT block the cell.
    const edgeCover = emptyEntity({
      id: 2,
      owner: 0,
      x: 1,
      y: 1,
      coverType: 2,
      edge: 1,
      obstacle: false,
    });
    expect(canFinish(grid, [edgeCover], walker, 1, 1)).toBe(true);
    expect(canTransit(grid, [edgeCover], walker, 1, 1)).toBe(true);
  });

  it("blocks passage through the covered edge (full cover)", () => {
    const grid = makeGrid(3, 3, 1);
    const walker = emptyEntity({ id: 1, x: 0, y: 1 });
    // Full edge cover at (1,1) on west edge (edge=3).
    const edgeCover = emptyEntity({
      id: 2,
      owner: 0,
      x: 1,
      y: 1,
      coverType: 2,
      edge: 3, // west edge
      obstacle: false,
    });
    
    // Moving from (0,1) to (1,1) crosses the west edge of (1,1) → blocked.
    expect(edgeCost(grid, [edgeCover], walker, 0, 1, 1, 1)).toBe(Number.POSITIVE_INFINITY);
    // Moving from (1,1) to (1,2) does NOT cross the west edge → allowed.
    expect(edgeCost(grid, [edgeCover], walker, 1, 1, 1, 2)).toBe(1);
  });

  it("adds +1 MP cost for half edge cover", () => {
    const grid = makeGrid(3, 3, 1);
    const walker = emptyEntity({ id: 1, x: 0, y: 1 });
    // Half edge cover at (1,1) on west edge.
    const edgeCover = emptyEntity({
      id: 2,
      owner: 0,
      x: 1,
      y: 1,
      coverType: 1,
      edge: 3, // west edge
      obstacle: false,
    });
    
    // Moving from (0,1) to (1,1) crosses the west edge → +1 MP.
    expect(edgeCost(grid, [edgeCover], walker, 0, 1, 1, 1)).toBe(2); // base 1 + edge 1
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
    const result = evaluateCover(attacker, target, [cover], makeGrid(10, 10, 1), {
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
      edge: 1, // east edge: boundary between cover and target
    });
    const result = evaluateCover(attacker, target, [cover], makeGrid(10, 10, 1), {
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
    const result = evaluateCover(attacker, target, [cover], makeGrid(10, 10, 1), {
      melee: false,
      ignoreHalfCover: false,
      flyingTarget: false,
    });
    expect(result.penalty).toBe(25);
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
    const result = evaluateCover(attacker, target, [cover], makeGrid(10, 10, 1), {
      melee: false,
      ignoreHalfCover: false,
      flyingTarget: false,
    });
    expect(result.penalty).toBe(50);
  });
});
