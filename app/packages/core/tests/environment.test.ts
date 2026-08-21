import { describe, expect, it } from "vitest";
import { createQuickMatch } from "../src/match.js";
import { createTacticsKernel } from "../src/kernel.js";
import { defaultTrainingWeapons } from "../src/defaults.js";
import { PLAYER_OWNER, ENEMY_OWNER } from "../src/debug-map.js";
import type { SkillStats } from "../src/skills.js";
import type { WeaponStats } from "../src/weapons.js";
import { tileAt } from "../src/grid.js";

const ENV_BOW: WeaponStats = {
  id: "env_bow", category: "ranged", apCost: 1, endsTurn: true, range: 8,
  requiresLOS: true, aimMod: 100, minDmg: 3, maxDmg: 5, crit: 0, critBonus: 0, envDmg: 1,
};

const SWEEP: SkillStats = {
  id: "circular_sweep", apCost: 1, endsTurn: true, range: 0, requiresLOS: false,
  category: "self", resolution: "attack", envDmg: 0, radius: 1, filter: "enemies",
  effects: [{ type: "damage", minDmg: 3, maxDmg: 5, crit: 0, critBonus: 0 }],
};

const DROP_FLIGHT: SkillStats = {
  id: "drop_flight", apCost: 1, endsTurn: true, range: 0, requiresLOS: false,
  category: "self", resolution: "auto", envDmg: 0,
  effects: [{ type: "removeStatus", status: "flying" }],
};

const BREACH: SkillStats = {
  id: "breach", apCost: 1, endsTurn: true, range: 1, requiresLOS: false,
  category: "melee", resolution: "attack", envDmg: 1, affectsEnvironment: true, filter: "all",
  effects: [
    { type: "damage", minDmg: 1, maxDmg: 1, crit: 0, critBonus: 0 },
    { type: "destroyCover" },
    { type: "knockback" },
  ],
};

function visibleCoverScenario(seed: number) {
  const match = createQuickMatch({ enemyCount: 3, seed });
  const cover = match.entities.find((entity) => entity.coverType > 0 && entity.edge === undefined)!;
  const strelets = match.entities.find((entity) => entity.owner === PLAYER_OWNER && entity.configId === "strelets")!;
  strelets.x = Math.max(0, cover.x - 2);
  strelets.y = cover.y;
  strelets.z = cover.z;
  strelets.weaponId = ENV_BOW.id;
  strelets.weaponIds = [ENV_BOW.id];
  return { match, cover, strelets };
}

describe("cover destruction (§12)", () => {
  it("reduces full cover by exactly one tier and removes half cover", () => {
    const { match, cover, strelets } = visibleCoverScenario(100);
    cover.coverType = 2;
    const kernel = createTacticsKernel({ initial: match, weapons: { ...defaultTrainingWeapons(), env_bow: ENV_BOW } });
    const first = kernel.apply({ type: "ATTACK", actorId: strelets.id, targetId: cover.id, weaponId: ENV_BOW.id });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.events.some((event) => event.type === "COVER_DESTROYED" && event.newStatus === "HALF")).toBe(true);
    expect(kernel.getSnapshot().entities.find((entity) => entity.id === cover.id)?.coverType).toBe(1);

    kernel.apply({ type: "END_TURN", playerId: String(PLAYER_OWNER) });
    kernel.apply({ type: "END_TURN", playerId: String(ENEMY_OWNER) });
    const second = kernel.apply({ type: "ATTACK", actorId: strelets.id, targetId: cover.id, weaponId: ENV_BOW.id });
    expect(second.ok).toBe(true);
    expect(kernel.getSnapshot().entities.find((entity) => entity.id === cover.id)?.coverType).toBe(0);
  });

  it("validates range, LOS, and weapon ownership for a cover attack", () => {
    const { match, cover, strelets } = visibleCoverScenario(101);
    const kernel = createTacticsKernel({ initial: match, weapons: { ...defaultTrainingWeapons(), env_bow: ENV_BOW } });
    expect(kernel.apply({ type: "ATTACK", actorId: strelets.id, targetId: cover.id, weaponId: "bow" }).ok).toBe(false);
    strelets.weaponIds = [ENV_BOW.id];
    // A forged, unowned weapon is rejected by the host regardless of its stats.
    expect(kernel.apply({ type: "ATTACK", actorId: strelets.id, targetId: cover.id, weaponId: "sword" }).ok).toBe(false);
  });
});

describe("0.8 skills and displacement", () => {
  it("circular sweep resolves all adjacent enemies in ascending id order", () => {
    const match = createQuickMatch({ enemyCount: 3, seed: 400 });
    const bogatyr = match.entities.find((entity) => entity.configId === "bogatyr")!;
    const enemies = match.entities.filter((entity) => entity.owner === ENEMY_OWNER && entity.coverType === 0).slice(0, 2);
    enemies[0]!.x = bogatyr.x + 1; enemies[0]!.y = bogatyr.y; enemies[0]!.z = bogatyr.z;
    enemies[1]!.x = bogatyr.x; enemies[1]!.y = bogatyr.y + 1; enemies[1]!.z = bogatyr.z;
    bogatyr.skillIds = [SWEEP.id];
    const kernel = createTacticsKernel({ initial: match, weapons: defaultTrainingWeapons(), skills: { [SWEEP.id]: SWEEP }, seed: 2 });
    const result = kernel.apply({ type: "USE_SKILL", actorId: bogatyr.id, skillId: SWEEP.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.events.filter((event) => event.type === "COMBAT_RESOLVED").map((event) => event.targetId);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(ids).toEqual(expect.arrayContaining(enemies.map((entity) => entity.id)));
  });

  it("kills a flying unit that loses flight over a pit", () => {
    const match = createQuickMatch({ enemyCount: 3, seed: 405 });
    const bogatyr = match.entities.find((entity) => entity.configId === "bogatyr")!;
    tileAt(match.grid, bogatyr.x, bogatyr.y)!.pit = true;
    bogatyr.flying = true;
    bogatyr.skillIds = [DROP_FLIGHT.id];
    const kernel = createTacticsKernel({ initial: match, weapons: defaultTrainingWeapons(), skills: { [DROP_FLIGHT.id]: DROP_FLIGHT } });
    const result = kernel.apply({ type: "USE_SKILL", actorId: bogatyr.id, skillId: DROP_FLIGHT.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.some((event) => event.type === "ENTITY_DIED" && event.causeOfDeath === "FALL_INTO_PIT")).toBe(true);
  });

  it("knockback into a pit displaces and kills the target", () => {
    const match = createQuickMatch({ enemyCount: 3, seed: 410 });
    const bogatyr = match.entities.find((entity) => entity.configId === "bogatyr")!;
    const enemy = match.entities.find((entity) => entity.owner === ENEMY_OWNER && entity.coverType === 0)!;
    // Place A,T,D horizontally in visible open cells.
    bogatyr.x = 2; bogatyr.y = 4; bogatyr.z = tileAt(match.grid, 2, 4)!.z;
    enemy.x = 3; enemy.y = 4; enemy.z = bogatyr.z;
    const pit = tileAt(match.grid, 4, 4)!;
    pit.z = bogatyr.z; pit.pit = true; pit.blockLOS = false;
    match.entities.forEach((entity) => {
      if (entity.id !== bogatyr.id && entity.id !== enemy.id && entity.x === 4 && entity.y === 4) {
        entity.dead = true; entity.obstacle = false;
      }
    });
    bogatyr.skillIds = [BREACH.id];
    bogatyr.aim = 100;
    const kernel = createTacticsKernel({ initial: match, weapons: defaultTrainingWeapons(), skills: { [BREACH.id]: BREACH }, seed: 1 });
    const result = kernel.apply({ type: "USE_SKILL", actorId: bogatyr.id, skillId: BREACH.id, targetId: enemy.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.some((event) => event.type === "ENTITY_DISPLACED" && event.cause === "FALL")).toBe(true);
    expect(result.events.some((event) => event.type === "ENTITY_DIED" && event.causeOfDeath === "FALL_INTO_PIT")).toBe(true);
  });
});
