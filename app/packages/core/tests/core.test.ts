import { describe, expect, it } from "vitest";
import { CORE_VERSION, createTacticsKernel, makeGrid } from "../src/index.js";
import type { EntityState } from "../src/types.js";

describe("package version", () => {
  it("is 0.13.0", () => {
    expect(CORE_VERSION).toBe("0.13.0");
  });
});

describe("createTacticsKernel owner rotation", () => {
  it("rotates turns across all living owners, not only the fixed pair", () => {
    const unit = (id: number, owner: number): EntityState => ({
      id, configId: `u${id}`, owner, x: id, y: 1, z: 1, dir: 0,
      ap: 2, maxAp: 2, mobility: 5, hp: 10, maxHp: 10, aim: 70, defense: 0, vision: 10,
      weaponId: "", weaponIds: [], skillIds: [], obstacle: true, dead: false, flying: false,
      coverType: 0, overwatch: false, defending: false, movementSpent: 0,
    });
    const kernel = createTacticsKernel({
      initial: {
        turnNumber: 1,
        activeOwner: 1,
        grid: makeGrid(6, 4, 1),
        entities: [unit(1, 1), unit(2, 2), unit(3, 3)],
      },
      seed: 9,
    });
    expect(kernel.apply({ type: "END_TURN", playerId: "1" }).ok).toBe(true);
    expect(kernel.getSnapshot().activeOwner).toBe(2);
    expect(kernel.apply({ type: "END_TURN", playerId: "2" }).ok).toBe(true);
    expect(kernel.getSnapshot().activeOwner).toBe(3);
    expect(kernel.apply({ type: "END_TURN", playerId: "3" }).ok).toBe(true);
    expect(kernel.getSnapshot().activeOwner).toBe(1);
  });
});
