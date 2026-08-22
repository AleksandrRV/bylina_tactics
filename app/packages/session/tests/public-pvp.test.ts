import { describe, expect, it } from "vitest";
import { createRelayServer } from "../../../apps/signaling-server/src/server.mjs";
import { createSignalingSession } from "@bylina/signaling";
import { createTacticsKernel, type MatchState, type WeaponStats } from "@bylina/core";
import { createSession } from "../src/index.js";

const SWORD: WeaponStats = { id: "sword", category: "melee", apCost: 1, endsTurn: true, range: 1, requiresLOS: false, aimMod: 0, minDmg: 20, maxDmg: 20, crit: 0, critBonus: 0, envDmg: 0 };

function matchState(): MatchState {
  return {
    turnNumber: 1,
    activeOwner: 1,
    grid: { width: 8, height: 6, tiles: Array.from({ length: 48 }, (_, i) => ({ x: i % 8, y: Math.floor(i / 8), z: 1, pit: false, blockLOS: false })) },
    entities: [
      { id: 1, configId: "bogatyr", owner: 1, x: 3, y: 2, z: 1, dir: 1, ap: 2, maxAp: 2, mobility: 5, hp: 12, maxHp: 12, aim: 100, defense: 0, will: 40, vision: 12, weaponId: "sword", weaponIds: ["sword"], skillIds: [], obstacle: true, dead: false, flying: false, coverType: 0, overwatch: false, defending: false, movementSpent: 0 },
      { id: 11, configId: "bogatyr", owner: 2, x: 4, y: 2, z: 1, dir: 3, ap: 2, maxAp: 2, mobility: 5, hp: 12, maxHp: 12, aim: 100, defense: 0, will: 40, vision: 12, weaponId: "sword", weaponIds: ["sword"], skillIds: [], obstacle: true, dead: false, flying: false, coverType: 0, overwatch: false, defending: false, movementSpent: 0 },
    ],
  };
}

/** Фейковый канал данных вместо WebRTC (в браузере — реальный WebRTC). */
function fakeChannelFactory(): (initiator: boolean) => import("@bylina/signaling").DataChannel {
  let hostChannel: import("@bylina/signaling").DataChannel | null = null;
  let guestChannel: import("@bylina/signaling").DataChannel | null = null;
  return (initiator: boolean) => {
    const channel: import("@bylina/signaling").DataChannel = {
      send: (message: import("@bylina/net").Envelope) => {
        const target = channel === hostChannel ? guestChannel : hostChannel;
        if (target) {
          queueMicrotask(() => {
            const listeners = (target as unknown as { listeners: Set<(m: import("@bylina/net").Envelope) => void> }).listeners;
            for (const listener of listeners ?? []) listener(message);
          });
        }
      },
      subscribe: (listener: (message: import("@bylina/net").Envelope) => void) => {
        const bucket = channel as unknown as { listeners: Set<(m: import("@bylina/net").Envelope) => void> };
        bucket.listeners ??= new Set();
        bucket.listeners.add(listener);
        return () => {
          bucket.listeners.delete(listener);
        };
      },
      receiveSignal: (data: unknown) => {
        const target = channel === hostChannel ? guestChannel : hostChannel;
        target?.receiveSignal(data);
      },
    };
    if (initiator) hostChannel = channel;
    else guestChannel = channel;
    return channel;
  };
}

describe("public network pvp over the relay (0.17.0)", () => {
  it("host and guest connect through the relay and exchange commands", async () => {
    const relay = await createRelayServer({ port: 0, host: "127.0.0.1" });
    try {
      const wsUrl = `ws://127.0.0.1:${relay.port}`;
      const factory = fakeChannelFactory();
      const hostSession = createSignalingSession({ url: wsUrl, roomId: "pub-1", role: "host", name: "host", channelFactory: factory });
      const guestSession = createSignalingSession({ url: wsUrl, roomId: "pub-1", role: "guest", name: "guest", channelFactory: factory });

      const host = createSession("menu");
      const guest = createSession("menu");
      // Ведущий создаёт партию с транспортом ретранслятора.
      host.startNetPvpBattle({ side1: ["bogatyr"], side2: ["bogatyr"] }, 42, hostSession.transport);
      guest.bindGuestNetPvp(2, guestSession.transport);
      const kernel = createTacticsKernel({ initial: matchState(), weapons: { sword: SWORD }, skills: {}, seed: 42 });
      host.bindTacticsHost(kernel);
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Гость получает снимок через канал данных, поднятый поверх ретранслятора.
      await guest.waitForNetSync();
      expect(guest.getNetSnapshot()).not.toBeNull();

      // Ход ведущего: атака вплотную убивает бойца гостя; исход доходит гостю.
      const ended: unknown[] = [];
      guest.subscribePvpEvents((events) => {
        if (events.some((event) => event.type === "MATCH_ENDED")) ended.push(true);
      });
      host.applyBattleCommand({ type: "ATTACK", actorId: 1, targetId: 11, weaponId: "sword" });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(ended.length).toBeGreaterThan(0);

      hostSession.close();
      guestSession.close();
    } finally {
      relay.wss.close();
      relay.server.close();
    }
  });
});
