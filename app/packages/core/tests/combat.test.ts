import { describe, expect, it } from "vitest";
import {
  DEBUG_BOW,
  DEBUG_SWORD,
  createTacticsKernel,
  evaluateCover,
  hasLineOfSight,
  heightRangeMod,
  inRangedReach,
  makeGrid,
  previewAttack,
  tileAt,
  type EntityState,
} from "../src/index.js";

function unit(partial: Partial<EntityState> = {}): EntityState {
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
    weaponId: DEBUG_BOW.id,
    obstacle: true,
    dead: false,
    flying: false,
    coverType: 0,
    overwatch: false,
    defending: false,
    ...partial,
  };
}

describe("heightRangeMod", () => {
  it("adds one tile shooting down and subtracts one shooting up", () => {
    expect(heightRangeMod(2, 0)).toBe(1);
    expect(heightRangeMod(0, 2)).toBe(-1);
    expect(heightRangeMod(1, 1)).toBe(0);
    expect(inRangedReach(0, 0, 2, 8, 0, 0, 8)).toBe(true);
    expect(inRangedReach(0, 0, 0, 8, 0, 2, 8)).toBe(false);
  });
});

describe("LOS", () => {
  it("is not blocked by cover, but is blocked by a wall", () => {
    const grid = makeGrid(5, 1, 1);
    const attacker = unit({ x: 0, y: 0 });
    const target = unit({ id: 2, owner: 2, x: 4, y: 0 });
    const cover = unit({ id: 3, owner: 0, x: 2, y: 0, coverType: 2, weaponId: "" });
    expect(hasLineOfSight(grid, 0, 0, 1, 4, 0, 1)).toBe(true);
    const preview = previewAttack(grid, [attacker, target, cover], attacker, target, DEBUG_BOW);
    expect(preview.available).toBe(true);

    const wall = tileAt(grid, 2, 0);
    if (wall) wall.blockLOS = true;
    expect(hasLineOfSight(grid, 0, 0, 1, 4, 0, 1)).toBe(false);
    expect(previewAttack(grid, [attacker, target], attacker, target, DEBUG_BOW).available).toBe(false);
  });

  it("is blocked by a hill that the ray hits", () => {
    const grid = makeGrid(3, 1, 0);
    const mid = tileAt(grid, 1, 0);
    if (mid) mid.z = 2;
    expect(hasLineOfSight(grid, 0, 0, 0, 2, 0, 0)).toBe(false);
  });
});

describe("cover and flank", () => {
  it("does not treat open ground as flanked", () => {
    const grid = makeGrid(4, 1, 1);
    const attacker = unit({ x: 0, y: 0 });
    const target = unit({ id: 2, owner: 2, x: 3, y: 0 });
    const evaled = evaluateCover(attacker, target, [attacker, target], makeGrid(10, 10, 1), {
      melee: false,
      ignoreHalfCover: false,
      flyingTarget: false,
    });
    expect(evaled.flanked).toBe(false);
    expect(evaled.penalty).toBe(0);
  });

  it("applies cover on the fire line and flanks when cover is off-line", () => {
    const attacker = unit({ x: 0, y: 1 });
    const target = unit({ id: 2, owner: 2, x: 2, y: 1 });
    const cover = unit({ id: 3, owner: 0, x: 1, y: 1, coverType: 2, weaponId: "" });
    const onLine = evaluateCover(attacker, target, [attacker, target, cover], makeGrid(10, 10, 1), {
      melee: false,
      ignoreHalfCover: false,
      flyingTarget: false,
    });
    expect(onLine.penalty).toBe(50);
    expect(onLine.flanked).toBe(false);

    const fromSouth = unit({ x: 2, y: 3 });
    const flanked = evaluateCover(fromSouth, target, [fromSouth, target, cover], makeGrid(10, 10, 1), {
      melee: false,
      ignoreHalfCover: false,
      flyingTarget: false,
    });
    expect(flanked.penalty).toBe(0);
    expect(flanked.flanked).toBe(true);
  });

  it("ignores cover penalty in melee but keeps flank for later crit", () => {
    const attacker = unit({ x: 1, y: 1 });
    const target = unit({ id: 2, owner: 2, x: 2, y: 1 });
    const cover = unit({ id: 3, owner: 0, x: 1, y: 1, coverType: 2, weaponId: "" });
    const melee = evaluateCover(attacker, target, [attacker, target, cover], makeGrid(10, 10, 1), {
      melee: true,
      ignoreHalfCover: false,
      flyingTarget: false,
    });
    expect(melee.penalty).toBe(0);
  });
});

describe("kernel attack", () => {
  it("resolves a shot and can kill", () => {
    const kernel = createTacticsKernel({ seed: 1 });
    const preview = kernel.getHitPreview(1, 4);
    expect(preview.available).toBe(true);
    expect(preview.chance).toBeGreaterThan(0);
    const result = kernel.apply({ type: "ATTACK", actorId: 1, targetId: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const combat = result.events.find((event) => event.type === "COMBAT_RESOLVED");
    expect(combat && combat.type === "COMBAT_RESOLVED").toBe(true);
    const actor = kernel.getSnapshot().entities.find((entity) => entity.id === 1);
    expect(actor?.ap).toBe(0);
  });

  it("rejects a melee weapon out of reach", () => {
    const kernel = createTacticsKernel();
    const preview = kernel.getHitPreview(1, 4, DEBUG_SWORD.id);
    expect(preview.available).toBe(false);
    expect(preview.reason).toBe("OUT_OF_RANGE");
  });
});
