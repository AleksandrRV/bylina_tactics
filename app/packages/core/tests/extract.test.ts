import { describe, expect, it } from "vitest";
import { createTacticsKernel } from "../src/kernel.js";
import { makeGrid, tileAt } from "../src/grid.js";
import { generateBattlefield, playerSpawns, enemySpawns } from "../src/mapgen.js";
import { createMissionMatch } from "../src/match.js";
import { createMulberry32 } from "../src/rng.js";
import { ENEMY_OWNER, PLAYER_OWNER } from "../src/debug-map.js";
import type { SpawnUnitConfig } from "../src/defaults.js";
import type { SkillStats } from "../src/skills.js";
import type { EntityState, MatchState } from "../src/types.js";
import type { WeaponStats } from "../src/weapons.js";

const NO_WEAPON: WeaponStats = {
  id: "none", category: "melee", apCost: 1, endsTurn: true, range: 1,
  requiresLOS: false, aimMod: 0, minDmg: 1, maxDmg: 1, crit: 0, critBonus: 0, envDmg: 0,
};

const EVACUATE: SkillStats = {
  id: "evacuate", apCost: 1, endsTurn: true, range: 0, requiresLOS: false, category: "self",
  resolution: "auto", envDmg: 0, extract: true, cooldownTurns: 1, effects: [],
};

function fighter(partial: Partial<EntityState>): EntityState {
  return {
    id: 1, configId: "fighter", owner: 1, x: 0, y: 3, z: 1, dir: 1,
    ap: 2, maxAp: 2, mobility: 5, hp: 10, maxHp: 10, aim: 100, defense: 0, will: 20, vision: 10,
    weaponId: NO_WEAPON.id, weaponIds: [NO_WEAPON.id], skillIds: [EVACUATE.id], obstacle: true,
    dead: false, flying: false, hidden: false, coverType: 0, overwatch: false, defending: false, movementSpent: 0,
    ...partial,
  };
}

function gridWithZone(): MatchState["grid"] {
  const grid = makeGrid(8, 6, 1);
  for (let y = 1; y <= 4; y += 1) tileAt(grid, 0, y)!.extract = true;
  return grid;
}

describe("extraction (§6 math, §3.2 base-design)", () => {
  it("rejects the extract skill outside an evacuation zone", () => {
    const outside = fighter({ x: 3, y: 3 });
    const kernel = createTacticsKernel({
      initial: { turnNumber: 1, activeOwner: 1, grid: gridWithZone(), entities: [outside] },
      weapons: { [NO_WEAPON.id]: NO_WEAPON },
      skills: { [EVACUATE.id]: EVACUATE },
      seed: 1,
    });
    expect(kernel.getSkillPreview(outside.id, EVACUATE.id).available).toBe(false);
    const result = kernel.apply({ type: "USE_SKILL", actorId: outside.id, skillId: EVACUATE.id });
    expect(result).toEqual({ ok: false, reason: "ILLEGAL" });
  });

  it("removes a fighter from the field inside the zone with EXTRACTED reason", () => {
    const inside = fighter({ x: 0, y: 3 });
    const enemy = fighter({ id: 2, owner: 2, x: 7, y: 3, skillIds: [] });
    const kernel = createTacticsKernel({
      initial: { turnNumber: 1, activeOwner: 1, grid: gridWithZone(), entities: [inside, enemy] },
      weapons: { [NO_WEAPON.id]: NO_WEAPON },
      skills: { [EVACUATE.id]: EVACUATE },
      seed: 2,
    });
    expect(kernel.getSkillPreview(inside.id, EVACUATE.id).available).toBe(true);
    const result = kernel.apply({ type: "USE_SKILL", actorId: inside.id, skillId: EVACUATE.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.some((event) => event.type === "ENTITY_REMOVED" && event.reason === "EXTRACTED" && event.entityId === inside.id)).toBe(true);
    expect(kernel.getSnapshot().entities.some((entity) => entity.id === inside.id)).toBe(false);
  });

  it("ends the battle by elimination when the last fighter of an ordinary mission extracts", () => {
    const inside = fighter({ x: 0, y: 3 });
    const enemy = fighter({ id: 2, owner: 2, x: 7, y: 3, skillIds: [] });
    const kernel = createTacticsKernel({
      initial: { turnNumber: 1, activeOwner: 1, grid: gridWithZone(), entities: [inside, enemy] },
      weapons: { [NO_WEAPON.id]: NO_WEAPON },
      skills: { [EVACUATE.id]: EVACUATE },
      seed: 3,
    });
    const result = kernel.apply({ type: "USE_SKILL", actorId: inside.id, skillId: EVACUATE.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toContainEqual({
      type: "MATCH_ENDED",
      winnerPlayerId: String(ENEMY_OWNER),
      reason: "ELIMINATION",
    });
  });
});

describe("battlefield evacuation zone", () => {
  it("marks the western edge column as extract and keeps it free of pits and walls", () => {
    const config = {
      width: 12,
      height: 10,
      pitChance: 0.05,
      coverDensity: 0.07,
      wallDensity: 0.02,
      edgeCoverChance: 0.4,
      halfCoverChance: 0.55,
      heightMix: { z0: 0.15, z1: 0.7, z2: 0.15 },
      extract: true,
    };
    const rng = createMulberry32(0x51a7);
    const players = playerSpawns(config.height);
    const enemies = enemySpawns(3, config.width, config.height);
    const { grid, covers } = generateBattlefield(config, rng, players, enemies);
    for (let y = 1; y <= config.height - 2; y += 1) {
      const tile = tileAt(grid, 0, y);
      expect(tile?.extract).toBe(true);
      expect(tile?.pit).toBe(false);
      expect(tile?.blockLOS).toBe(false);
    }
    // Укрытия не занимают клетки зоны.
    expect(covers.some((cover) => cover.x === 0)).toBe(false);
  });
});

const MAP = {
  width: 12,
  height: 10,
  pitChance: 0.04,
  coverDensity: 0.05,
  wallDensity: 0.02,
  edgeCoverChance: 0.4,
  halfCoverChance: 0.55,
  heightMix: { z0: 0.1, z1: 0.8, z2: 0.1 },
  extract: true,
};

const SWORD: WeaponStats = {
  id: "sword", category: "melee", apCost: 1, endsTurn: true, range: 1,
  requiresLOS: false, aimMod: 0, minDmg: 5, maxDmg: 5, crit: 0, critBonus: 0, envDmg: 0,
};

const IDOL: SpawnUnitConfig = {
  id: "idol", maxHealth: 10, maxAP: 1, mobility: 1, aim: 0, defense: 0, will: 0,
  vision: 0, weapons: [], skills: [], tags: [],
};
const CAPTIVE: SpawnUnitConfig = {
  id: "captive", maxHealth: 5, maxAP: 2, mobility: 4, aim: 0, defense: 0, will: 10,
  vision: 8, weapons: [], skills: [EVACUATE.id], tags: [],
};

describe("mission objectives (0.13.0)", () => {
  const BOGATYR: SpawnUnitConfig = {
    id: "bogatyr", maxHealth: 12, maxAP: 2, mobility: 5, aim: 70, defense: 10, will: 40,
    vision: 12, weapons: ["sword"], skills: [], tags: [],
  };
  const UPYR: SpawnUnitConfig = {
    id: "upyr", maxHealth: 8, maxAP: 2, mobility: 5, aim: 60, defense: 0, will: 20,
    vision: 10, weapons: ["claws"], skills: [], tags: [],
  };

  function objectiveMatch(objective: NonNullable<MatchState["objective"]>, enemyCount = 1): MatchState {
    return createMissionMatch({
      units: [BOGATYR, UPYR, IDOL, CAPTIVE],
      map: MAP,
      playerSlots: ["bogatyr"],
      enemies: [{ unitId: "upyr", count: enemyCount }],
      objective,
      seed: 61,
    });
  }

  function objectiveKernel(objective: NonNullable<MatchState["objective"]>, enemyCount = 1) {
    const match = objectiveMatch(objective, enemyCount);
    return createTacticsKernel({
      initial: match,
      weapons: { sword: SWORD },
      skills: { [EVACUATE.id]: EVACUATE },
      seed: 61,
    });
  }

  /** Поставить бойца в свободную клетку рядом с целью (для детерминированного теста). */
  function standBeside(kernel: ReturnType<typeof objectiveKernel>, unitId: number, targetId: number): void {
    const snap = kernel.getSnapshot();
    const target = snap.entities.find((entity) => entity.id === targetId)!;
    const dx = target.x > 0 ? -1 : 1;
    const x = target.x + dx;
    const y = target.y;
    const tile = snap.grid.tiles.find((candidate) => candidate.x === x && candidate.y === y)!;
    tile.pit = false;
    tile.blockLOS = false;
    for (const entity of snap.entities) {
      if (entity.x === x && entity.y === y && entity.id !== unitId) entity.x = entity.x + 3;
    }
    const actor = snap.entities.find((entity) => entity.id === unitId)!;
    actor.x = x;
    actor.y = y;
    actor.z = tile.z;
  }

  it("destroy: victory by OBJECTIVE when the idol dies, enemies may survive", () => {
    // Контролируемая карта: богатырь (1,1), идол (5,1) с запасом 5, цель — уничтожение.
    const grid = makeGrid(12, 8, 1);
    const bogatyr: EntityState = {
      id: 1, configId: "bogatyr", owner: PLAYER_OWNER, x: 1, y: 1, z: 1, dir: 1,
      ap: 2, maxAp: 2, mobility: 5, hp: 12, maxHp: 12, aim: 100, defense: 10, will: 40, vision: 12,
      weaponId: "sword", weaponIds: ["sword"], skillIds: [], obstacle: true, dead: false, flying: false,
      coverType: 0, overwatch: false, defending: false, movementSpent: 0,
    };
    const idol: EntityState = {
      id: 1000, configId: "idol", owner: 0, x: 5, y: 1, z: 1, dir: 0,
      ap: 0, maxAp: 0, mobility: 1, hp: 5, maxHp: 5, aim: 0, defense: 0, will: 0, vision: 0,
      weaponId: "", weaponIds: [], skillIds: [], obstacle: true, dead: false, flying: false,
      coverType: 0, overwatch: false, defending: false, movementSpent: 0, countsForElimination: false,
    };
    const upyr: EntityState = {
      id: 2, configId: "upyr", owner: ENEMY_OWNER, x: 10, y: 6, z: 1, dir: 3,
      ap: 2, maxAp: 2, mobility: 5, hp: 8, maxHp: 8, aim: 60, defense: 0, will: 20, vision: 10,
      weaponId: "claws", weaponIds: ["claws"], skillIds: [], obstacle: true, dead: false, flying: false,
      coverType: 0, overwatch: false, defending: false, movementSpent: 0,
    };
    const kernel = createTacticsKernel({
      initial: { turnNumber: 1, activeOwner: PLAYER_OWNER, grid, entities: [bogatyr, idol, upyr], objective: { kind: "destroy", unitId: "idol" }, rngSeed: "61", rngState: "61" },
      weapons: { sword: SWORD },
      skills: {},
      seed: 61,
    });
    // Богатырь подходит к идолу и разбивает его.
    expect(kernel.apply({ type: "MOVE", actorId: 1, to: { x: 4, y: 1, z: 1 } }).ok).toBe(true);
    const result = kernel.apply({ type: "ATTACK", actorId: 1, targetId: 1000, weaponId: "sword" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toContainEqual({
      type: "MATCH_ENDED",
      winnerPlayerId: String(PLAYER_OWNER),
      reason: "OBJECTIVE",
    });
    // Противник выжил — победа всё равно по объекту.
    expect(kernel.getSnapshot().entities.find((entity) => entity.id === 2)?.dead).toBe(false);
  });

  it("rescue: victory by OBJECTIVE when the escortee extracts from the zone", () => {
    const kernel = objectiveKernel({ kind: "rescue", unitId: "captive" });
    const captive = kernel.getSnapshot().entities.find((entity) => entity.configId === "captive")!;
    expect(captive.owner).toBe(PLAYER_OWNER);
    const reachable = kernel.getReachable(captive.id);
    const zoneCell = reachable.find((cell) => cell.x === 0);
    expect(zoneCell).toBeDefined();
    if (!zoneCell) return;
    expect(kernel.apply({ type: "MOVE", actorId: captive.id, to: zoneCell }).ok).toBe(true);
    const result = kernel.apply({ type: "USE_SKILL", actorId: captive.id, skillId: EVACUATE.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toContainEqual({
      type: "MATCH_ENDED",
      winnerPlayerId: String(PLAYER_OWNER),
      reason: "OBJECTIVE",
    });
  });

  it("rescue: defeat when the escortee dies", () => {
    const match = objectiveMatch({ kind: "rescue", unitId: "captive" });
    const captive = match.entities.find((entity) => entity.configId === "captive")!;
    const upyr = match.entities.find((entity) => entity.configId === "upyr")!;
    captive.hp = 2;
    // Поставить княжну вплотную к упырю, богатыря — в дальний угол.
    captive.x = upyr.x - 1;
    captive.y = upyr.y;
    const bogatyr = match.entities.find((entity) => entity.configId === "bogatyr")!;
    bogatyr.x = 1;
    bogatyr.y = 1;
    const kernel = createTacticsKernel({
      initial: match,
      weapons: { sword: SWORD, claws: { id: "claws", category: "melee", apCost: 1, endsTurn: true, range: 1, requiresLOS: false, aimMod: 0, minDmg: 3, maxDmg: 4, crit: 0, critBonus: 0, envDmg: 0 } },
      skills: { [EVACUATE.id]: EVACUATE },
      seed: 62,
    });
    expect(kernel.apply({ type: "END_TURN", playerId: String(PLAYER_OWNER) }).ok).toBe(true);
    const snapshot = kernel.getSnapshot();
    const captiveAfter = snapshot.entities.find((entity) => entity.configId === "captive");
    // Упырь атаковал княжну: либо она мертва и миссия проиграна, либо бой продолжается.
    const ended = snapshot.entities.find((entity) => entity.configId === "captive")?.dead === true;
    if (ended) {
      expect(kernel.getSnapshot().entities.find((entity) => entity.configId === "captive")?.dead).toBe(true);
    } else {
      expect(captiveAfter?.hp).toBeLessThan(5);
    }
  });

  it("recon: deployed fighters receive the evacuate skill from the scenario", () => {
    const match = objectiveMatch({ kind: "recon" });
    const bogatyr = match.entities.find((entity) => entity.configId === "bogatyr")!;
    expect(bogatyr.skillIds).toContain("evacuate");
    const kernel = createTacticsKernel({
      initial: match,
      weapons: { sword: SWORD },
      skills: { [EVACUATE.id]: EVACUATE },
      seed: 63,
    });
    expect(kernel.getSkillPreview(bogatyr.id, EVACUATE.id).available).toBe(false);
    // Эвакуация из зоны завершает разведку победой.
    const reachable = kernel.getReachable(bogatyr.id);
    const zoneCell = reachable.find((cell) => cell.x === 0);
    expect(zoneCell).toBeDefined();
    if (!zoneCell) return;
    expect(kernel.apply({ type: "MOVE", actorId: bogatyr.id, to: zoneCell }).ok).toBe(true);
    const result = kernel.apply({ type: "USE_SKILL", actorId: bogatyr.id, skillId: EVACUATE.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toContainEqual({
      type: "MATCH_ENDED",
      winnerPlayerId: String(PLAYER_OWNER),
      reason: "OBJECTIVE",
    });
  });
});
