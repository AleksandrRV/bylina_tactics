import { describe, expect, it } from "vitest";
import { createTacticsKernel } from "../src/kernel.js";
import { pickEnemyCommand } from "../src/ai.js";
import { makeGrid } from "../src/grid.js";
import { createMissionMatch } from "../src/match.js";
import type { SpawnUnitConfig } from "../src/defaults.js";
import type { SkillStats } from "../src/skills.js";
import type { EntityState, GameEvent, MatchState } from "../src/types.js";
import type { WeaponStats } from "../src/weapons.js";

/**
 * Таланты классов (0.21.30): двойной выстрел с автовыбором целей
 * (game-rules §10.6) и «стойка на ходу» (§15.8), а также перенос талантов
 * в высадку через RosterMods.
 */

const BOW: WeaponStats = {
  id: "bow",
  category: "ranged",
  apCost: 1,
  endsTurn: true,
  range: 8,
  requiresLOS: true,
  aimMod: 0,
  minDmg: 2,
  maxDmg: 2,
  crit: 0,
  critBonus: 0,
  envDmg: 0,
};

const DOUBLE_SHOT: SkillStats = {
  id: "double_shot",
  apCost: 1,
  endsTurn: true,
  range: 8,
  requiresLOS: true,
  category: "self",
  resolution: "attack",
  envDmg: 0,
  filter: "enemies",
  autoTarget: { count: 2, aimPenalty: 15 },
  cooldownTurns: 2,
  effects: [{ type: "damage", minDmg: 2, maxDmg: 2, crit: 0, critBonus: 0 }],
};

function fighter(partial: Partial<EntityState>): EntityState {
  return {
    id: 1,
    configId: "fighter",
    owner: 1,
    x: 1,
    y: 2,
    z: 1,
    dir: 1,
    ap: 2,
    maxAp: 2,
    mobility: 5,
    hp: 10,
    maxHp: 10,
    aim: 100,
    defense: 0,
    will: 20,
    vision: 10,
    weaponId: BOW.id,
    weaponIds: [BOW.id],
    skillIds: [],
    obstacle: true,
    dead: false,
    flying: false,
    hidden: false,
    coverType: 0,
    overwatch: false,
    defending: false,
    movementSpent: 0,
    ...partial,
  };
}

function state(...entities: EntityState[]): MatchState {
  return { turnNumber: 1, activeOwner: 1, grid: makeGrid(10, 6, 1), entities };
}

const combats = (events: GameEvent[]) =>
  events.filter((event): event is Extract<GameEvent, { type: "COMBAT_RESOLVED" }> => event.type === "COMBAT_RESOLVED");

/** События принятой команды; отклонение — ошибка теста. */
const eventsOf = (result: ReturnType<ReturnType<typeof createTacticsKernel>["apply"]>): GameEvent[] => {
  if (!result.ok) throw new Error(`command rejected: ${result.reason}`);
  return result.events;
};

describe("double shot: auto-targeted volley (0.21.30)", () => {
  it("fires at the two nearest visible enemies, nearest first, without a target in the command", () => {
    const archer = fighter({ id: 1, skillIds: ["double_shot"], aim: 90 });
    const near = fighter({ id: 2, owner: 2, x: 3, y: 2, hp: 5, maxHp: 5, weaponIds: [], weaponId: "" });
    const far = fighter({ id: 3, owner: 2, x: 6, y: 2, hp: 5, maxHp: 5, weaponIds: [], weaponId: "" });
    const farthest = fighter({ id: 4, owner: 2, x: 8, y: 2, hp: 5, maxHp: 5, weaponIds: [], weaponId: "" });
    const kernel = createTacticsKernel({
      initial: state(archer, near, far, farthest),
      weapons: { bow: BOW },
      skills: { double_shot: DOUBLE_SHOT },
      seed: 7,
    });
    const preview = kernel.getSkillPreview(1, "double_shot");
    expect(preview.available).toBe(true);
    expect(preview.areaCells).toEqual([
      { x: 3, y: 2, z: 1 },
      { x: 6, y: 2, z: 1 },
    ]);
    // Вычет меткости виден уже в предпросмотре: 90 − 15 = 75.
    expect(preview.chance).toBe(75);
    expect(kernel.getHitPreview(1, 2).chance).toBe(90);

    const result = kernel.apply({ type: "USE_SKILL", actorId: 1, skillId: "double_shot" });
    expect(result.ok).toBe(true);
    const events = eventsOf(result);
    expect(combats(events).map((shot) => shot.targetId)).toEqual([2, 3]);
    const after = kernel.getSnapshot().entities;
    expect(after.find((entity) => entity.id === 4)?.hp).toBe(5);
    const resolved = events.find((event) => event.type === "SKILL_RESOLVED");
    expect(resolved).toMatchObject({ type: "SKILL_RESOLVED", skillId: "double_shot", targetPos: { x: 3, y: 2, z: 1 } });
    expect(after.find((entity) => entity.id === 1)?.ap).toBe(0);
    expect(after.find((entity) => entity.id === 1)?.skillCooldowns?.double_shot).toBe(2);
  });

  it("is unavailable without enemies in reach and fires once when only one is reachable", () => {
    const archer = fighter({ id: 1, skillIds: ["double_shot"], aim: 200 });
    const only = fighter({ id: 2, owner: 2, x: 4, y: 2, hp: 5, maxHp: 5, weaponIds: [], weaponId: "" });
    const empty = createTacticsKernel({
      initial: state(archer),
      weapons: { bow: BOW },
      skills: { double_shot: DOUBLE_SHOT },
    });
    expect(empty.getSkillPreview(1, "double_shot")).toMatchObject({ available: false, reason: "NOT_FOUND" });
    expect(empty.apply({ type: "USE_SKILL", actorId: 1, skillId: "double_shot" }).ok).toBe(false);

    const single = createTacticsKernel({
      initial: state(archer, only),
      weapons: { bow: BOW },
      skills: { double_shot: DOUBLE_SHOT },
      seed: 3,
    });
    const result = single.apply({ type: "USE_SKILL", actorId: 1, skillId: "double_shot" });
    expect(result.ok).toBe(true);
    expect(combats(eventsOf(result))).toHaveLength(1);
  });

  it("is used by the enemy AI without an explicit target", () => {
    const foeArcher = fighter({ id: 5, owner: 2, x: 5, y: 2, skillIds: ["double_shot"], aim: 200 });
    const hero = fighter({ id: 1, owner: 1, x: 2, y: 2, hp: 12, maxHp: 12 });
    const kernel = createTacticsKernel({
      initial: { ...state(hero, foeArcher), activeOwner: 2 },
      weapons: { bow: BOW },
      skills: { double_shot: DOUBLE_SHOT },
      seed: 11,
    });
    const command = pickEnemyCommand(kernel);
    expect(command).toEqual({ type: "USE_SKILL", actorId: 5, skillId: "double_shot" });
  });
});

describe("road stance: automatic defend after a move-only turn (0.21.30)", () => {
  it("raises the defensive stance at end of turn only when the fighter merely moved", () => {
    const walker = fighter({ id: 1, autoDefend: true, x: 1, y: 1 });
    const shooter = fighter({ id: 2, autoDefend: true, x: 1, y: 4 });
    const idle = fighter({ id: 3, autoDefend: true, x: 1, y: 5 });
    const foe = fighter({ id: 9, owner: 2, x: 6, y: 4, hp: 20, maxHp: 20, weaponIds: [], weaponId: "" });
    const kernel = createTacticsKernel({ initial: state(walker, shooter, idle, foe), weapons: { bow: BOW } });
    expect(kernel.apply({ type: "MOVE", actorId: 1, to: { x: 2, y: 1, z: 1 } }).ok).toBe(true);
    expect(kernel.apply({ type: "MOVE", actorId: 2, to: { x: 2, y: 4, z: 1 } }).ok).toBe(true);
    expect(kernel.apply({ type: "ATTACK", actorId: 2, targetId: 9, weaponId: "bow" }).ok).toBe(true);
    const end = kernel.apply({ type: "END_TURN", playerId: "1" });
    expect(end.ok).toBe(true);
    const stances = eventsOf(end).filter(
      (event): event is Extract<GameEvent, { type: "STATUS_CHANGED" }> =>
        event.type === "STATUS_CHANGED" && event.status === "DEFENDING" && event.applied,
    );
    expect(stances.map((event) => event.entityId)).toEqual([1]);
    const after = kernel.getSnapshot().entities;
    expect(after.find((entity) => entity.id === 1)?.defending).toBe(true);
    expect(after.find((entity) => entity.id === 2)?.defending).toBe(false);
    expect(after.find((entity) => entity.id === 3)?.defending).toBe(false);
    // Стойка держится ход противника и снимается с началом своего хода.
    expect(kernel.apply({ type: "END_TURN", playerId: "2" }).ok).toBe(true);
    expect(kernel.getSnapshot().entities.find((entity) => entity.id === 1)?.defending).toBe(false);
  });
});

describe("talents reach the deployment through RosterMods (0.21.30)", () => {
  const UNITS: SpawnUnitConfig[] = [
    {
      id: "strelets",
      side: "druzhina",
      maxHealth: 8,
      maxAP: 2,
      mobility: 4,
      aim: 85,
      defense: 0,
      will: 30,
      vision: 14,
      weapons: ["bow"],
      skills: ["aimed_eye"],
      tags: [],
    },
    {
      id: "upyr",
      side: "nav",
      maxHealth: 6,
      maxAP: 2,
      mobility: 4,
      aim: 60,
      defense: 0,
      will: 10,
      vision: 10,
      weapons: ["claws"],
      skills: [],
      tags: [],
    },
  ];

  it("adds talent skills and passive flags to the spawned fighter", () => {
    const match = createMissionMatch({
      units: UNITS,
      map: {
        biome: "meadow",
        width: 12,
        height: 10,
        pitChance: 0,
        coverDensity: 0,
        wallDensity: 0,
        edgeCoverChance: 0,
        halfCoverChance: 0,
        heightMix: { z0: 0, z1: 1, z2: 0 },
      },
      playerSlots: [{ unitId: "strelets", extraSkillIds: ["double_shot", "aimed_eye"], autoDefend: true, maxHpMod: 2 }],
      enemies: [{ unitId: "upyr", count: 1 }],
      seed: 5,
    });
    const strelets = match.entities.find((entity) => entity.configId === "strelets")!;
    expect(strelets.skillIds).toEqual(["aimed_eye", "double_shot"]);
    expect(strelets.autoDefend).toBe(true);
    expect(strelets.maxHp).toBe(10);
  });
});
