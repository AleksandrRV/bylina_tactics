import { describe, expect, it } from "vitest";
import { createTacticsKernel } from "../src/kernel.js";
import { makeGrid, tileAt } from "../src/grid.js";
import { generateBattlefield, playerSpawns, enemySpawns } from "../src/mapgen.js";
import { createMulberry32 } from "../src/rng.js";
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

  it("does not trigger the elimination outcome when the last fighter extracts", () => {
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
    // Завершение миссии спасения/разведки определяет слой кампании;
    // удаление с поля само по себе не фиксирует поражение по уничтожению.
    expect(result.events.some((event) => event.type === "MATCH_ENDED")).toBe(false);
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
