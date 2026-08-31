import { describe, expect, it } from "vitest";
import { createTacticsKernel, makeGrid, type WeaponStats } from "../src/index.js";
import type { EntityState, MatchState } from "../src/types.js";

const KNIFE: WeaponStats = {
  id: "knife",
  category: "melee",
  apCost: 1,
  endsTurn: true,
  range: 1,
  requiresLOS: false,
  aimMod: 0,
  minDmg: 1,
  maxDmg: 1,
  crit: 0,
  critBonus: 0,
  envDmg: 0,
};

function unit(partial: Partial<EntityState>): EntityState {
  return {
    id: 1,
    configId: "u",
    owner: 1,
    x: 2,
    y: 2,
    z: 1,
    dir: 1,
    ap: 2,
    maxAp: 2,
    mobility: 5,
    hp: 12,
    maxHp: 12,
    aim: 100,
    defense: 0,
    will: 40,
    vision: 12,
    weaponId: "knife",
    weaponIds: ["knife"],
    skillIds: [],
    obstacle: true,
    dead: false,
    flying: false,
    coverType: 0,
    overwatch: false,
    defending: false,
    movementSpent: 0,
    ...partial,
  };
}

describe("panic from a dead source (§15.3)", () => {
  it("a panicked unit does not flee from a dead source and burns AP", () => {
    const source = unit({ id: 1, configId: "kikimora", owner: 2, x: 6, y: 2, dead: true, obstacle: false, hp: 0 });
    const victim = unit({
      id: 2,
      configId: "bogatyr",
      owner: 1,
      x: 2,
      y: 2,
      panic: { sourceId: 1, turnsLeft: 1 },
      ap: 2,
    });
    const state: MatchState = { turnNumber: 1, activeOwner: 1, grid: makeGrid(8, 6, 1), entities: [source, victim] };
    const kernel = createTacticsKernel({ initial: state, weapons: { knife: KNIFE }, skills: {}, seed: 1 });
    const before = kernel.getSnapshot().entities.find((e) => e.id === 2)!;
    kernel.apply({ type: "END_TURN", playerId: "1" });
    const after = kernel.getSnapshot().entities.find((e) => e.id === 2)!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.ap).toBe(0);
    expect(after.panic).toBeUndefined();
  });
});
