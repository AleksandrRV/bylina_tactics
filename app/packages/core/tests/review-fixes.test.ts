import { describe, expect, it } from "vitest";
import { createTacticsKernel } from "../src/kernel.js";
import { makeGrid, tileAt } from "../src/grid.js";
import { evaluateObstacles, hasLineOfSight } from "../src/los.js";
import type { SpawnUnitConfig } from "../src/defaults.js";
import type { SkillStats } from "../src/skills.js";
import type { EntityState, MatchState } from "../src/types.js";
import type { WeaponStats } from "../src/weapons.js";

const BOW: WeaponStats = {
  id: "bow",
  category: "ranged",
  apCost: 1,
  endsTurn: true,
  range: 8,
  requiresLOS: true,
  aimMod: 0,
  minDmg: 3,
  maxDmg: 5,
  crit: 0,
  critBonus: 0,
  envDmg: 0,
};
const FIXED_DMG: WeaponStats = {
  id: "fixed",
  category: "ranged",
  apCost: 1,
  endsTurn: true,
  range: 8,
  requiresLOS: true,
  aimMod: 0,
  minDmg: 5,
  maxDmg: 5,
  crit: 0,
  critBonus: 0,
  envDmg: 0,
};
const FIXED_DMG2: WeaponStats = {
  id: "fixed2",
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
const SWORD: WeaponStats = {
  id: "sword",
  category: "melee",
  apCost: 1,
  endsTurn: true,
  range: 1,
  requiresLOS: false,
  aimMod: 0,
  minDmg: 3,
  maxDmg: 3,
  crit: 0,
  critBonus: 0,
  envDmg: 0,
};

const ROOTS: SkillStats = {
  id: "roots",
  apCost: 1,
  endsTurn: true,
  range: 6,
  requiresLOS: true,
  category: "ranged",
  resolution: "auto",
  envDmg: 0,
  filter: "enemies",
  cooldownTurns: 2,
  effects: [{ type: "applyStatus", status: "immobile", duration: 1 }],
};
const ROOTS_FLYING: SkillStats = {
  ...ROOTS,
  id: "roots_flying",
  affectsFlying: true,
};
const PANIC: SkillStats = {
  id: "panic",
  apCost: 1,
  endsTurn: true,
  range: 6,
  requiresLOS: true,
  category: "ranged",
  resolution: "will",
  willPower: 100,
  envDmg: 0,
  filter: "enemies",
  cooldownTurns: 4,
  effects: [{ type: "applyStatus", status: "panic", duration: 1 }],
};
const BREACH: SkillStats = {
  id: "breach",
  apCost: 1,
  endsTurn: true,
  range: 1,
  requiresLOS: false,
  category: "melee",
  resolution: "attack",
  envDmg: 1,
  affectsEnvironment: true,
  filter: "all",
  cooldownTurns: 4,
  effects: [{ type: "damage", minDmg: 6, maxDmg: 6, crit: 0, critBonus: 0 }, { type: "destroyCover" }],
};
const NO_ENV_ATTACK: SkillStats = {
  id: "no_env_attack",
  apCost: 1,
  endsTurn: true,
  range: 5,
  requiresLOS: false,
  category: "ranged",
  resolution: "attack",
  envDmg: 0,
  filter: "all",
  cooldownTurns: 2,
  effects: [{ type: "damage", minDmg: 2, maxDmg: 2, crit: 0, critBonus: 0 }],
};
const ENV_ATTACK: SkillStats = {
  ...NO_ENV_ATTACK,
  id: "env_attack",
  envDmg: 1,
  effects: [{ type: "damage", minDmg: 2, maxDmg: 2, crit: 0, critBonus: 0 }, { type: "destroyCover" }],
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
    hp: 20,
    maxHp: 20,
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

function coverEntity(id: number, x: number, y: number, coverType: 1 | 2, edge?: 0 | 1 | 2 | 3): EntityState {
  return {
    id,
    configId: "cover",
    owner: 0,
    x,
    y,
    z: 1,
    dir: 0,
    ap: 0,
    maxAp: 0,
    mobility: 0,
    hp: 2,
    maxHp: 2,
    aim: 0,
    defense: 0,
    vision: 0,
    weaponId: "",
    weaponIds: [],
    skillIds: [],
    obstacle: edge === undefined,
    dead: false,
    flying: false,
    hidden: false,
    coverType,
    edge,
    overwatch: false,
    defending: false,
    movementSpent: 0,
  };
}

function state(...entities: EntityState[]): MatchState {
  return { turnNumber: 1, activeOwner: 1, grid: makeGrid(8, 6, 1), entities };
}

function kernel(
  initial: MatchState,
  skills: SkillStats[] = [],
  weapons: Record<string, WeaponStats> = {},
  units: SpawnUnitConfig[] = [],
) {
  return createTacticsKernel({
    initial,
    weapons: { bow: BOW, fixed: FIXED_DMG, fixed2: FIXED_DMG2, sword: SWORD, ...weapons },
    skills: Object.fromEntries(skills.map((skill) => [skill.id, skill])),
    units,
    seed: 1,
  });
}

describe("review fixes: skill targets", () => {
  it("rejects auto and will skills aimed at dead entities without spending resources", () => {
    const caster = fighter({ id: 1, skillIds: [ROOTS.id, PANIC.id] });
    const corpse = fighter({ id: 2, owner: 2, x: 3, dead: true, obstacle: false, hp: 0 });
    const game = kernel(state(caster, corpse), [ROOTS, PANIC]);
    expect(game.getSkillPreview(1, ROOTS.id, 2)).toMatchObject({ available: false, reason: "ILLEGAL" });
    expect(game.getSkillPreview(1, PANIC.id, 2)).toMatchObject({ available: false, reason: "ILLEGAL" });
    const result = game.apply({ type: "USE_SKILL", actorId: 1, skillId: ROOTS.id, targetId: 2 });
    expect(result).toEqual({ ok: false, reason: "ILLEGAL" });
    const after = game.getSnapshot().entities.find((entity) => entity.id === 1)!;
    expect(after.ap).toBe(2);
    expect(after.skillCooldowns?.[ROOTS.id]).toBeUndefined();
  });

  it("blocks attack skills without destructive power from targeting cover entities", () => {
    const caster = fighter({ id: 1, skillIds: [NO_ENV_ATTACK.id, ENV_ATTACK.id] });
    const cover = coverEntity(3, 3, 2, 2);
    const game = kernel(state(caster, cover), [NO_ENV_ATTACK, ENV_ATTACK]);
    expect(game.getSkillPreview(1, NO_ENV_ATTACK.id, 3)).toMatchObject({ available: false, reason: "ILLEGAL" });
    expect(game.getSkillPreview(1, ENV_ATTACK.id, 3).available).toBe(true);
    const result = game.apply({ type: "USE_SKILL", actorId: 1, skillId: NO_ENV_ATTACK.id, targetId: 3 });
    expect(result).toEqual({ ok: false, reason: "ILLEGAL" });
    expect(game.getSnapshot().entities.find((entity) => entity.id === 1)?.ap).toBe(2);
  });

  it("applies immobile to flying targets only with the affectsFlying flag", () => {
    const caster = fighter({ id: 1, skillIds: [ROOTS.id, ROOTS_FLYING.id] });
    const target = fighter({ id: 2, owner: 2, x: 3, flying: true });
    const game = kernel(state(caster, target), [ROOTS, ROOTS_FLYING]);
    const plain = game.apply({ type: "USE_SKILL", actorId: 1, skillId: ROOTS.id, targetId: 2 });
    expect(plain.ok).toBe(true);
    expect(game.getSnapshot().entities.find((entity) => entity.id === 2)?.immobileTurns).toBeUndefined();
    expect(game.apply({ type: "END_TURN", playerId: "1" }).ok).toBe(true);
    expect(game.apply({ type: "END_TURN", playerId: "2" }).ok).toBe(true);
    const flagged = game.apply({ type: "USE_SKILL", actorId: 1, skillId: ROOTS_FLYING.id, targetId: 2 });
    expect(flagged.ok).toBe(true);
    expect(game.getSnapshot().entities.find((entity) => entity.id === 2)?.immobileTurns).toBe(1);
  });
});

describe("review fixes: overwatch", () => {
  it("reveals a hidden watcher that fired an overwatch shot", () => {
    const watcher = fighter({ id: 1, x: 0, y: 1, dir: 1, hidden: true, overwatch: true, ap: 0 });
    const mover = fighter({ id: 2, owner: 2, x: 5, y: 1, dir: 3 });
    const initial = state(watcher, mover);
    initial.activeOwner = 2;
    const game = kernel(initial);
    const result = game.apply({ type: "MOVE", actorId: 2, to: { x: 3, y: 1, z: 1 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.some((event) => event.type === "OVERWATCH_FIRED" && event.watcherId === 1)).toBe(true);
    expect(result.events.some((event) => event.type === "REVEALED" && event.entityId === 1)).toBe(true);
    expect(game.getSnapshot().entities.find((entity) => entity.id === 1)?.hidden).toBe(false);
  });

  it("forbids melee overwatch through a full edge and keeps the watcher's order", () => {
    const watcher = fighter({
      id: 1,
      x: 0,
      y: 1,
      dir: 1,
      ap: 0,
      overwatch: true,
      weaponId: "sword",
      weaponIds: ["sword"],
    });
    const mover = fighter({ id: 2, owner: 2, x: 3, y: 1, dir: 3 });
    const edge = coverEntity(3, 1, 1, 2, 3); // full cover on the west edge of (1,1)
    const initial = state(watcher, mover, edge);
    initial.activeOwner = 2;
    const game = kernel(initial);
    const result = game.apply({ type: "MOVE", actorId: 2, to: { x: 1, y: 1, z: 1 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.some((event) => event.type === "OVERWATCH_FIRED")).toBe(false);
    expect(game.getSnapshot().entities.find((entity) => entity.id === 1)?.overwatch).toBe(true);
    expect(game.getSnapshot().entities.find((entity) => entity.id === 2)?.x).toBe(1);
  });

  it("applies the half-edge penalty to melee overwatch fire", () => {
    const watcher = fighter({
      id: 1,
      x: 0,
      y: 1,
      dir: 1,
      ap: 0,
      overwatch: true,
      weaponId: "sword",
      weaponIds: ["sword"],
    });
    const mover = fighter({ id: 2, owner: 2, x: 3, y: 1, dir: 3 });
    const edge = coverEntity(3, 1, 1, 1, 3); // half cover on the west edge of (1,1)
    const initial = state(watcher, mover, edge);
    initial.activeOwner = 2;
    const game = kernel(initial);
    const result = game.apply({ type: "MOVE", actorId: 2, to: { x: 1, y: 1, z: 1 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const shot = result.events.find((event) => event.type === "COMBAT_RESOLVED" && event.sourceId === 1);
    expect(shot).toBeDefined();
    // Полугрань не запрещает дозор: выстрел разрешается, охват не устанавливается.
    expect(shot).toMatchObject({ isFlanked: false });
    expect(shot).toMatchObject({ damageDealt: 3 });
    expect(game.getSnapshot().entities.find((entity) => entity.id === 2)?.hp).toBe(17);
  });
});

describe("review fixes: fog of war", () => {
  it("allows movement into explored cells that are not currently visible", () => {
    const mover = fighter({ id: 1, x: 1, y: 1, vision: 1 });
    const grid = makeGrid(12, 10, 1);
    const initial: MatchState = { turnNumber: 1, activeOwner: 1, grid, entities: [mover] };
    const game = kernel(initial);
    // Идём вдоль ряда, разведывая каждую следующую клетку (vision = 1).
    expect(game.apply({ type: "MOVE", actorId: 1, to: { x: 2, y: 1, z: 1 } }).ok).toBe(true);
    expect(game.apply({ type: "MOVE", actorId: 1, to: { x: 3, y: 1, z: 1 } }).ok).toBe(true);
    expect(game.apply({ type: "END_TURN", playerId: "1" }).ok).toBe(true);
    expect(game.apply({ type: "MOVE", actorId: 1, to: { x: 4, y: 1, z: 1 } }).ok).toBe(true);
    expect(game.apply({ type: "MOVE", actorId: 1, to: { x: 5, y: 1, z: 1 } }).ok).toBe(true);
    expect(game.apply({ type: "END_TURN", playerId: "1" }).ok).toBe(true);
    expect(game.apply({ type: "MOVE", actorId: 1, to: { x: 6, y: 1, z: 1 } }).ok).toBe(true);
    // (4,1) пройдена ранее: разведана, но вне радиуса обзора из (6,1).
    expect(game.getReachable(1).some((cell) => cell.x === 4 && cell.y === 1)).toBe(true);
    const result = game.apply({ type: "MOVE", actorId: 1, to: { x: 4, y: 1, z: 1 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(game.getSnapshot().entities.find((entity) => entity.id === 1)?.x).toBe(4);
  });
});

describe("review fixes: line of sight and terrain cover", () => {
  it("does not block LOS for glancing walls at different vertices", () => {
    const grid = makeGrid(8, 6, 1);
    tileAt(grid, 0, 1)!.blockLOS = true;
    tileAt(grid, 1, 2)!.blockLOS = true;
    expect(hasLineOfSight(grid, 0, 0, 1, 4, 4, 1)).toBe(true);
    const obstacles = evaluateObstacles(grid, [], 0, 0, 1, 4, 4, 1);
    expect(obstacles.blocked).toBe(false);
    expect(obstacles.obstaclePenalty).toBe(50); // одиночные касания — полное укрытие
  });

  it("does not grant terrain cover when the surface stays at or below the ray", () => {
    const grid = makeGrid(8, 6, 1);
    grid.tiles.forEach((tile) => {
      tile.z = 0;
    });
    tileAt(grid, 1, 3)!.z = 1;
    tileAt(grid, 2, 3)!.z = 1;
    tileAt(grid, 3, 3)!.z = 1;
    tileAt(grid, 4, 3)!.z = 2;
    const attacker = fighter({ id: 1, x: 0, y: 3, z: 0, aim: 90 });
    const target = fighter({ id: 2, owner: 2, x: 4, y: 3, z: 2 });
    const game = kernel(state(attacker, target));
    const preview = game.getHitPreview(1, 2);
    expect(preview.available).toBe(true);
    if (!preview.available) return;
    expect(preview.cover).toBe(0);
    expect(preview.chance).toBe(70); // 90 − 20 высота, без вычета укрытия
  });

  it("keeps terrain cover for a genuine rise above the ray", () => {
    const grid = makeGrid(8, 6, 1);
    grid.tiles.forEach((tile) => {
      tile.z = 0;
    });
    tileAt(grid, 1, 3)!.z = 1;
    tileAt(grid, 2, 3)!.z = 1;
    tileAt(grid, 3, 3)!.z = 1;
    tileAt(grid, 4, 3)!.z = 1;
    const attacker = fighter({ id: 1, x: 0, y: 3, z: 0, aim: 90 });
    const target = fighter({ id: 2, owner: 2, x: 4, y: 3, z: 1 });
    const game = kernel(state(attacker, target));
    const preview = game.getHitPreview(1, 2);
    expect(preview.available).toBe(true);
    if (!preview.available) return;
    expect(preview.cover).toBe(1);
    expect(preview.chance).toBe(45); // 90 − 20 высота − 25 склон
  });
});

describe("review fixes: breach through a full edge", () => {
  it("lets the destructive melee skill breach a full edge like the mace", () => {
    const attacker = fighter({ id: 1, x: 3, y: 2, weaponIds: ["sword"], weaponId: "sword", skillIds: [BREACH.id] });
    const target = fighter({ id: 2, owner: 2, x: 4, y: 2, hp: 20 });
    const edge = coverEntity(3, 3, 2, 2, 1); // полная грань на восточной грани клетки атакующего
    const game = kernel(state(attacker, target, edge), [BREACH]);
    const preview = game.getSkillPreview(1, BREACH.id, 2);
    expect(preview).toMatchObject({ available: true, cover: 1, chance: 75, dmgMin: 5, dmgMax: 5 });
    const result = game.apply({ type: "USE_SKILL", actorId: 1, skillId: BREACH.id, targetId: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const destroyed = result.events.filter((event) => event.type === "COVER_DESTROYED");
    expect(destroyed).toHaveLength(1); // удар через грань + эффект не разрушают дважды
    expect(destroyed[0]).toMatchObject({ newStatus: "HALF" });
    expect(game.getSnapshot().entities.find((entity) => entity.id === 3)?.coverType).toBe(1);
    const combat = result.events.find((event) => event.type === "COMBAT_RESOLVED");
    if (combat && (combat.result === "HIT" || combat.result === "CRIT")) {
      expect(combat).toMatchObject({ damageDealt: 5 }); // 6 − 1 среда
      expect(game.getSnapshot().entities.find((entity) => entity.id === 2)?.hp).toBe(15);
    }
  });
});

describe("review fixes: panic and flee threshold", () => {
  it("prefers a cardinal cell when panic distances tie", () => {
    const source = fighter({ id: 1, x: 2, y: 2, skillIds: [PANIC.id] });
    const target = fighter({ id: 2, owner: 2, x: 4, y: 2, will: 0 });
    const game = kernel(state(source, target), [PANIC]);
    expect(game.apply({ type: "USE_SKILL", actorId: 1, skillId: PANIC.id, targetId: 2 }).ok).toBe(true);
    expect(game.apply({ type: "END_TURN", playerId: "1" }).ok).toBe(true);
    const after = game.getSnapshot().entities.find((entity) => entity.id === 2)!;
    // Дистанция 5 от источника: (7,0), (7,1), (7,2), (7,3), (7,4), (7,5) —
    // из них кардинальным шагом достижима только (7,2).
    expect(after.x).toBe(7);
    expect(after.y).toBe(2);
  });

  it("kills at zero health instead of fleeing, and flees while still alive", () => {
    const attacker = fighter({ id: 1, x: 0, y: 2, weaponIds: ["fixed", "fixed2"], weaponId: "fixed" });
    const doomed = fighter({ id: 2, owner: 2, x: 3, y: 2, hp: 5, fleeHp: 3, weaponIds: [], weaponId: "" });
    const game = kernel(state(attacker, doomed));
    const lethal = game.apply({ type: "ATTACK", actorId: 1, targetId: 2, weaponId: "fixed" });
    expect(lethal.ok).toBe(true);
    if (!lethal.ok) return;
    expect(lethal.events.some((event) => event.type === "ENTITY_DIED" && event.entityId === 2)).toBe(true);
    expect(lethal.events.some((event) => event.type === "ENTITY_REMOVED")).toBe(false);
    expect(game.getSnapshot().entities.find((entity) => entity.id === 2)?.dead).toBe(true);
  });

  it("removes a unit that dropped to its flee threshold with health above zero", () => {
    const attacker = fighter({ id: 1, x: 0, y: 2, weaponIds: ["fixed2"], weaponId: "fixed2" });
    const coward = fighter({ id: 2, owner: 2, x: 3, y: 2, hp: 5, fleeHp: 3, weaponIds: [], weaponId: "" });
    const game = kernel(state(attacker, coward));
    const result = game.apply({ type: "ATTACK", actorId: 1, targetId: 2, weaponId: "fixed2" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.events.some((event) => event.type === "ENTITY_REMOVED" && event.reason === "FLED" && event.entityId === 2),
    ).toBe(true);
    expect(game.getSnapshot().entities.some((entity) => entity.id === 2)).toBe(false);
  });
});

describe("review fixes: camouflage and flank", () => {
  it("does not treat camouflage as directional cover and keeps the flank", () => {
    const attacker = fighter({ id: 1, x: 0, y: 2, aim: 80 });
    const leshy = fighter({ id: 2, owner: 2, x: 4, y: 2, camouflageMinCover: true, weaponIds: [], weaponId: "" });
    const ally = fighter({ id: 4, owner: 2, x: 4, y: 1, providesCamouflage: true, weaponIds: [], weaponId: "" });
    const sideCover = coverEntity(5, 4, 3, 2); // укрытие не на направлении выстрела
    const game = kernel(state(attacker, leshy, ally, sideCover));
    const preview = game.getHitPreview(1, 2);
    expect(preview.available).toBe(true);
    if (!preview.available) return;
    expect(preview.flanked).toBe(true); // маскировка не отменяет охват
    expect(preview.cover).toBe(1); // минимум полуукрытия от маскировки
    expect(preview.chance).toBe(55); // 80 − 25 маскировка
  });
});
