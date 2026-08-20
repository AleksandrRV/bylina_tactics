import { describe, expect, it } from "vitest";
import { createMulberry32 } from "../src/rng.js";
import { findPath } from "../src/pathfinding.js";
import { tileAt } from "../src/grid.js";
import { QUICK_MATCH_MAP, enemySpawns, generateBattlefield, playerSpawns } from "../src/mapgen.js";

describe("generateBattlefield", () => {
  it("connects every player spawn to every enemy spawn", () => {
    const rng = createMulberry32(0x51a7);
    const players = playerSpawns(QUICK_MATCH_MAP.height);
    const enemies = enemySpawns(5, QUICK_MATCH_MAP.width, QUICK_MATCH_MAP.height);
    const { grid, covers } = generateBattlefield(QUICK_MATCH_MAP, rng, players, enemies);
    for (const from of players) {
      const start = tileAt(grid, from.x, from.y);
      expect(start?.pit).toBe(false);
      expect(start?.blockLOS).toBe(false);
      const walker = {
        id: -1,
        configId: "probe",
        owner: 1,
        x: from.x,
        y: from.y,
        z: start?.z ?? 1,
        dir: 0,
        ap: 2,
        maxAp: 2,
        mobility: 8,
        hp: 1,
        maxHp: 1,
        aim: 0,
        defense: 0,
        weaponId: "",
        obstacle: false,
        dead: false,
        flying: false,
        coverType: 0 as const,
      };
      for (const to of enemies) {
        expect(findPath(grid, covers, walker, to.x, to.y)).not.toBeNull();
      }
    }
  });
});
