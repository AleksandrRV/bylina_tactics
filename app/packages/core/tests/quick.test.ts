import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRAINING_UNITS,
  ENEMY_OWNER,
  PLAYER_OWNER,
  QUICK_MATCH_MAP,
  createQuickMatch,
  createTacticsKernel,
  defaultTrainingWeapons,
  livingOf,
  matchOutcome,
  pickEnemyCommand,
  runEnemyTurn,
} from "../src/index.js";

describe("createQuickMatch", () => {
  it("places three player roles and the requested enemy count", () => {
    const easy = createQuickMatch({ enemyCount: 3, seed: 11 });
    const hard = createQuickMatch({ enemyCount: 8, seed: 11 });
    expect(livingOf(easy, PLAYER_OWNER)).toHaveLength(3);
    expect(livingOf(easy, ENEMY_OWNER)).toHaveLength(3);
    expect(livingOf(hard, ENEMY_OWNER)).toHaveLength(8);
    expect(
      easy.entities.filter((entity) => entity.coverType === 0 && !entity.dead).every((entity) => entity.maxAp > 0),
    ).toBe(true);
  });

  it("uses configured player slots and unit tags", () => {
    const units = Object.values(DEFAULT_TRAINING_UNITS).map((unit) => ({
      ...unit,
      tags: unit.id === "upyr" ? ["flying" as const] : [],
    }));
    const match = createQuickMatch({
      enemyCount: 3,
      seed: 17,
      units,
      playerSlots: ["upyr", "strelets", "znaharka"],
    });
    const first = livingOf(match, PLAYER_OWNER).find((entity) => entity.id === 1)!;
    expect(first.configId).toBe("upyr");
    expect(first.flying).toBe(true);
  });

  it("draws enemy types from the pool and may repeat", () => {
    const match = createQuickMatch({ enemyCount: 8, seed: 99 });
    const types = new Set(livingOf(match, ENEMY_OWNER).map((entity) => entity.configId));
    for (const type of types) {
      expect(["upyr", "leshy", "kikimora"]).toContain(type);
    }
  });

  it("keeps spawn cells free of pits and walls", () => {
    const match = createQuickMatch({ enemyCount: 5, seed: 7, map: QUICK_MATCH_MAP });
    for (const unit of match.entities.filter((entity) => entity.coverType === 0)) {
      const tile = match.grid.tiles.find((item) => item.x === unit.x && item.y === unit.y);
      expect(tile?.pit).toBe(false);
      expect(tile?.blockLOS).toBe(false);
    }
  });
});

describe("matchOutcome", () => {
  it("reports victory when nav is gone and defeat when the host is gone", () => {
    const match = createQuickMatch({ enemyCount: 3, seed: 1 });
    expect(matchOutcome(match)).toBe("ongoing");
    for (const entity of match.entities) {
      if (entity.owner === ENEMY_OWNER && entity.coverType === 0) {
        entity.dead = true;
        entity.hp = 0;
        entity.obstacle = false;
      }
    }
    expect(matchOutcome(match)).toBe("victory");
    const lost = createQuickMatch({ enemyCount: 3, seed: 1 });
    for (const entity of lost.entities) {
      if (entity.owner === PLAYER_OWNER && entity.coverType === 0) {
        entity.dead = true;
        entity.hp = 0;
        entity.obstacle = false;
      }
    }
    expect(matchOutcome(lost)).toBe("defeat");
    const temporary = lost.entities.find((entity) => entity.owner === PLAYER_OWNER)!;
    temporary.dead = false;
    temporary.hp = 1;
    temporary.countsForElimination = false;
    expect(matchOutcome(lost)).toBe("defeat");
  });
});

describe("enemy AI", () => {
  it("forms MOVE or ATTACK while it is nav's turn", () => {
    const kernel = createTacticsKernel({
      initial: createQuickMatch({ enemyCount: 3, seed: 21 }),
      weapons: defaultTrainingWeapons(),
      seed: 21,
    });
    kernel.apply({ type: "END_TURN", playerId: "1" });
    expect(kernel.getSnapshot().activeOwner).toBe(ENEMY_OWNER);
    const command = pickEnemyCommand(kernel);
    expect(
      command === null || command.type === "MOVE" || command.type === "ATTACK" || command.type === "OVERWATCH",
    ).toBe(true);
    const events = runEnemyTurn(kernel);
    expect(events.length).toBeGreaterThan(0);
    expect(kernel.getSnapshot().activeOwner).toBe(PLAYER_OWNER);
  });
});

describe("debug auto win", () => {
  it("instantly destroys all enemies and ends the match with a player victory", () => {
    const kernel = createTacticsKernel({
      initial: createQuickMatch({ enemyCount: 3, seed: 31 }),
      weapons: defaultTrainingWeapons(),
      seed: 31,
    });
    const result = kernel.debugAutoWin();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.some((event) => event.type === "ENTITY_DIED")).toBe(true);
    expect(result.events.some((event) => event.type === "MATCH_ENDED" && event.winnerPlayerId === "1")).toBe(true);
    const snapshot = kernel.getSnapshot();
    expect(
      snapshot.entities.filter((entity) => entity.owner === ENEMY_OWNER && entity.coverType === 0 && !entity.dead),
    ).toHaveLength(0);
  });

  it("rejects a second auto win after the match has ended", () => {
    const kernel = createTacticsKernel({
      initial: createQuickMatch({ enemyCount: 3, seed: 32 }),
      weapons: defaultTrainingWeapons(),
      seed: 32,
    });
    expect(kernel.debugAutoWin().ok).toBe(true);
    expect(kernel.debugAutoWin()).toEqual({ ok: false, reason: "ILLEGAL" });
  });

  it("auto win does not depend on whose turn it is", () => {
    const kernel = createTacticsKernel({
      initial: createQuickMatch({ enemyCount: 3, seed: 33 }),
      weapons: defaultTrainingWeapons(),
      seed: 33,
    });
    kernel.apply({ type: "END_TURN", playerId: "1" });
    expect(kernel.getSnapshot().activeOwner).toBe(ENEMY_OWNER);
    const result = kernel.debugAutoWin();
    expect(result.ok).toBe(true);
    expect(
      result.ok && result.events.some((event) => event.type === "MATCH_ENDED" && event.winnerPlayerId === "1"),
    ).toBe(true);
  });
});
