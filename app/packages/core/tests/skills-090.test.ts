import { describe, expect, it } from "vitest";
import { createTacticsKernel } from "../src/kernel.js";
import { pickEnemyCommand } from "../src/ai.js";
import { makeGrid } from "../src/grid.js";
import type { SpawnUnitConfig } from "../src/defaults.js";
import type { SkillStats } from "../src/skills.js";
import type { EntityState, MatchState } from "../src/types.js";
import type { WeaponStats } from "../src/weapons.js";

const TEST_WEAPON: WeaponStats = {
  id: "test_weapon", category: "ranged", apCost: 1, endsTurn: true, range: 8,
  requiresLOS: true, aimMod: 0, minDmg: 2, maxDmg: 2, crit: 0, critBonus: 0, envDmg: 0,
};

function fighter(partial: Partial<EntityState>): EntityState {
  return {
    id: 1, configId: "fighter", owner: 1, x: 1, y: 2, z: 1, dir: 1,
    ap: 2, maxAp: 2, mobility: 5, hp: 10, maxHp: 10, aim: 100, defense: 0, will: 20, vision: 10,
    weaponId: TEST_WEAPON.id, weaponIds: [TEST_WEAPON.id], skillIds: [], obstacle: true,
    dead: false, flying: false, hidden: false, coverType: 0, overwatch: false, defending: false, movementSpent: 0,
    ...partial,
  };
}

function state(...entities: EntityState[]): MatchState {
  return { turnNumber: 1, activeOwner: 1, grid: makeGrid(8, 6, 1), entities };
}

const HEAL: SkillStats = {
  id: "heal", apCost: 1, endsTurn: true, range: 6, requiresLOS: true, category: "ranged",
  resolution: "auto", envDmg: 0, filter: "allies", cooldownTurns: 2, effects: [{ type: "heal", amount: 4 }],
};
const CLEANSE: SkillStats = {
  id: "cleanse", apCost: 1, endsTurn: true, range: 6, requiresLOS: true, category: "ranged",
  resolution: "auto", envDmg: 0, filter: "allies", cooldownTurns: 3, effects: [
    { type: "removeStatus", status: "poison" }, { type: "removeStatus", status: "panic" }, { type: "removeStatus", status: "immobile" },
  ],
};
const POISON: SkillStats = {
  id: "poison_needles", apCost: 1, endsTurn: true, range: 6, requiresLOS: true, category: "ranged",
  resolution: "auto", envDmg: 0, filter: "enemies", cooldownTurns: 3, effects: [{ type: "applyStatus", status: "poison", duration: 3, magnitude: 2 }],
};
const ROOTS: SkillStats = {
  id: "roots", apCost: 1, endsTurn: true, range: 6, requiresLOS: true, category: "ranged",
  resolution: "auto", envDmg: 0, filter: "enemies", cooldownTurns: 2, effects: [{ type: "applyStatus", status: "immobile", duration: 1 }],
};
const PANIC: SkillStats = {
  id: "panic", apCost: 1, endsTurn: true, range: 6, requiresLOS: true, category: "ranged",
  resolution: "will", willPower: 100, envDmg: 0, filter: "enemies", cooldownTurns: 4, effects: [{ type: "applyStatus", status: "panic", duration: 1 }],
};
const SUMMON: SkillStats = {
  id: "summon_forest_beast", apCost: 1, endsTurn: true, range: 4, requiresLOS: true, category: "ranged",
  resolution: "auto", envDmg: 0, filter: "all", maxUsesPerBattle: 1, effects: [{ type: "spawn", unitId: "forest_beast" }],
};
const TELEPORT: SkillStats = {
  id: "teleport_ally", apCost: 1, endsTurn: true, range: 6, requiresLOS: true, category: "ranged",
  resolution: "auto", envDmg: 0, filter: "allies", cooldownTurns: 5, effects: [{ type: "displace" }],
};
const ILLUSION: SkillStats = {
  id: "create_illusion", apCost: 1, endsTurn: true, range: 5, requiresLOS: true, category: "ranged",
  resolution: "auto", envDmg: 0, filter: "all", maxUsesPerBattle: 1, effects: [{ type: "spawn", unitId: "illusion" }],
};
const RAISE: SkillStats = {
  id: "raise_skeleton", apCost: 1, endsTurn: true, range: 5, requiresLOS: true, category: "ranged",
  resolution: "auto", envDmg: 0, filter: "all", maxUsesPerBattle: 1, effects: [{ type: "spawn", unitId: "upyr" }],
};

const BEAST: SpawnUnitConfig = {
  id: "forest_beast", maxHealth: 5, maxAP: 2, mobility: 7, aim: 70, defense: 5, will: 20,
  vision: 8, weapons: [TEST_WEAPON.id], skills: [], tags: [], timedLife: 2,
};
const ILLUSION_UNIT: SpawnUnitConfig = {
  id: "illusion", maxHealth: 1, maxAP: 1, mobility: 4, aim: 0, defense: 0, will: 0,
  vision: 0, weapons: [], skills: [], tags: [], timedLife: 2, decoy: true,
};
const UPYR: SpawnUnitConfig = {
  id: "upyr", maxHealth: 8, maxAP: 2, mobility: 5, aim: 60, defense: 0, will: 20,
  vision: 8, weapons: [TEST_WEAPON.id], skills: [], tags: [],
};

function kernel(initial: MatchState, skills: SkillStats[], units: SpawnUnitConfig[] = []) {
  return createTacticsKernel({
    initial,
    weapons: { [TEST_WEAPON.id]: TEST_WEAPON },
    skills: Object.fromEntries(skills.map((skill) => [skill.id, skill])),
    units,
    seed: 1,
  });
}

describe("0.9 automatic skills", () => {
  it("lets Nav AI choose configured control skills before a basic attack", () => {
    const player = fighter({ id: 1, owner: 1, x: 2 });
    const leshy = fighter({ id: 2, owner: 2, x: 5, configId: "leshy", skillIds: [ROOTS.id] });
    const initial = state(player, leshy);
    initial.activeOwner = 2;
    const game = kernel(initial, [ROOTS]);
    expect(pickEnemyCommand(game)).toEqual({ type: "USE_SKILL", actorId: 2, skillId: ROOTS.id, targetId: 1 });
  });

  it("never asks AI to reapply a status that is already active", () => {
    const player = fighter({ id: 1, owner: 1, x: 2, immobileTurns: 1 });
    const leshy = fighter({ id: 2, owner: 2, x: 5, configId: "leshy", skillIds: [ROOTS.id] });
    const initial = state(player, leshy);
    initial.activeOwner = 2;
    const game = kernel(initial, [ROOTS]);
    const command = pickEnemyCommand(game);
    expect(command?.type).not.toBe("USE_SKILL");
  });

  it("heals up to max HP and removes all configured negative statuses", () => {
    const healer = fighter({ id: 1, owner: 1, skillIds: [HEAL.id, CLEANSE.id] });
    const ally = fighter({ id: 2, owner: 1, x: 2, hp: 5, poison: { damagePerTurn: 2, turnsLeft: 2 }, panic: { sourceId: 9, turnsLeft: 1 }, immobileTurns: 1 });
    const enemy = fighter({ id: 9, owner: 2, x: 6 });
    const game = kernel(state(healer, ally, enemy), [HEAL, CLEANSE]);
    expect(game.apply({ type: "USE_SKILL", actorId: 1, skillId: HEAL.id, targetId: 2 }).ok).toBe(true);
    expect(game.getSnapshot().entities.find((entity) => entity.id === 2)?.hp).toBe(9);
    game.apply({ type: "END_TURN", playerId: "1" });
    game.apply({ type: "END_TURN", playerId: "2" });
    expect(game.apply({ type: "USE_SKILL", actorId: 1, skillId: CLEANSE.id, targetId: 2 }).ok).toBe(true);
    const after = game.getSnapshot().entities.find((entity) => entity.id === 2)!;
    expect(after.poison).toBeUndefined();
    expect(after.panic).toBeUndefined();
    expect(after.immobileTurns).toBeUndefined();
  });

  it("applies poison before AP refill and decrements its duration", () => {
    const source = fighter({ id: 1, owner: 1, skillIds: [POISON.id] });
    const target = fighter({ id: 2, owner: 2, x: 3, hp: 10, ap: 0 });
    const game = kernel(state(source, target), [POISON]);
    game.apply({ type: "USE_SKILL", actorId: 1, skillId: POISON.id, targetId: 2 });
    const turn = game.apply({ type: "END_TURN", playerId: "1" });
    expect(turn.ok).toBe(true);
    const after = game.getSnapshot().entities.find((entity) => entity.id === 2)!;
    expect(after.hp).toBe(8);
    expect(after.poison?.turnsLeft).toBe(2);
    expect(after.ap).toBe(after.maxAp);
  });

  it("roots movement through the target turn and removes roots at its end", () => {
    const source = fighter({ id: 1, owner: 1, skillIds: [ROOTS.id] });
    const target = fighter({ id: 2, owner: 2, x: 3 });
    const game = kernel(state(source, target), [ROOTS]);
    game.apply({ type: "USE_SKILL", actorId: 1, skillId: ROOTS.id, targetId: 2 });
    game.apply({ type: "END_TURN", playerId: "1" });
    expect(game.getReachable(2)).toEqual([]);
    expect(game.apply({ type: "MOVE", actorId: 2, to: { x: 4, y: 2, z: 1 } }).ok).toBe(false);
    const ended = game.apply({ type: "END_TURN", playerId: "2" });
    expect(ended.ok && ended.events.some((event) => event.type === "STATUS_CHANGED" && event.status === "IMMOBILE" && !event.applied)).toBe(true);
  });
});

describe("skill cooldowns and per-battle limits", () => {
  it("blocks a cooling skill and ticks it once per owning turn", () => {
    const healer = fighter({ id: 1, owner: 1, skillIds: [HEAL.id] });
    const ally = fighter({ id: 2, owner: 1, x: 2, hp: 5 });
    const enemy = fighter({ id: 3, owner: 2, x: 6 });
    const game = kernel(state(healer, ally, enemy), [HEAL]);
    expect(game.apply({ type: "USE_SKILL", actorId: 1, skillId: HEAL.id, targetId: 2 }).ok).toBe(true);
    game.apply({ type: "END_TURN", playerId: "1" });
    game.apply({ type: "END_TURN", playerId: "2" });
    expect(game.getSkillPreview(1, HEAL.id, 2)).toMatchObject({ available: false, reason: "ON_COOLDOWN" });
    expect(game.getSnapshot().entities.find((entity) => entity.id === 1)?.skillCooldowns?.[HEAL.id]).toBe(1);
    game.apply({ type: "END_TURN", playerId: "1" });
    game.apply({ type: "END_TURN", playerId: "2" });
    expect(game.getSkillPreview(1, HEAL.id, 2).available).toBe(true);
  });

  it("allows each summoning skill only once per battle", () => {
    const source = fighter({ id: 1, owner: 1, skillIds: [SUMMON.id] });
    const enemy = fighter({ id: 2, owner: 2, x: 6 });
    const game = kernel(state(source, enemy), [SUMMON], [BEAST]);
    expect(game.apply({ type: "USE_SKILL", actorId: 1, skillId: SUMMON.id, targetPos: { x: 2, y: 3, z: 1 } }).ok).toBe(true);
    game.apply({ type: "END_TURN", playerId: "1" });
    game.apply({ type: "END_TURN", playerId: "2" });
    expect(game.getSkillPreview(1, SUMMON.id, undefined, { x: 3, y: 3, z: 1 })).toMatchObject({ available: false, reason: "NO_USES" });
    expect(game.getSnapshot().entities.find((entity) => entity.id === 1)?.skillUses?.[SUMMON.id]).toBe(1);
  });
});

describe("0.9 will, panic, summons and displacement", () => {
  it("resolves a will test, flees one AP from the source, and burns AP", () => {
    const source = fighter({ id: 1, owner: 1, x: 2, skillIds: [PANIC.id] });
    const target = fighter({ id: 2, owner: 2, x: 4, will: 0, ap: 0 });
    const game = kernel(state(source, target), [PANIC]);
    expect(game.getSkillPreview(1, PANIC.id, 2).chance).toBe(100);
    game.apply({ type: "USE_SKILL", actorId: 1, skillId: PANIC.id, targetId: 2 });
    game.apply({ type: "END_TURN", playerId: "1" });
    const after = game.getSnapshot().entities.find((entity) => entity.id === 2)!;
    expect(after.x).toBeGreaterThan(4);
    expect(after.ap).toBe(0);
    expect(after.panic).toBeUndefined();
  });

  it("summons a timed beast and expires it before its second later activation", () => {
    const source = fighter({ id: 1, owner: 1, skillIds: [SUMMON.id] });
    const enemy = fighter({ id: 2, owner: 2, x: 6 });
    const game = kernel(state(source, enemy), [SUMMON], [BEAST]);
    const result = game.apply({ type: "USE_SKILL", actorId: 1, skillId: SUMMON.id, targetPos: { x: 2, y: 3, z: 1 } });
    expect(result.ok && result.events.some((event) => event.type === "ENTITY_SPAWNED" && event.cause === "SUMMON")).toBe(true);
    const summonedId = game.getSnapshot().entities.find((entity) => entity.configId === "forest_beast")!.id;
    game.apply({ type: "END_TURN", playerId: "1" });
    game.apply({ type: "END_TURN", playerId: "2" });
    expect(game.getSnapshot().entities.find((entity) => entity.id === summonedId)?.timedLife).toBe(1);
    game.apply({ type: "END_TURN", playerId: "1" });
    game.apply({ type: "END_TURN", playerId: "2" });
    expect(game.getSnapshot().entities.some((entity) => entity.id === summonedId)).toBe(false);
  });

  it("creates an illusion, teleports an ally, and raises a skeleton on a corpse cell", () => {
    const caster = fighter({ id: 1, owner: 1, skillIds: [ILLUSION.id, TELEPORT.id] });
    const ally = fighter({ id: 2, owner: 1, x: 2, y: 3 });
    const enemy = fighter({ id: 3, owner: 2, x: 7, y: 4 });
    let game = kernel(state(caster, ally, enemy), [ILLUSION], [ILLUSION_UNIT]);
    const illusion = game.apply({ type: "USE_SKILL", actorId: 1, skillId: ILLUSION.id, targetPos: { x: 3, y: 2, z: 1 } });
    expect(illusion.ok && illusion.events.some((event) => event.type === "ENTITY_SPAWNED" && event.cause === "ILLUSION")).toBe(true);
    expect(game.getSnapshot().entities.find((entity) => entity.configId === "illusion")?.decoy).toBe(true);

    caster.ap = 2;
    game = kernel(state(caster, ally, enemy), [TELEPORT]);
    const teleport = game.apply({ type: "USE_SKILL", actorId: 1, skillId: TELEPORT.id, targetId: 2, targetPos: { x: 4, y: 3, z: 1 } });
    expect(teleport.ok).toBe(true);
    expect(game.getSnapshot().entities.find((entity) => entity.id === 2)?.x).toBe(4);

    const kikimora = fighter({ id: 1, owner: 1, configId: "kikimora", skillIds: [RAISE.id] });
    const corpse = fighter({ id: 4, owner: 1, configId: "upyr", x: 3, y: 2, dead: true, obstacle: false, hp: 0 });
    game = kernel(state(kikimora, corpse, enemy), [RAISE], [UPYR]);
    const raised = game.apply({ type: "USE_SKILL", actorId: 1, skillId: RAISE.id, targetPos: { x: 3, y: 2, z: 1 } });
    expect(raised.ok && raised.events.some((event) => event.type === "ENTITY_SPAWNED" && event.cause === "RESURRECTION")).toBe(true);
    expect(game.getSnapshot().entities.filter((entity) => entity.configId === "upyr" && !entity.dead)).toHaveLength(1);
  });
});
