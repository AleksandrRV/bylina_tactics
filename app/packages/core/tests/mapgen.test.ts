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
        vision: 0,
        weaponId: "",
        obstacle: false,
        dead: false,
        flying: false,
        coverType: 0 as const,
        overwatch: false,
        movementSpent: 0,
      };
      for (const to of enemies) {
        expect(findPath(grid, covers, walker, to.x, to.y)).not.toBeNull();
      }
    }
  });
});

describe("generateBattlefield minCovers (0.20.1)", () => {
  it("guarantees at least the requested number of whole-cell covers", () => {
    const config = { ...QUICK_MATCH_MAP, coverDensity: 0, minCovers: 3 };
    for (const seed of [1, 7, 42, 99, 2024]) {
      const rng = createMulberry32(seed);
      const players = playerSpawns(config.height);
      const enemies = enemySpawns(3, config.width, config.height);
      const { covers } = generateBattlefield(config, rng, players, enemies);
      const wholeCell = covers.filter((cover) => cover.edge === undefined);
      expect(wholeCell.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("does not add covers when minCovers is not set", () => {
    const config = { ...QUICK_MATCH_MAP, coverDensity: 0 };
    const rng = createMulberry32(1);
    const players = playerSpawns(config.height);
    const enemies = enemySpawns(3, config.width, config.height);
    const { covers } = generateBattlefield(config, rng, players, enemies);
    expect(covers.filter((cover) => cover.edge === undefined).length).toBe(0);
  });
});

describe("playerSpawns", () => {
  it("provides five distinct spawn cells for a five-fighter deployment", () => {
    const players = playerSpawns(10);
    expect(players).toHaveLength(5);
    expect(new Set(players.map((point) => `${point.x},${point.y}`)).size).toBe(5);
    for (const point of players) {
      expect(point.x).toBeGreaterThanOrEqual(1);
      expect(point.x).toBeLessThanOrEqual(QUICK_MATCH_MAP.width - 2);
      expect(point.y).toBeGreaterThanOrEqual(1);
      expect(point.y).toBeLessThanOrEqual(QUICK_MATCH_MAP.height - 2);
    }
  });
});
