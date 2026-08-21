import { describe, expect, it } from "vitest";
import type { EntityState } from "@bylina/core";
import { interactiveEntityAt, primaryAttackForEnemy } from "../src/cell-interaction.js";

function entity(partial: Partial<EntityState>): EntityState {
  return {
    id: 1,
    configId: "test",
    owner: 0,
    x: 2,
    y: 2,
    z: 1,
    dir: 0,
    ap: 0,
    maxAp: 0,
    mobility: 0,
    hp: 1,
    maxHp: 1,
    aim: 0,
    defense: 0,
    vision: 0,
    weaponId: "",
    obstacle: false,
    dead: false,
    flying: false,
    coverType: 1,
    overwatch: false,
    ...partial,
  };
}

describe("cell interaction priority", () => {
  it("leaves a reachable cell with edge cover to movement", () => {
    const edgeCover = entity({ edge: 1, coverType: 2 });
    expect(interactiveEntityAt([edgeCover], 2, 2, true)).toBeUndefined();
  });

  it("allows targeting cover when movement is disabled by weapon mode", () => {
    const edgeCover = entity({ edge: 1, coverType: 2 });
    expect(interactiveEntityAt([edgeCover], 2, 2, false)?.id).toBe(edgeCover.id);
  });

  it("allows targeting full cover when its cell is not reachable", () => {
    const fullCover = entity({ obstacle: true, coverType: 2 });
    expect(interactiveEntityAt([fullCover], 2, 2, false)?.id).toBe(fullCover.id);
  });

  it("prioritizes a living unit over cover in the same cell", () => {
    const edgeCover = entity({ id: 2, edge: 3 });
    const unit = entity({ id: 3, owner: 2, coverType: 0, maxAp: 2, obstacle: true });
    expect(interactiveEntityAt([edgeCover, unit], 2, 2, true)?.id).toBe(unit.id);
  });

  it("selects an enemy with the primary weapon while movement mode is active", () => {
    const selected = entity({
      id: 10,
      owner: 1,
      coverType: 0,
      weaponId: "sword",
      weaponIds: ["sword", "mace"],
      maxAp: 2,
      obstacle: true,
    });
    const enemy = entity({ id: 11, owner: 2, coverType: 0, maxAp: 2, obstacle: true });
    expect(primaryAttackForEnemy(selected, enemy, 1, false)).toEqual({ type: "weapon", id: "sword" });
    expect(primaryAttackForEnemy(selected, enemy, 1, true)).toBeNull();
  });
});
