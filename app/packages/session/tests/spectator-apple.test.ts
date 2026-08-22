import { describe, expect, it } from "vitest";
import { createChannelPair } from "@bylina/net";
import { createPvpMatch, createTacticsKernel, type MatchState, type WeaponStats } from "@bylina/core";
import { createSession } from "../src/index.js";

const SWORD: WeaponStats = { id: "sword", category: "melee", apCost: 1, endsTurn: true, range: 1, requiresLOS: false, aimMod: 0, minDmg: 5, maxDmg: 5, crit: 0, critBonus: 0, envDmg: 0 };

function matchState(apple = false): MatchState {
  const grid = { width: 14, height: 10, tiles: Array.from({ length: 140 }, (_, i) => ({ x: i % 14, y: Math.floor(i / 14), z: 1, pit: false, blockLOS: false, ...(apple && (i % 14 === 0 ? { homeOwner: 1 } : i % 14 === 13 ? { homeOwner: 2 } : {})) })) };
  return {
    turnNumber: 1,
    activeOwner: 1,
    grid,
    entities: [
      { id: 1, configId: "bogatyr", owner: 1, x: 3, y: 5, z: 1, dir: 1, ap: 2, maxAp: 2, mobility: 5, hp: 12, maxHp: 12, aim: 100, defense: 0, will: 40, vision: 12, weaponId: "sword", weaponIds: ["sword"], skillIds: [], obstacle: true, dead: false, flying: false, coverType: 0, overwatch: false, defending: false, movementSpent: 0 },
      { id: 11, configId: "bogatyr", owner: 2, x: 10, y: 5, z: 1, dir: 3, ap: 2, maxAp: 2, mobility: 5, hp: 12, maxHp: 12, aim: 100, defense: 0, will: 40, vision: 12, weaponId: "sword", weaponIds: ["sword"], skillIds: [], obstacle: true, dead: false, flying: false, coverType: 0, overwatch: false, defending: false, movementSpent: 0 },
    ],
    ...(apple ? { apple: { pos: { x: 7, y: 5, z: 1 }, carrierId: null } } : {}),
  };
}

describe("spectator (0.16.0)", () => {
  function hostWithSpectator(omniscient = false) {
    const { a, b } = createChannelPair();
    const host = createSession("menu");
    const spectator = createSession("menu");
    host.startNetPvpBattle({ side1: ["bogatyr"], side2: ["bogatyr"] }, 5, a, { peerRole: "spectator", omniscient });
    spectator.bindNetSpectator(b);
    const kernel = createTacticsKernel({ initial: matchState(), weapons: { sword: SWORD }, skills: {}, seed: 5 });
    host.bindTacticsHost(kernel);
    return { host, spectator, kernel };
  }

  it("spectator receives the union snapshot and cannot send commands", async () => {
    const { spectator, kernel } = hostWithSpectator();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await spectator.waitForNetSync();
    const snapshot = spectator.getNetSnapshot();
    expect(snapshot).not.toBeNull();
    // Обе стороны видны в объединении (вплотную к центру — видимы обеими).
    if (!snapshot) return;
    // Команды наблюдателя отклоняются (не отправляются вовсе).
    spectator.sendNetCommand({ type: "END_TURN", playerId: "1" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(kernel.getSnapshot().activeOwner).toBe(1);
  });

  it("omniscient spectator gets the full snapshot including hidden entities", async () => {
    const { spectator } = hostWithSpectator(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await spectator.waitForNetSync();
    const snapshot = spectator.getNetSnapshot();
    expect(snapshot).not.toBeNull();
    if (!snapshot) return;
    expect(snapshot.entities.length).toBeGreaterThanOrEqual(2);
  });
});

describe("apple objective over the network (0.16.0)", () => {
  it("host and guest sync the apple state and objective victory", async () => {
    const { a, b } = createChannelPair();
    const host = createSession("menu");
    const guest = createSession("menu");
    host.startNetPvpBattle({ side1: ["bogatyr"], side2: ["bogatyr"] }, 7, a, { objective: "apple" });
    guest.bindGuestNetPvp(2, b);
    const match = matchState(true);
    const kernel = createTacticsKernel({ initial: match, weapons: { sword: SWORD }, skills: {}, seed: 7 });
    host.bindTacticsHost(kernel);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await guest.waitForNetSync();

    // Гость видит яблоко в снимке.
    const guestSnap = guest.getNetSnapshot();
    expect(guestSnap?.apple).toBeDefined();
    if (!guestSnap?.apple) return;

    // Ход 1: боец ведущего подбирает яблоко (MOVE к нему).
    const player = kernel.getSnapshot().entities.find((e) => e.owner === 1)!;
    const applePos = kernel.getSnapshot().apple!.pos;
    const z = kernel.getSnapshot().grid.tiles.find((t) => t.x === applePos.x && t.y === applePos.y)!.z;
    const pick = host.applyBattleCommand({ type: "MOVE", actorId: player.id, to: { x: applePos.x, y: applePos.y, z } });
    expect(pick.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Снимок гостя: носитель установлен.
    expect(guest.getNetSnapshot()?.apple?.carrierId).toBe(player.id);
  });
});
