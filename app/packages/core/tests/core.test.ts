import { describe, expect, it } from "vitest";
import { CORE_VERSION, createTacticsKernel, makeGrid } from "../src/index.js";
import type { EntityState, MatchState } from "../src/types.js";
import type { WeaponStats } from "../src/weapons.js";

describe("package version", () => {
  it("is 0.20.38", () => {
    expect(CORE_VERSION).toBe("0.20.38");
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

describe("createTacticsKernel save/restore continuity (0.13.0)", () => {
  it("continues the rng sequence from a restored snapshot", () => {
    const sword: WeaponStats = { id: "sword", category: "melee", apCost: 1, endsTurn: false, range: 1, requiresLOS: false, aimMod: 0, minDmg: 3, maxDmg: 3, crit: 0, critBonus: 0, envDmg: 0 };
    const unit = (id: number, owner: number, x: number, y: number): EntityState => ({
      id, configId: `u${id}`, owner, x, y, z: 1, dir: 1, ap: 2, maxAp: 2, mobility: 5,
      hp: 50, maxHp: 50, aim: 100, defense: 0, will: 20, vision: 10,
      weaponId: "sword", weaponIds: ["sword"], skillIds: [], obstacle: true, dead: false, flying: false,
      coverType: 0, overwatch: false, defending: false, movementSpent: 0,
    });
    const make = (initial: MatchState): ReturnType<typeof createTacticsKernel> =>
      createTacticsKernel({ initial, weapons: { sword }, skills: {}, seed: 77 });
    const state: MatchState = { turnNumber: 1, activeOwner: 1, grid: makeGrid(8, 6, 1), entities: [unit(1, 1, 1, 1), unit(2, 2, 2, 1)], rngSeed: "77", rngState: "77" };

    const original = make(state);
    // Ход: атака (не завершает активацию), затем полный цикл ходов для сброса.
    expect(original.apply({ type: "ATTACK", actorId: 1, targetId: 2, weaponId: "sword" }).ok).toBe(true);
    expect(original.apply({ type: "END_TURN", playerId: "1" }).ok).toBe(true);
    expect(original.apply({ type: "END_TURN", playerId: "2" }).ok).toBe(true);
    // Третье испытание генератора: прямой ход против восстановленного из снимка.
    const before = original.getSnapshot();
    const restored = make(before);
    const first = original.apply({ type: "ATTACK", actorId: 1, targetId: 2, weaponId: "sword" });
    const second = restored.apply({ type: "ATTACK", actorId: 1, targetId: 2, weaponId: "sword" });
    expect(first.ok && second.ok).toBe(true);
    const dmg = (events: unknown[], type: string) => {
      const found = (events as { type: string; damageDealt?: number }[]).find((event) => event.type === type);
      return found?.damageDealt;
    };
    expect(dmg(first.ok ? first.events : [], "COMBAT_RESOLVED")).toBe(dmg(second.ok ? second.events : [], "COMBAT_RESOLVED"));
  });
});
