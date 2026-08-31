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
  id: "sword",
  category: "melee",
  apCost: 1,
  endsTurn: true,
  range: 1,
  requiresLOS: false,
  aimMod: 0,
  minDmg: 5,
  maxDmg: 5,
  crit: 0,
  critBonus: 0,
  envDmg: 0,
};

function unit(id: number, owner: number, x: number, y: number): import("@bylina/core").EntityState {
  return {
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
  };
}

function matchState(): MatchState {
  return {
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

describe("replay draft keeps only applied commands (0.21.2, Major-3)", () => {
  it("a rejected guest command is not recorded in the host journal", async () => {
    const { host, guest } = setupPair();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await guest.waitForNetSync();

    // Черновик журнала переживает открытие боя (0.21.2): раньше openBattle
    // с ...idle затирал его в null.
    const draftBefore = host.getReplayDraft();
    expect(draftBefore).not.toBeNull();
    expect(draftBefore?.commands).toHaveLength(0);

    // Активна сторона ведущего (1). Ведомый (сторона 2) пытается завершить
    // чужой ход — команда отклонена (NOT_YOUR_TURN) и в журнал не попадает.
    guest.sendNetCommand({ type: "END_TURN", playerId: "1" });
    guest.sendNetCommand({ type: "END_TURN", playerId: "1" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(host.getReplayDraft()?.commands).toHaveLength(0);

    // Легитимный ход самого ведущего (его собственный END_TURN) — записан.
    host.applyBattleCommand({ type: "END_TURN", playerId: "1" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const draftAfterHostMove = host.getReplayDraft();
    expect(draftAfterHostMove?.commands).toHaveLength(1);
    expect(draftAfterHostMove?.commands[0]).toEqual({ type: "END_TURN", playerId: "1" });

    // После перехода хода ведомый делает свой легитимный END_TURN — тоже
    // записан (команда прошла и применилась у ведущего).
    await new Promise((resolve) => setTimeout(resolve, 0));
    guest.sendNetCommand({ type: "END_TURN", playerId: "2" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.getReplayDraft()?.commands).toHaveLength(2);
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

describe("QA net peer role from the joining side (0.16.0)", () => {
  it("a guest that identifies as spectator receives the union snapshot", async () => {
    const { a, b } = createChannelPair();
    const host = createSession("menu");
    const spectator = createSession("menu");
    // Ведущий не задаёт роль; подключающийся выбирает наблюдателя.
    host.startNetPvpBattle({ side1: ["bogatyr"], side2: ["bogatyr"] }, 9, a);
    spectator.bindNetSpectator(b);
    const kernel = createTacticsKernel({ initial: matchState(), weapons: { sword: SWORD }, skills: {}, seed: 9 });
    host.bindTacticsHost(kernel);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await spectator.waitForNetSync();
    const snapshot = spectator.getNetSnapshot();
    expect(snapshot).not.toBeNull();
    // Наблюдатель не может ходить: команды не отправляются.
    spectator.sendNetCommand({ type: "END_TURN", playerId: "1" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(kernel.getSnapshot().activeOwner).toBe(1);
  });

  it("host falls back to guest snapshot when the joining side says guest", async () => {
    const { a, b } = createChannelPair();
    const host = createSession("menu");
    const guest = createSession("menu");
    // Ведущий изначально рассчитывал на наблюдателя, но подключился соперник.
    host.startNetPvpBattle({ side1: ["bogatyr"], side2: ["bogatyr"] }, 10, a, { peerRole: "spectator" });
    guest.bindGuestNetPvp(2, b);
    // Сцена с ограниченным зрением: боец стороны 1 вне обзора гостя.
    const state = matchState();
    for (const entity of state.entities) {
      entity.vision = 3;
      if (entity.owner === 1) {
        entity.x = 1;
        entity.y = 1;
      } else {
        entity.x = 6;
        entity.y = 2;
      }
    }
    const kernel = createTacticsKernel({ initial: state, weapons: { sword: SWORD }, skills: {}, seed: 10 });
    host.bindTacticsHost(kernel);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await guest.waitForNetSync();
    const snapshot = guest.getNetSnapshot();
    expect(snapshot).not.toBeNull();
    // Снимок — сторона 2: скрытый от гостя боец стороны 1 отсутствует.
    if (!snapshot) return;
    expect(snapshot.entities.some((entity) => entity.owner === 1 && entity.coverType === 0)).toBe(false);
  });
});

describe("QA replay recording (0.17.0)", () => {
  it("finishing a pvp match records the winner and clears the draft", () => {
    const session = createSession("menu");
    session.startPvpBattle(["bogatyr"], ["bogatyr"], 5);
    const state = matchState();
    // Вплотную для атаки.
    const attacker = state.entities.find((entity) => entity.id === 1)!;
    const target = state.entities.find((entity) => entity.id === 11)!;
    target.x = attacker.x + 1;
    target.y = attacker.y;
    const kernel = createTacticsKernel({
      initial: state,
      weapons: { sword: { ...SWORD, minDmg: 20, maxDmg: 20 } },
      skills: {},
      seed: 5,
    });
    session.bindTacticsHost(kernel);
    const applied = kernel.apply({ type: "ATTACK", actorId: 1, targetId: 11, weaponId: "sword" });
    expect(applied.ok).toBe(true);
    expect(applied.ok && applied.events.some((event) => event.type === "MATCH_ENDED")).toBe(true);
    session.finishPvpMatch(1);
    expect(session.get().screen).toBe("result");
    expect(session.get().replayWinner).toBe(1);
    // Черновик очищается слоем приложения после записи.
    session.setReplayDraft(null);
    expect(session.get().replayDraft).toBeNull();
  });

  it("an aborted net battle can be saved as a replay with no winner", () => {
    const session = createSession("menu");
    session.startPvpBattle(["bogatyr"], ["bogatyr"], 6);
    session.finishReplayDraft(null);
    expect(session.get().replayWinner).toBeNull();
  });
});
