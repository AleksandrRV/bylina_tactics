import { describe, expect, it } from "vitest";
import { createPvpMatch, createTacticsKernel, livingOf, makeGrid } from "../src/index.js";
import { ENEMY_OWNER, PLAYER_OWNER } from "../src/debug-map.js";
import type { SpawnUnitConfig } from "../src/defaults.js";
import type { WeaponStats } from "../src/weapons.js";
import { DEFAULT_TRAINING_UNITS } from "../src/defaults.js";

const MAP = {
  width: 12,
  height: 10,
  pitChance: 0.04,
  coverDensity: 0.06,
  wallDensity: 0.02,
  edgeCoverChance: 0.4,
  halfCoverChance: 0.55,
  heightMix: { z0: 0.15, z1: 0.7, z2: 0.15 },
};

describe("createPvpMatch (0.14.0)", () => {
  it("deploys both sides on opposite edges with distinct cells", () => {
    const match = createPvpMatch({
      units: Object.values(DEFAULT_TRAINING_UNITS),
      map: MAP,
      side1: ["bogatyr", "strelets", "znaharka"],
      side2: ["bogatyr", "strelets", "znaharka"],
      seed: 91,
    });
    const side1 = livingOf(match, PLAYER_OWNER);
    const side2 = livingOf(match, ENEMY_OWNER);
    expect(side1).toHaveLength(3);
    expect(side2).toHaveLength(3);
    // Сторона 1 — западный край, сторона 2 — восточный.
    expect(side1.every((entity) => entity.x <= 2)).toBe(true);
    expect(side2.every((entity) => entity.x >= MAP.width - 3)).toBe(true);
    const cells = [...side1, ...side2].map((entity) => `${entity.x},${entity.y}`);
    expect(new Set(cells).size).toBe(6);
    expect(match.activeOwner).toBe(PLAYER_OWNER);
  });

  it("is deterministic for a given seed", () => {
    const options = {
      units: Object.values(DEFAULT_TRAINING_UNITS),
      map: MAP,
      side1: ["bogatyr", "strelets"],
      side2: ["bogatyr", "strelets"],
      seed: 92,
    };
    const first = createPvpMatch(options);
    const second = createPvpMatch(options);
    expect(second.grid.tiles).toEqual(first.grid.tiles);
    const entities = (state: typeof first) =>
      state.entities
        .filter((entity) => entity.coverType === 0)
        .map((entity) => [entity.id, entity.configId, entity.x, entity.y]);
    expect(entities(second)).toEqual(entities(first));
  });
});

describe("pvp battle flow", () => {
  const SWORD: WeaponStats = {
    id: "sword",
    category: "melee",
    apCost: 1,
    endsTurn: true,
    range: 1,
    requiresLOS: false,
    aimMod: 0,
    minDmg: 20,
    maxDmg: 20,
    crit: 0,
    critBonus: 0,
    envDmg: 0,
  };

  it("ends by elimination when one side is wiped out", () => {
    const match = createPvpMatch({
      units: Object.values(DEFAULT_TRAINING_UNITS),
      map: MAP,
      side1: ["bogatyr"],
      side2: ["bogatyr"],
      seed: 93,
    });
    // Поставить бойцов вплотную (состояние до создания ядра).
    const side1 = match.entities.find((entity) => entity.owner === PLAYER_OWNER && entity.coverType === 0)!;
    const side2 = match.entities.find((entity) => entity.owner === ENEMY_OWNER && entity.coverType === 0)!;
    const clear = (x: number, y: number): void => {
      const tile = match.grid.tiles.find((tile) => tile.x === x && tile.y === y)!;
      tile.pit = false;
      tile.blockLOS = false;
      for (const other of match.entities) {
        if (other.x === x && other.y === y && other.id !== side1.id && other.id !== side2.id) other.x += 3;
      }
    };
    clear(4, 4);
    clear(5, 4);
    side1.x = 4;
    side1.y = 4;
    side1.z = match.grid.tiles.find((tile) => tile.x === 4 && tile.y === 4)!.z;
    side2.x = 5;
    side2.y = 4;
    side2.z = match.grid.tiles.find((tile) => tile.x === 5 && tile.y === 4)!.z;
    const kernel = createTacticsKernel({ initial: match, weapons: { sword: SWORD }, skills: {}, seed: 93 });
    const result = kernel.apply({ type: "ATTACK", actorId: side1.id, targetId: side2.id, weaponId: "sword" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toContainEqual({
      type: "MATCH_ENDED",
      winnerPlayerId: String(PLAYER_OWNER),
      reason: "ELIMINATION",
    });
  });

  it("rotates turns between the two human sides", () => {
    const match = createPvpMatch({
      units: Object.values(DEFAULT_TRAINING_UNITS),
      map: MAP,
      side1: ["bogatyr"],
      side2: ["bogatyr"],
      seed: 94,
    });
    const kernel = createTacticsKernel({ initial: match, weapons: {}, skills: {}, seed: 94 });
    expect(kernel.apply({ type: "END_TURN", playerId: String(PLAYER_OWNER) }).ok).toBe(true);
    expect(kernel.getSnapshot().activeOwner).toBe(ENEMY_OWNER);
    expect(kernel.apply({ type: "END_TURN", playerId: String(ENEMY_OWNER) }).ok).toBe(true);
    expect(kernel.getSnapshot().activeOwner).toBe(PLAYER_OWNER);
  });
});
