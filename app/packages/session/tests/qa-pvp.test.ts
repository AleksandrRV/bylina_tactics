import { describe, expect, it } from "vitest";
import { createTacticsKernel, type EntityState, type MatchState, type WeaponStats } from "@bylina/core";
import { createSession } from "../src/index.js";

/**
 * Сквозной QA-сценарий поочерёдной игры (0.14.0): комната → бой через
 * локальный транспорт → уничтожение стороны → итог с победителем.
 */
describe("QA pvp pass-and-play (0.14.0)", () => {
  it("plays a full match through the local transport and reports the winner", async () => {
    const session = createSession("menu");
    session.openPvpRoom();
    expect(session.get().screen).toBe("pvpRoom");

    const pool = ["bogatyr", "strelets"];
    session.startPvpBattle([...pool], [...pool], 123);
    expect(session.get().battleKind).toBe("pvp");

    const sword: WeaponStats = {
      id: "sword",
      category: "melee",
      apCost: 1,
      endsTurn: true,
      range: 1,
      requiresLOS: false,
      aimMod: 0,
      minDmg: 20,
      maxDmg: 20,
      crit: 0,
      critBonus: 0,
      envDmg: 0,
    };
    const unit = (id: number, owner: number, x: number, y: number): EntityState => ({
      id,
      configId: "bogatyr",
      owner,
      x,
      y,
      z: 1,
      dir: owner === 1 ? 1 : 3,
      ap: 2,
      maxAp: 2,
      mobility: 5,
      hp: 12,
      maxHp: 12,
      aim: 100,
      defense: 0,
      will: 40,
      vision: 12,
      weaponId: "sword",
      weaponIds: ["sword"],
      skillIds: [],
      obstacle: true,
      dead: false,
      flying: false,
      coverType: 0,
      overwatch: false,
      defending: false,
      movementSpent: 0,
    });
    const match: MatchState = {
      turnNumber: 1,
      activeOwner: 1,
      grid: {
        width: 8,
        height: 6,
        tiles: Array.from({ length: 48 }, (_, i) => ({
          x: i % 8,
          y: Math.floor(i / 8),
          z: 1,
          pit: false,
          blockLOS: false,
        })),
      },
      entities: [unit(1, 1, 3, 2), unit(11, 2, 4, 2)],
    };
    const host = createTacticsKernel({ initial: match, weapons: { sword }, skills: {}, seed: 123 });
    session.bindTacticsHost(host);

    // Исход приходит через транспорт; UI завершает партию победой стороны.
    const ended: unknown[] = [];
    session.subscribePvpEvents((events) => {
      const end = events.find((event) => event.type === "MATCH_ENDED");
      if (end && end.type === "MATCH_ENDED") {
        ended.push(end);
        const winner = end.winnerPlayerId === "1" ? 1 : end.winnerPlayerId === "2" ? 2 : null;
        if (winner) session.finishPvpMatch(winner);
      }
    });

    // Ход стороны 1: атака вплотную убивает бойца стороны 2.
    session.sendPvpCommand({ type: "ATTACK", actorId: 1, targetId: 11, weaponId: "sword" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.getSnapshot().entities.find((entity) => entity.id === 11)?.dead).toBe(true);
    expect(ended.length).toBeGreaterThan(0);
    expect(session.get().screen).toBe("result");
    expect(session.get().pvpWinner).toBe(1);
  });

  it("passes the turn to the other side after END_TURN", async () => {
    const session = createSession("menu");
    session.startPvpBattle(["bogatyr"], ["bogatyr"], 7);
    const host = createTacticsKernel({
      initial: {
        turnNumber: 1,
        activeOwner: 1,
        grid: {
          width: 8,
          height: 6,
          tiles: Array.from({ length: 48 }, (_, i) => ({
            x: i % 8,
            y: Math.floor(i / 8),
            z: 1,
            pit: false,
            blockLOS: false,
          })),
        },
        entities: [
          {
            id: 1,
            configId: "bogatyr",
            owner: 1,
            x: 1,
            y: 2,
            z: 1,
            dir: 1,
            ap: 2,
            maxAp: 2,
            mobility: 5,
            hp: 12,
            maxHp: 12,
            aim: 70,
            defense: 10,
            will: 40,
            vision: 12,
            weaponId: "sword",
            weaponIds: ["sword"],
            skillIds: [],
            obstacle: true,
            dead: false,
            flying: false,
            coverType: 0,
            overwatch: false,
            defending: false,
            movementSpent: 0,
          },
          {
            id: 11,
            configId: "bogatyr",
            owner: 2,
            x: 6,
            y: 2,
            z: 1,
            dir: 3,
            ap: 2,
            maxAp: 2,
            mobility: 5,
            hp: 12,
            maxHp: 12,
            aim: 70,
            defense: 10,
            will: 40,
            vision: 12,
            weaponId: "sword",
            weaponIds: ["sword"],
            skillIds: [],
            obstacle: true,
            dead: false,
            flying: false,
            coverType: 0,
            overwatch: false,
            defending: false,
            movementSpent: 0,
          },
        ],
      },
    });
    session.bindTacticsHost(host);
    session.sendPvpCommand({ type: "END_TURN", playerId: "1" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.getSnapshot().activeOwner).toBe(2);
  });
});
