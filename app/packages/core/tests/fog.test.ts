import { describe, expect, it } from "vitest";
import { createQuickMatch } from "../src/match.js";
import { createTacticsKernel } from "../src/kernel.js";
import { defaultTrainingWeapons } from "../src/defaults.js";
import { computeVisibleCells } from "../src/fog.js";
import { makeGrid, tileAt } from "../src/grid.js";
import { PLAYER_OWNER, ENEMY_OWNER } from "../src/debug-map.js";
import type { EntityState } from "../src/types.js";

describe("fog of war", () => {
  it("player sees cells around their units", () => {
    const match = createQuickMatch({ enemyCount: 3, seed: 42 });
    const visible = computeVisibleCells(match, PLAYER_OWNER);
    expect(visible.size).toBeGreaterThan(0);
    // Клетки под самими юнитами всегда видны.
    for (const entity of match.entities) {
      if (entity.owner === PLAYER_OWNER && !entity.dead && entity.coverType === 0) {
        expect(visible.has(`${entity.x},${entity.y}`)).toBe(true);
      }
    }
  });

  it("height bonus extends vision range", () => {
    // Контролируемая сетка вместо сгенерированной: проверка не зависит от
    // раскладки карты и позиций высадки. Юнит в углу (0,0), дальность 10.
    const grid = makeGrid(20, 20, 1);
    const unit: EntityState = {
      id: 1,
      configId: "u",
      owner: 1,
      x: 0,
      y: 0,
      z: 1,
      dir: 0,
      ap: 2,
      maxAp: 2,
      mobility: 5,
      hp: 10,
      maxHp: 10,
      aim: 70,
      defense: 0,
      vision: 10,
      weaponId: "",
      weaponIds: [],
      skillIds: [],
      obstacle: true,
      dead: false,
      flying: false,
      coverType: 0,
      overwatch: false,
      defending: false,
      movementSpent: 0,
    };
    const own = tileAt(grid, 0, 0)!;

    // С высоты z=2 (поправка +1): клетка на расстоянии vision+1 = 11 видна.
    own.z = 2;
    const visibleHigh = computeVisibleCells(
      { turnNumber: 1, activeOwner: 1, grid, entities: [{ ...unit, z: 2 }] },
      PLAYER_OWNER,
    );

    // Снизу z=0 (поправка −1): та же клетка вне дальности (эффективная 9).
    own.z = 0;
    const visibleLow = computeVisibleCells(
      { turnNumber: 1, activeOwner: 1, grid, entities: [{ ...unit, z: 0 }] },
      PLAYER_OWNER,
    );

    expect(visibleHigh.has("11,0")).toBe(true);
    expect(visibleLow.has("11,0")).toBe(false);
    expect(visibleHigh.size).toBeGreaterThan(visibleLow.size);
  });

  it("observes the own cell even with zero vision (§8.1)", () => {
    const grid = makeGrid(5, 5, 1);
    const unit: EntityState = {
      id: 1,
      configId: "u",
      owner: 1,
      x: 2,
      y: 2,
      z: 1,
      dir: 0,
      ap: 1,
      maxAp: 1,
      mobility: 4,
      hp: 1,
      maxHp: 1,
      aim: 0,
      defense: 0,
      vision: 0,
      weaponId: "",
      weaponIds: [],
      skillIds: [],
      obstacle: true,
      dead: false,
      flying: false,
      coverType: 0,
      overwatch: false,
      defending: false,
      movementSpent: 0,
    };
    const visible = computeVisibleCells({ turnNumber: 1, activeOwner: 1, grid, entities: [unit] }, PLAYER_OWNER);
    expect(visible.has("2,2")).toBe(true);
    expect(visible.has("3,2")).toBe(false);
  });

  it("walls block vision", () => {
    const match = createQuickMatch({ enemyCount: 3, seed: 1 });
    const player = match.entities.find((e) => e.owner === PLAYER_OWNER && e.coverType === 0);
    if (!player) return;
    // Поставить стену прямо перед бойцом.
    const wallX = player.x + 1;
    const wallTile = match.grid.tiles.find((t) => t.x === wallX && t.y === player.y);
    if (!wallTile) return;
    wallTile.blockLOS = true;
    const visible = computeVisibleCells(match, PLAYER_OWNER);
    // Клетка сразу за стеной по направлению от бойца не видна ЭТИМ бойцом.
    // (Другие бойцы могут видеть её с другого направления — это нормально.)
    const behindWall = match.grid.tiles.find((t) => t.x === wallX + 1 && t.y === player.y);
    if (behindWall) {
      // Проверяем, что конкретный боец не видит клетку за стеной.
      const cellVisibleByThisUnit = computeVisibleCells(
        {
          ...match,
          entities: match.entities.filter((e) => e.id === player.id || e.owner !== PLAYER_OWNER),
        },
        PLAYER_OWNER,
      );
      expect(cellVisibleByThisUnit.has(`${behindWall.x},${behindWall.y}`)).toBe(false);
    }
  });

  it("kernel tracks visible and explored cells", () => {
    const match = createQuickMatch({ enemyCount: 3, seed: 100 });
    const kernel = createTacticsKernel({
      initial: match,
      weapons: defaultTrainingWeapons(),
      seed: 100,
    });
    const visible = kernel.getVisibleCells(PLAYER_OWNER);
    const explored = kernel.getExploredCells(PLAYER_OWNER);
    expect(visible.size).toBeGreaterThan(0);
    // Изначально visible ⊆ explored.
    for (const key of visible) {
      expect(explored.has(key)).toBe(true);
    }
  });

  it("explored cells persist after visibility is lost", () => {
    const match = createQuickMatch({ enemyCount: 3, seed: 7 });
    const kernel = createTacticsKernel({
      initial: match,
      weapons: defaultTrainingWeapons(),
      seed: 7,
    });
    const beforeExplored = kernel.getExploredCells(PLAYER_OWNER);
    const sizeBefore = beforeExplored.size;
    // Передвинуть бойца в другую сторону.
    const player = match.entities.find((e) => e.owner === PLAYER_OWNER && e.coverType === 0 && e.ap > 0);
    if (!player) return;
    const reachable = kernel.getReachable(player.id);
    const step = reachable[0];
    if (!step) return;
    kernel.apply({ type: "MOVE", actorId: player.id, to: step });
    const afterExplored = kernel.getExploredCells(PLAYER_OWNER);
    // После перемещения исследовано не меньше клеток, чем до.
    expect(afterExplored.size).toBeGreaterThanOrEqual(sizeBefore);
  });

  it("removes unseen and hidden enemies from the side snapshot and previews", () => {
    const match = createQuickMatch({ enemyCount: 3, seed: 55 });
    const player = match.entities.find((entity) => entity.owner === PLAYER_OWNER && entity.coverType === 0)!;
    const enemy = match.entities.find((entity) => entity.owner === ENEMY_OWNER && entity.coverType === 0)!;
    player.vision = 1;
    enemy.x = match.grid.width - 2;
    enemy.y = 1;
    enemy.hidden = true;
    const kernel = createTacticsKernel({ initial: match, weapons: defaultTrainingWeapons() });
    const reduced = kernel.getSnapshotFor(PLAYER_OWNER);
    expect(reduced.entities.some((entity) => entity.id === enemy.id)).toBe(false);
    expect(kernel.getHitPreview(player.id, enemy.id, player.weaponId)).toEqual({ available: false });
    const unknown = reduced.grid.tiles.find((tile) => tile.x === enemy.x && tile.y === enemy.y);
    expect(unknown).toMatchObject({ z: 0, pit: false, blockLOS: false });
  });
});
