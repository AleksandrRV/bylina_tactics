import { describe, expect, it } from "vitest";
import { createTacticsKernel } from "../src/kernel.js";
import { makeGrid } from "../src/grid.js";
import { DEBUG_BOW } from "../src/weapons.js";
import type { EntityState, MatchState } from "../src/types.js";

function unit(id: number, owner: number, x: number, y: number, dir: number): EntityState {
  return {
    id, configId: `u${id}`, owner, x, y, z: 1, dir, ap: 2, maxAp: 2, mobility: 5,
    hp: 20, maxHp: 20, aim: 100, defense: 0, vision: 10,
    weaponId: DEBUG_BOW.id, weaponIds: [DEBUG_BOW.id], skillIds: [],
    obstacle: true, dead: false, flying: false, hidden: false, coverType: 0,
    overwatch: false, movementSpent: 0,
  };
}

function scenario(): { state: MatchState; watcher: EntityState; mover: EntityState } {
  const watcher = unit(1, 1, 0, 1, 1);
  const mover = unit(2, 2, 4, 1, 3);
  return {
    watcher,
    mover,
    state: { turnNumber: 1, activeOwner: 1, grid: makeGrid(7, 3, 1), entities: [watcher, mover] },
  };
}

describe("overwatch (§14)", () => {
  it("spends the exact AP remainder and fires once on entry", () => {
    const { state, watcher, mover } = scenario();
    watcher.ap = 1;
    const kernel = createTacticsKernel({ initial: state, weapons: { [DEBUG_BOW.id]: DEBUG_BOW }, seed: 3 });
    const set = kernel.apply({ type: "OVERWATCH", actorId: watcher.id });
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    expect(set.events).toContainEqual({ type: "STAT_CHANGED", entityId: watcher.id, stat: "AP", newValue: 0, delta: -1 });

    expect(kernel.apply({ type: "END_TURN", playerId: "1" }).ok).toBe(true);
    const move = kernel.apply({ type: "MOVE", actorId: mover.id, to: { x: 2, y: 1, z: 1 } });
    expect(move.ok).toBe(true);
    if (!move.ok) return;
    expect(move.events.filter((event) => event.type === "OVERWATCH_FIRED")).toHaveLength(1);
    expect(move.events.some((event) => event.type === "COMBAT_RESOLVED" && event.sourceId === watcher.id)).toBe(true);
    expect(kernel.getSnapshot().entities.find((entity) => entity.id === watcher.id)?.overwatch).toBe(false);
  });

  it("checks every entered cell and stops the route in the death cell", () => {
    const { state, watcher, mover } = scenario();
    watcher.hp = 20;
    mover.hp = 1;
    const lethal = { ...DEBUG_BOW, minDmg: 20, maxDmg: 20, crit: 0, critBonus: 0 };
    const kernel = createTacticsKernel({ initial: state, weapons: { [DEBUG_BOW.id]: lethal }, seed: 1 });
    kernel.apply({ type: "OVERWATCH", actorId: watcher.id });
    kernel.apply({ type: "END_TURN", playerId: "1" });
    const result = kernel.apply({ type: "MOVE", actorId: mover.id, to: { x: 1, y: 1, z: 1 } });
    expect(result.ok).toBe(true);
    const after = kernel.getSnapshot().entities.find((entity) => entity.id === mover.id)!;
    expect(after.dead).toBe(true);
    expect(after.x).toBeGreaterThan(1);
  });

  it("clears unused overwatch at the start of the owner's next turn", () => {
    const { state, watcher } = scenario();
    const kernel = createTacticsKernel({ initial: state, weapons: { [DEBUG_BOW.id]: DEBUG_BOW } });
    kernel.apply({ type: "OVERWATCH", actorId: watcher.id });
    kernel.apply({ type: "END_TURN", playerId: "1" });
    kernel.apply({ type: "END_TURN", playerId: "2" });
    const after = kernel.getSnapshot().entities.find((entity) => entity.id === watcher.id)!;
    expect(after.overwatch).toBe(false);
    expect(after.ap).toBe(after.maxAp);
  });

  it("sets defensive stance for the enemy turn and clears it on the next owner turn", () => {
    const { state, watcher } = scenario();
    watcher.ap = 1;
    const kernel = createTacticsKernel({ initial: state, weapons: { [DEBUG_BOW.id]: DEBUG_BOW } });
    const defended = kernel.apply({ type: "DEFEND", actorId: watcher.id });
    expect(defended.ok).toBe(true);
    if (!defended.ok) return;
    expect(defended.events).toContainEqual({ type: "STAT_CHANGED", entityId: watcher.id, stat: "AP", newValue: 0, delta: -1 });
    expect(defended.events).toContainEqual({ type: "STATUS_CHANGED", entityId: watcher.id, status: "DEFENDING", applied: true });
    kernel.apply({ type: "END_TURN", playerId: "1" });
    expect(kernel.getSnapshot().entities.find((entity) => entity.id === watcher.id)?.defending).toBe(true);
    kernel.apply({ type: "END_TURN", playerId: "2" });
    const after = kernel.getSnapshot().entities.find((entity) => entity.id === watcher.id)!;
    expect(after.defending).toBe(false);
    expect(after.ap).toBe(after.maxAp);
  });

  it("rejects an END_TURN command from the wrong side", () => {
    const { state } = scenario();
    const kernel = createTacticsKernel({ initial: state, weapons: { [DEBUG_BOW.id]: DEBUG_BOW } });
    expect(kernel.apply({ type: "END_TURN", playerId: "2" })).toEqual({ ok: false, reason: "NOT_YOUR_TURN" });
  });
});
