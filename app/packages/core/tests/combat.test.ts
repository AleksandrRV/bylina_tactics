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
  resolveAttack,
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
    movementSpent: 0,
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

  it("keeps a single glancing wall shootable but applies full-cover penalty", () => {
    const grid = makeGrid(5, 5, 1);
    const attacker = unit({ x: 0, y: 0 });
    const target = unit({ id: 2, owner: 2, x: 4, y: 4 });
    const open = previewAttack(grid, [attacker, target], attacker, target, DEBUG_BOW);
    tileAt(grid, 1, 0)!.blockLOS = true;
    const glancing = previewAttack(grid, [attacker, target], attacker, target, DEBUG_BOW);
    expect(glancing.available).toBe(true);
    expect(glancing.chance ?? 0).toBe((open.chance ?? 0) - 50);
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

  it("applies a correctly oriented edge cover to hit chance", () => {
    const grid = makeGrid(6, 5, 1);
    const attacker = unit({ x: 0, y: 2 });
    const target = unit({ id: 2, owner: 2, x: 4, y: 2 });
    const edgeCover = unit({ id: 3, owner: 0, x: 3, y: 2, coverType: 2, edge: 1, obstacle: false, weaponId: "" });
    const open = previewAttack(grid, [attacker, target], attacker, target, DEBUG_BOW);
    const protectedPreview = previewAttack(grid, [attacker, target, edgeCover], attacker, target, DEBUG_BOW);
    expect(protectedPreview.chance ?? 0).toBe((open.chance ?? 0) - 50);
  });

  it("grants leshy at least half cover next to a camouflage provider", () => {
    const grid = makeGrid(6, 3, 1);
    const attacker = unit({ x: 0, y: 1, aim: 100 });
    const target = unit({ id: 2, owner: 2, x: 4, y: 1, camouflageMinCover: true });
    const provider = unit({ id: 3, owner: 2, x: 4, y: 2, providesCamouflage: true });
    const open = previewAttack(grid, [attacker, target], attacker, target, DEBUG_BOW);
    const masked = previewAttack(grid, [attacker, target, provider], attacker, target, DEBUG_BOW);
    expect(masked.cover).toBe(1);
    expect(masked.chance).toBe((open.chance ?? 0) - 25);
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

describe("defensive stance", () => {
  it("reduces hit chance by 25 and previewed damage by 2", () => {
    const grid = makeGrid(5, 1, 1);
    const attacker = unit({ x: 0, y: 0, aim: 100 });
    const target = unit({ id: 2, owner: 2, x: 4, y: 0 });
    const normal = previewAttack(grid, [attacker, target], attacker, target, DEBUG_BOW);
    target.defending = true;
    const defended = previewAttack(grid, [attacker, target], attacker, target, DEBUG_BOW);
    expect(defended.chance).toBe((normal.chance ?? 0) - 25);
    expect(defended.dmgMin).toBe(Math.max(0, DEBUG_BOW.minDmg - 2));
    expect(defended.dmgMax).toBe(Math.max(0, DEBUG_BOW.maxDmg - 2));
    expect(defended.breakdown?.stanceDefense).toBe(25);
  });

  it("reduces resolved attack damage by exactly 2, down to zero", () => {
    const grid = makeGrid(2, 1, 1);
    const attacker = unit({ x: 0, y: 0, aim: 100 });
    const normalTarget = unit({ id: 2, owner: 2, x: 1, y: 0 });
    const defendedTarget = unit({ ...normalTarget, defending: true });
    const rolls = () => {
      const values = [1, 100, 3];
      return { nextInt: () => values.shift() ?? 1, getState: () => 0 };
    };
    const weapon = { ...DEBUG_BOW, minDmg: 3, maxDmg: 3, crit: 0, critBonus: 0 };
    const normal = resolveAttack(grid, [attacker, normalTarget], attacker, normalTarget, weapon, rolls());
    const defended = resolveAttack(grid, [attacker, defendedTarget], attacker, defendedTarget, weapon, rolls());
    expect(normal?.damage).toBe(3);
    expect(defended?.damage).toBe(1);
  });
});

describe("kernel attack", () => {
  it("charges two AP for the arquebus and applies its close-range penalty", () => {
    const pishchal = {
      ...DEBUG_BOW,
      id: "pishchal",
      apCost: 2,
      range: 10,
      closeRangePenalty: { distHLessThan: 4, penalty: 30 },
    };
    const grid = makeGrid(7, 1, 1);
    const attacker = unit({ x: 0, y: 0, ap: 2, weaponId: pishchal.id, weaponIds: [pishchal.id] });
    const close = unit({ id: 2, owner: 2, x: 2, y: 0 });
    const far = unit({ id: 3, owner: 2, x: 5, y: 0 });
    const closePreview = previewAttack(grid, [attacker, close, far], attacker, close, pishchal);
    const farPreview = previewAttack(grid, [attacker, close, far], attacker, far, pishchal);
    expect(closePreview.chance).toBe((farPreview.chance ?? 0) - 30);
    const kernel = createTacticsKernel({
      initial: { turnNumber: 1, activeOwner: 1, grid, entities: [attacker, close, far] },
      weapons: { [pishchal.id]: pishchal },
      seed: 2,
    });
    expect(kernel.apply({ type: "ATTACK", actorId: 1, targetId: 3, weaponId: pishchal.id }).ok).toBe(true);
    expect(kernel.getSnapshot().entities.find((entity) => entity.id === 1)?.ap).toBe(0);
  });

  it("resolves a shot and can kill", () => {
    const kernel = createTacticsKernel({ seed: 1 });
    const preview = kernel.getHitPreview(1, 4);
    expect(preview.available).toBe(true);
    expect(preview.chance).toBeGreaterThan(0);
    const result = kernel.apply({ type: "ATTACK", actorId: 1, targetId: 4, weaponId: "bow_debug" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const combat = result.events.find((event) => event.type === "COMBAT_RESOLVED");
    expect(combat && combat.type === "COMBAT_RESOLVED").toBe(true);
    const actor = kernel.getSnapshot().entities.find((entity) => entity.id === 1);
    expect(actor?.ap).toBe(0);
  });

  it("continues the exact RNG sequence after restoring a snapshot", () => {
    const weapon = { ...DEBUG_BOW, id: "repeat_bow", endsTurn: false, minDmg: 1, maxDmg: 3 };
    const initial = createTacticsKernel().getSnapshot();
    const actor = initial.entities.find((entity) => entity.id === 1)!;
    actor.weaponId = weapon.id;
    actor.weaponIds = [weapon.id];
    const first = createTacticsKernel({ initial, weapons: { [weapon.id]: weapon }, seed: 123 });
    expect(first.apply({ type: "ATTACK", actorId: 1, targetId: 4, weaponId: weapon.id }).ok).toBe(true);
    const restored = createTacticsKernel({ initial: first.getSnapshot(), weapons: { [weapon.id]: weapon } });
    const nextA = first.apply({ type: "ATTACK", actorId: 1, targetId: 4, weaponId: weapon.id });
    const nextB = restored.apply({ type: "ATTACK", actorId: 1, targetId: 4, weaponId: weapon.id });
    expect(nextA).toEqual(nextB);
  });

  it("rejects a melee weapon out of reach", () => {
    const kernel = createTacticsKernel();
    const preview = kernel.getHitPreview(1, 4, DEBUG_SWORD.id);
    expect(preview.available).toBe(false);
    expect(preview.reason).toBe("ILLEGAL");
  });
});
