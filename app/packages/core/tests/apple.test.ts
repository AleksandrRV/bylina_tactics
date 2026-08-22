import { describe, expect, it } from "vitest";
import { createPvpMatch, createTacticsKernel } from "../src/index.js";
import { ENEMY_OWNER, PLAYER_OWNER } from "../src/debug-map.js";
import type { SpawnUnitConfig } from "../src/defaults.js";
import type { WeaponStats } from "../src/weapons.js";

const MAP = {
  width: 14,
  height: 10,
  pitChance: 0.02,
  coverDensity: 0.03,
  wallDensity: 0.01,
  edgeCoverChance: 0.4,
  halfCoverChance: 0.5,
  heightMix: { z0: 0.1, z1: 0.8, z2: 0.1 },
};

const BOGATYR: SpawnUnitConfig = {
  id: "bogatyr", maxHealth: 12, maxAP: 2, mobility: 5, aim: 100, defense: 0, will: 40,
  vision: 12, weapons: ["sword"], skills: [], tags: [],
};
const SWORD: WeaponStats = {
  id: "sword", category: "melee", apCost: 1, endsTurn: true, range: 1,
  requiresLOS: false, aimMod: 0, minDmg: 20, maxDmg: 20, crit: 0, critBonus: 0, envDmg: 0,
};

function appleMatch() {
  return createPvpMatch({
    units: [BOGATYR],
    map: MAP,
    side1: ["bogatyr", "bogatyr"],
    side2: ["bogatyr", "bogatyr"],
    objective: "apple",
    seed: 11,
  });
}

describe("apple objective (0.16.0, math §17)", () => {
  it("places the apple in the center and marks home edges", () => {
    const match = appleMatch();
    expect(match.apple).toBeDefined();
    expect(match.apple?.carrierId).toBeNull();
    const home1 = match.grid.tiles.filter((tile) => tile.homeOwner === 1);
    const home2 = match.grid.tiles.filter((tile) => tile.homeOwner === 2);
    expect(home1.length).toBeGreaterThan(0);
    expect(home2.length).toBeGreaterThan(0);
    expect(home1.every((tile) => tile.x === 0)).toBe(true);
    expect(home2.every((tile) => tile.x === MAP.width - 1)).toBe(true);
  });

  it("a fighter stepping on the apple cell becomes the carrier", () => {
    const match = appleMatch();
    // Расстановка до создания ядра: боец рядом с яблоком.
    const applePos = match.apple!.pos;
    const player = match.entities.find((e) => e.owner === PLAYER_OWNER && e.coverType === 0)!;
    const tile = match.grid.tiles.find((t) => t.x === applePos.x && t.y === applePos.y)!;
    player.x = applePos.x - 1;
    player.y = applePos.y;
    player.z = tile.z;
    const kernel = createTacticsKernel({ initial: match, weapons: { sword: SWORD }, skills: {}, seed: 11 });
    const result = kernel.apply({ type: "MOVE", actorId: player.id, to: { x: applePos.x, y: applePos.y, z: tile.z } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(kernel.getSnapshot().apple?.carrierId).toBe(player.id);
    expect(result.events.some((event) => event.type === "OBJECTIVE_CHANGED" && event.carrierId === player.id)).toBe(true);
  });

  it("carrying the apple to the home edge wins by OBJECTIVE", () => {
    const match = appleMatch();
    const player = match.entities.find((e) => e.owner === PLAYER_OWNER && e.coverType === 0)!;
    // Расчистка клеток пути (генератор мог создать ямы/стены).
    for (const x of [0, 1, 2]) {
      const tile = match.grid.tiles.find((t) => t.x === x && t.y === 5)!;
      tile.pit = false;
      tile.blockLOS = false;
    }
    match.apple = { pos: { x: 1, y: 5, z: match.grid.tiles.find((t) => t.x === 1 && t.y === 5)!.z }, carrierId: null };
    player.x = 2;
    player.y = 5;
    player.z = match.apple.pos.z;
    const kernel = createTacticsKernel({ initial: match, weapons: { sword: SWORD }, skills: {}, seed: 12 });
    const pick = kernel.apply({ type: "MOVE", actorId: player.id, to: { x: 1, y: 5, z: match.apple!.pos.z } });
    expect(pick.ok).toBe(true);
    if (!pick.ok) return;
    expect(kernel.getSnapshot().apple?.carrierId).toBe(player.id);
    // Второй ход: боец с яблоком вступает на клетку домашнего края (x=0).
    const carry = kernel.apply({ type: "MOVE", actorId: player.id, to: { x: 0, y: 5, z: match.apple!.pos.z } });
    expect(carry.ok).toBe(true);
    if (!carry.ok) return;
    expect(carry.events).toContainEqual({ type: "MATCH_ENDED", winnerPlayerId: String(PLAYER_OWNER), reason: "OBJECTIVE" });
  });

  it("the apple drops where the carrier dies", () => {
    const match = appleMatch();
    const player = match.entities.find((e) => e.owner === PLAYER_OWNER && e.coverType === 0)!;
    const enemy = match.entities.find((e) => e.owner === ENEMY_OWNER && e.coverType === 0)!;
    const z = match.grid.tiles.find((t) => t.x === 4 && t.y === 5)!.z;
    match.apple = { pos: { x: 4, y: 5, z }, carrierId: null };
    player.x = 3;
    player.y = 5;
    player.z = z;
    enemy.x = 5;
    enemy.y = 5;
    enemy.z = z;
    const kernel = createTacticsKernel({ initial: match, weapons: { sword: SWORD }, skills: {}, seed: 13 });
    // Ход 1: боец подбирает яблоко.
    const pick = kernel.apply({ type: "MOVE", actorId: player.id, to: { x: 4, y: 5, z } });
    expect(pick.ok).toBe(true);
    if (!pick.ok) return;
    expect(kernel.getSnapshot().apple?.carrierId).toBe(player.id);
    // Ход 2 (враг): атака убивает носителя.
    kernel.apply({ type: "END_TURN", playerId: "1" });
    const attack = kernel.apply({ type: "ATTACK", actorId: enemy.id, targetId: player.id, weaponId: "sword" });
    expect(attack.ok).toBe(true);
    if (!attack.ok) return;
    const after = kernel.getSnapshot();
    expect(after.apple?.carrierId).toBeNull();
    expect(after.apple?.pos).toEqual({ x: 4, y: 5, z });
  });

  it("rejects a side-1 roster larger than the spawn capacity", () => {
    expect(() =>
      createPvpMatch({
        units: [BOGATYR],
        map: MAP,
        side1: Array.from({ length: 6 }, () => "bogatyr"),
        side2: ["bogatyr"],
        seed: 14,
      }),
    ).toThrow();
  });
});
