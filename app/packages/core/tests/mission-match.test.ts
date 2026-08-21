import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRAINING_UNITS,
  ENEMY_OWNER,
  PLAYER_OWNER,
  createMissionMatch,
  livingOf,
} from "../src/index.js";

const MAP = {
  width: 12,
  height: 10,
  pitChance: 0.05,
  coverDensity: 0.07,
  wallDensity: 0.025,
  edgeCoverChance: 0.4,
  halfCoverChance: 0.55,
  heightMix: { z0: 0.15, z1: 0.7, z2: 0.15 },
};

describe("createMissionMatch", () => {
  it("deploys the fixed squad and the exact enemy composition", () => {
    const match = createMissionMatch({
      units: Object.values(DEFAULT_TRAINING_UNITS),
      map: MAP,
      playerSlots: ["bogatyr", "strelets", "znaharka"],
      enemies: [
        { unitId: "upyr", count: 2 },
        { unitId: "leshy", count: 2 },
      ],
      seed: 41,
    });
    const players = livingOf(match, PLAYER_OWNER);
    const enemies = livingOf(match, ENEMY_OWNER);
    expect(players.map((entity) => entity.configId).sort()).toEqual(["bogatyr", "strelets", "znaharka"]);
    expect(enemies).toHaveLength(4);
    expect(enemies.filter((entity) => entity.configId === "upyr")).toHaveLength(2);
    expect(enemies.filter((entity) => entity.configId === "leshy")).toHaveLength(2);
  });

  it("is deterministic for a given seed and map", () => {
    const options = {
      units: Object.values(DEFAULT_TRAINING_UNITS),
      map: MAP,
      playerSlots: ["bogatyr", "strelets", "znaharka"] as const,
      enemies: [{ unitId: "kikimora", count: 3 }],
      seed: 42,
    };
    const first = createMissionMatch(options);
    const second = createMissionMatch(options);
    expect(second.grid.tiles).toEqual(first.grid.tiles);
    const entities = (state: typeof first) =>
      state.entities
        .filter((entity) => entity.coverType === 0)
        .map((entity) => [entity.id, entity.configId, entity.x, entity.y, entity.z]);
    expect(entities(second)).toEqual(entities(first));
  });

  it("supports larger compositions up to spawn capacity", () => {
    const match = createMissionMatch({
      units: Object.values(DEFAULT_TRAINING_UNITS),
      map: MAP,
      playerSlots: ["bogatyr", "strelets", "znaharka"],
      enemies: [
        { unitId: "upyr", count: 4 },
        { unitId: "leshy", count: 3 },
        { unitId: "kikimora", count: 2 },
      ],
      seed: 43,
    });
    expect(livingOf(match, ENEMY_OWNER)).toHaveLength(9);
  });

  it("throws when the enemy count exceeds the spawn capacity", () => {
    expect(() =>
      createMissionMatch({
        units: Object.values(DEFAULT_TRAINING_UNITS),
        map: MAP,
        playerSlots: ["bogatyr", "strelets", "znaharka"],
        enemies: [{ unitId: "upyr", count: 17 }],
        seed: 44,
      }),
    ).toThrow();
  });
});

describe("createMissionMatch roster modifiers", () => {
  it("applies wound penalties and preserved hp to deployed fighters", () => {
    const match = createMissionMatch({
      units: Object.values(DEFAULT_TRAINING_UNITS),
      map: MAP,
      playerSlots: [
        { unitId: "bogatyr", aimMod: -15, defenseMod: -10, mobilityMod: -1, hp: 4 },
        "strelets",
      ],
      enemies: [{ unitId: "upyr", count: 2 }],
      seed: 51,
    });
    const bogatyr = livingOf(match, PLAYER_OWNER).find((entity) => entity.configId === "bogatyr")!;
    const strelets = livingOf(match, PLAYER_OWNER).find((entity) => entity.configId === "strelets")!;
    const base = DEFAULT_TRAINING_UNITS.bogatyr!;
    expect(bogatyr.aim).toBe(base.aim - 15);
    expect(bogatyr.defense).toBe(base.defense - 10);
    expect(bogatyr.mobility).toBe(base.mobility - 1);
    expect(bogatyr.hp).toBe(4);
    expect(bogatyr.maxHp).toBe(base.maxHealth);
    expect(strelets.aim).toBe(DEFAULT_TRAINING_UNITS.strelets!.aim);
    expect(strelets.hp).toBe(DEFAULT_TRAINING_UNITS.strelets!.maxHealth);
  });
});
