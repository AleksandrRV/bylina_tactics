import { describe, expect, it } from "vitest";
import { createQuickMatch } from "../src/match.js";
import { createTacticsKernel } from "../src/kernel.js";
import { defaultTrainingWeapons, type SpawnUnitConfig } from "../src/defaults.js";
import { PLAYER_OWNER, ENEMY_OWNER } from "../src/debug-map.js";
import type { WeaponStats } from "../src/weapons.js";

const SWEEP_SWORD: WeaponStats = {
  id: "sweep_sword",
  category: "melee",
  apCost: 1,
  endsTurn: true,
  range: 1,
  requiresLOS: false,
  aimMod: 0,
  minDmg: 3,
  maxDmg: 5,
  crit: 10,
  critBonus: 2,
  sweep: true,
};

const ENV_BOW: WeaponStats = {
  id: "env_bow",
  category: "ranged",
  apCost: 1,
  endsTurn: true,
  range: 8,
  requiresLOS: true,
  aimMod: 0,
  minDmg: 3,
  maxDmg: 5,
  crit: 15,
  critBonus: 2,
  envDmg: 1,
};

describe("cover destruction (§12)", () => {
  it("reduces cover type by 1 when hit with envDmg weapon", () => {
    const match = createQuickMatch({ enemyCount: 3, seed: 100 });
    // Найти укрытие type=2.
    const cover = match.entities.find((e) => e.coverType === 2);
    if (!cover) return;
    const strelets = match.entities.find((e) => e.owner === PLAYER_OWNER && e.configId === "strelets");
    if (!strelets) return;
    // Поставить стрельца рядом с укрытием.
    strelets.x = cover.x + 2;
    strelets.y = cover.y;
    strelets.z = cover.z;
    strelets.weaponId = "env_bow";

    const kernel = createTacticsKernel({
      initial: match,
      weapons: { ...defaultTrainingWeapons(), env_bow: ENV_BOW },
      seed: 100,
    });
    const result = kernel.apply({ type: "ATTACK", actorId: strelets.id, targetId: cover.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const events = result.events;
    const coverDmg = events.find((e) => e.type === "COVER_DAMAGED");
    expect(coverDmg).toBeDefined();
    if (coverDmg && coverDmg.type === "COVER_DAMAGED") {
      expect(coverDmg.newCoverType).toBe(1);
    }
  });

  it("removes cover when type reaches 0", () => {
    const match = createQuickMatch({ enemyCount: 3, seed: 200 });
    const cover = match.entities.find((e) => e.coverType === 1);
    if (!cover) return;
    const strelets = match.entities.find((e) => e.owner === PLAYER_OWNER && e.configId === "strelets");
    if (!strelets) return;
    strelets.x = cover.x + 2;
    strelets.y = cover.y;
    strelets.z = cover.z;
    strelets.weaponId = "env_bow";

    const kernel = createTacticsKernel({
      initial: match,
      weapons: { ...defaultTrainingWeapons(), env_bow: ENV_BOW },
      seed: 200,
    });
    kernel.apply({ type: "ATTACK", actorId: strelets.id, targetId: cover.id });
    const after = kernel.getSnapshot().entities.find((e) => e.id === cover.id);
    expect(after?.coverType).toBe(0);
    expect(after?.obstacle).toBe(false);
    expect(after?.dead).toBe(true);
  });

  it("rejects cover attack with weapon that has no envDmg", () => {
    const match = createQuickMatch({ enemyCount: 3, seed: 300 });
    const cover = match.entities.find((e) => e.coverType > 0);
    if (!cover) return;
    const strelets = match.entities.find((e) => e.owner === PLAYER_OWNER && e.configId === "strelets");
    if (!strelets) return;
    strelets.x = cover.x + 2;
    strelets.y = cover.y;
    strelets.z = cover.z;

    const kernel = createTacticsKernel({
      initial: match,
      weapons: defaultTrainingWeapons(),
      seed: 300,
    });
    const result = kernel.apply({ type: "ATTACK", actorId: strelets.id, targetId: cover.id });
    expect(result.ok).toBe(false);
  });
});

describe("sweep attack (Взмах Богатыря)", () => {
  it("hits all adjacent enemies", () => {
    const match = createQuickMatch({ enemyCount: 5, seed: 400 });
    const bogatyr = match.entities.find((e) => e.owner === PLAYER_OWNER && e.configId === "bogatyr");
    if (!bogatyr) return;
    // Убрать все сущности рядом с богатырём и поставить двух врагов.
    const enemies = match.entities.filter((e) => e.owner === ENEMY_OWNER && e.coverType === 0);
    if (enemies.length < 2) return;
    // Очистить соседние клетки от укрытий.
    for (const e of match.entities) {
      if (e.coverType > 0 && Math.abs(e.x - bogatyr.x) <= 1 && Math.abs(e.y - bogatyr.y) <= 1) {
        e.dead = true;
        e.obstacle = false;
      }
    }
    enemies[0]!.x = bogatyr.x + 1;
    enemies[0]!.y = bogatyr.y;
    enemies[0]!.z = bogatyr.z;
    enemies[1]!.x = bogatyr.x - 1;
    enemies[1]!.y = bogatyr.y;
    enemies[1]!.z = bogatyr.z;
    bogatyr.weaponId = "sweep_sword";

    const kernel = createTacticsKernel({
      initial: match,
      weapons: { ...defaultTrainingWeapons(), sweep_sword: SWEEP_SWORD },
      seed: 400,
    });
    const result = kernel.apply({ type: "ATTACK", actorId: bogatyr.id, targetId: enemies[0]!.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const combats = result.events.filter((e) => e.type === "COMBAT_RESOLVED");
    // Взмах должен поразить как минимум двух смежных врагов.
    expect(combats.length).toBeGreaterThanOrEqual(2);
  });
});
