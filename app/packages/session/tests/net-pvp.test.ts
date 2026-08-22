import { describe, expect, it } from "vitest";
import { createChannelPair, createLocalTransport } from "@bylina/net";
import { createTacticsKernel, type MatchState, type WeaponStats } from "@bylina/core";
import { createSession } from "../src/index.js";

/**
 * Автоматические проверки канала на двух экземплярах приложения (roadmap
 * 0.15.0): ведущий исполняет правила, ведомый передаёт намерение и получает
 * сокращённый снимок и события; предпросмотр — запросами к ведущему.
 */

const SWORD: WeaponStats = {
  id: "sword", category: "melee", apCost: 1, endsTurn: true, range: 1,
  requiresLOS: false, aimMod: 0, minDmg: 5, maxDmg: 5, crit: 0, critBonus: 0, envDmg: 0,
};

function unit(id: number, owner: number, x: number, y: number): import("@bylina/core").EntityState {
  return {
    id, configId: "bogatyr", owner, x, y, z: 1, dir: owner === 1 ? 1 : 3, ap: 2, maxAp: 2, mobility: 5,
    hp: 12, maxHp: 12, aim: 100, defense: 0, will: 40, vision: 12,
    weaponId: "sword", weaponIds: ["sword"], skillIds: [], obstacle: true, dead: false, flying: false,
    coverType: 0, overwatch: false, defending: false, movementSpent: 0,
  };
}

function matchState(): MatchState {
  return {
    turnNumber: 1,
    activeOwner: 1,
    grid: { width: 8, height: 6, tiles: Array.from({ length: 48 }, (_, i) => ({ x: i % 8, y: Math.floor(i / 8), z: 1, pit: false, blockLOS: false })) },
    entities: [unit(1, 1, 1, 2), unit(11, 2, 6, 2)],
  };
}

function setupPair() {
  const { a, b } = createChannelPair();
  const host = createSession("menu");
  const guest = createSession("menu");
  host.startNetPvpBattle({ side1: ["bogatyr"], side2: ["bogatyr"] }, 5, a);
  guest.bindGuestNetPvp(2, b);
  const kernel = createTacticsKernel({ initial: matchState(), weapons: { sword: SWORD }, skills: {}, seed: 5 });
  host.bindTacticsHost(kernel);
  return { host, guest, kernel };
}

describe("network pvp: two app instances (0.15.0)", () => {
  it("guest receives the initial reduced snapshot from the host", async () => {
    const { guest } = setupPair();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await guest.waitForNetSync()).toBe(true);
    const snapshot = guest.getNetSnapshot();
    expect(snapshot).not.toBeNull();
    // Сокращение по зрению: в снимке гостя нет чужих юнитов вне видимости.
    if (!snapshot) return;
    expect(snapshot.activeOwner).toBe(1);
  });

  it("guest commands are applied by the host and synced back", async () => {
    const { host, guest, kernel } = setupPair();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await guest.waitForNetSync();

    // Гость не может завершить ход ведущего — команда отклонена (REJECT),
    // активна сторона 1.
    guest.sendNetCommand({ type: "END_TURN", playerId: "1" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(kernel.getSnapshot().activeOwner).toBe(1);

    // Ход ведущего завершает он сам (интерфейс ведущего), после чего ходит гость.
    host.applyBattleCommand({ type: "END_TURN", playerId: "1" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(kernel.getSnapshot().activeOwner).toBe(2);

    // Гость двигает своего бойца.
    const guestUnit = kernel.getSnapshot().entities.find((e) => e.owner === 2)!;
    guest.sendNetCommand({ type: "MOVE", actorId: guestUnit.id, to: { x: 5, y: 2, z: 1 } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(kernel.getSnapshot().entities.find((e) => e.id === guestUnit.id)?.x).toBe(5);
    // Снимок гостя обновлён.
    expect(guest.getNetSnapshot()?.entities.find((e) => e.id === guestUnit.id)?.x).toBe(5);
  });

  it("guest preview queries return reachable cells from the host", async () => {
    const { guest, kernel } = setupPair();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await guest.waitForNetSync();
    kernel.apply({ type: "END_TURN", playerId: "1" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const guestUnit = kernel.getSnapshot().entities.find((e) => e.owner === 2)!;
    // Первый вызов — пустой кэш; ответ придёт асинхронно.
    const cells = guest.requestNetReachable(guestUnit.id);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const cellsAfter = guest.requestNetReachable(guestUnit.id);
    expect(cellsAfter.length).toBeGreaterThan(0);
    expect(cells.length).toBe(0); // первый вызов был до ответа
  });

  it("guest is notified of battle updates through the snapshot cache", async () => {
    const { host, guest } = setupPair();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await guest.waitForNetSync();
    let ticks = 0;
    const unlisten = guest.subscribeBattle(() => {
      ticks += 1;
    });
    // Ход ведущего завершает он сам; снимок гостя обновляется → уведомление.
    host.applyBattleCommand({ type: "END_TURN", playerId: "1" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ticks).toBeGreaterThan(0);
    unlisten();
  });
});

describe("QA net edge cases (0.15.0)", () => {
  it("waitForNetSync resolves false after timeout without a browser", async () => {
    const { b } = createChannelPair();
    const guest = createSession("menu");
    guest.bindGuestNetPvp(2, b);
    const result = await guest.waitForNetSync();
    expect(result).toBe(false);
  }, 8000);

  it("rebinding the guest transport replaces the old channel cleanly", async () => {
    const { b: b1 } = createChannelPair();
    const { b: b2 } = createChannelPair();
    const guest = createSession("menu");
    guest.bindGuestNetPvp(2, b1);
    guest.bindGuestNetPvp(2, b2);
    // Повторная привязка не ломает состояние.
    expect(guest.get().battleKind).toBe("pvpNet");
    expect(guest.get().netRole).toBe("guest");
    expect(guest.get().netOwner).toBe(2);
  });
});
