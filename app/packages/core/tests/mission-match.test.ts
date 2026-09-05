import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRAINING_UNITS,
  ENEMY_OWNER,
  PLAYER_OWNER,
  createMissionMatch,
  livingOf,
  setEntityWeapons,
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
      playerSlots: [{ unitId: "bogatyr", aimMod: -15, defenseMod: -10, mobilityMod: -1, hp: 4 }, "strelets"],
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

describe("createMissionMatch equipment", () => {
  it("adds equipment weapon and stat/maxHp modifiers to a deployed fighter", () => {
    const match = createMissionMatch({
      units: Object.values(DEFAULT_TRAINING_UNITS),
      map: MAP,
      playerSlots: [{ unitId: "bogatyr", extraWeaponIds: ["bow"], aimMod: 15, maxHpMod: 3, hp: 10 }, "strelets"],
      enemies: [{ unitId: "upyr", count: 2 }],
      seed: 61,
    });
    const bogatyr = livingOf(match, PLAYER_OWNER).find((entity) => entity.configId === "bogatyr")!;
    expect(bogatyr.weaponIds).toContain("bow");
    expect(bogatyr.maxHp).toBe(DEFAULT_TRAINING_UNITS.bogatyr!.maxHealth + 3);
    // Снаряжение не лечит: сохранённое здоровье переносится как есть.
    expect(bogatyr.hp).toBe(10);
    expect(bogatyr.aim).toBe(DEFAULT_TRAINING_UNITS.bogatyr!.aim + 15);
    // Уникальность: повторный id не дублируется.
    const match2 = createMissionMatch({
      units: Object.values(DEFAULT_TRAINING_UNITS),
      map: MAP,
      playerSlots: [{ unitId: "bogatyr", extraWeaponIds: ["bow", "bow"] }],
      enemies: [{ unitId: "upyr", count: 2 }],
      seed: 62,
    });
    const hero = livingOf(match2, PLAYER_OWNER).find((entity) => entity.configId === "bogatyr")!;
    expect(hero.weaponIds?.filter((id) => id === "bow")).toHaveLength(1);
    expect(hero.weaponIds).not.toContain("strike");
  });

  it("gives the unarmed strike when a fighter has no weapon and removes it once armed", () => {
    const empty = createMissionMatch({
      units: Object.values(DEFAULT_TRAINING_UNITS),
      map: MAP,
      playerSlots: ["bogatyr", "strelets"],
      enemies: [{ unitId: "upyr", count: 1 }],
      seed: 63,
    });
    const unarmed = livingOf(empty, PLAYER_OWNER).find((entity) => entity.configId === "bogatyr")!;
    expect(unarmed.weaponIds).toEqual(["strike"]);
    expect(unarmed.weaponId).toBe("strike");
    const armed = createMissionMatch({
      units: Object.values(DEFAULT_TRAINING_UNITS),
      map: MAP,
      playerSlots: [{ unitId: "bogatyr", extraWeaponIds: ["bow"] }],
      enemies: [{ unitId: "upyr", count: 1 }],
      seed: 64,
    });
    const hero = livingOf(armed, PLAYER_OWNER).find((entity) => entity.configId === "bogatyr")!;
    expect(hero.weaponIds).toEqual(["bow"]);
    expect(hero.weaponId).toBe("bow");
  });
});

describe("createMissionMatch deployment size", () => {
  it("deploys up to five fighters on distinct spawn cells", () => {
    const match = createMissionMatch({
      units: Object.values(DEFAULT_TRAINING_UNITS),
      map: MAP,
      playerSlots: ["bogatyr", "strelets", "znaharka", "bogatyr", "strelets"],
      enemies: [{ unitId: "upyr", count: 3 }],
      seed: 45,
    });
    const players = livingOf(match, PLAYER_OWNER);
    expect(players).toHaveLength(5);
    const cells = players.map((entity) => `${entity.x},${entity.y}`);
    expect(new Set(cells).size).toBe(5);
  });
});

describe("createMissionMatch roster markers", () => {
  it("tags deployed fighters with rosterIndex in deployment order", () => {
    const match = createMissionMatch({
      units: Object.values(DEFAULT_TRAINING_UNITS),
      map: MAP,
      playerSlots: ["bogatyr", "strelets", "znaharka"],
      enemies: [{ unitId: "upyr", count: 2 }],
      seed: 46,
    });
    const players = livingOf(match, PLAYER_OWNER).sort((a, b) => a.id - b.id);
    expect(players.map((entity) => entity.rosterIndex)).toEqual([0, 1, 2]);
    const enemies = livingOf(match, ENEMY_OWNER);
    expect(enemies.every((entity) => entity.rosterIndex === undefined)).toBe(true);
  });

  it("keeps rosterIndex stable when a fighter is removed from the field", () => {
    const match = createMissionMatch({
      units: Object.values(DEFAULT_TRAINING_UNITS),
      map: MAP,
      playerSlots: ["bogatyr", "strelets", "znaharka"],
      enemies: [{ unitId: "upyr", count: 2 }],
      seed: 47,
    });
    // Имитация исхода FLED/EXTRACTED: первый боец удалён из состояния.
    match.entities = match.entities.filter((entity) => entity.rosterIndex !== 0);
    const remaining = match.entities
      .filter((entity) => entity.owner === PLAYER_OWNER && entity.coverType === 0)
      .sort((a, b) => a.id - b.id);
    expect(remaining.map((entity) => entity.rosterIndex)).toEqual([1, 2]);
  });
});
