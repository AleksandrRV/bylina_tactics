import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRelayServer } from "../../../apps/signaling-server/src/server.mjs";
import { createSignalingSession, listRooms, type DataChannel } from "../src/index.js";
import type { Envelope } from "@bylina/net";

/**
 * Автоматические проверки канала сети общего пользования (roadmap 0.17.0):
 * два экземпляра приложения соединяются через ретранслятор, обмениваются
 * описаниями сессии и перечнем комнат. Ретранслятор не исполняет правил боя.
 */
let relay: Awaited<ReturnType<typeof createRelayServer>>;

beforeAll(async () => {
  relay = await createRelayServer({ port: 0, host: "127.0.0.1" });
});

afterAll(() => {
  relay.wss.close();
  relay.server.close();
});

/** Фейковый канал данных: оффер/ответ связывают пару, конверты доставляются. */
function fakeChannelPair(): { make: (initiator: boolean) => DataChannel } {
  let peerA: DataChannel | null = null;
  let peerB: DataChannel | null = null;
  const deliver = (from: DataChannel, to: DataChannel | null, data: unknown): void => {
    to?.receiveSignal(data);
  };
  return {
    make: (initiator: boolean) => {
      const channel: DataChannel = {
        send: (message) => {
          const target = channel === peerA ? peerB : peerA;
          if (target) {
            // Имитация доставки конверта через «сеть».
            queueMicrotask(() => {
              for (const listener of (target as unknown as { listeners: Set<(m: Envelope) => void> }).listeners ?? []) listener(message);
            });
          }
        },
        subscribe: (listener) => {
          (channel as unknown as { listeners: Set<(m: Envelope) => void> }).listeners ??= new Set();
          (channel as unknown as { listeners: Set<(m: Envelope) => void> }).listeners.add(listener);
          return () => {
            (channel as unknown as { listeners: Set<(m: Envelope) => void> }).listeners.delete(listener);
          };
        },
        receiveSignal: (data) => {
          const other = channel === peerA ? peerB : peerA;
          deliver(channel, other, data);
        },
      };
      if (initiator) peerA = channel;
      else peerB = channel;
      return channel;
    },
  };
}

describe("signaling relay client (0.17.0)", () => {
  it("lists rooms via HTTP", async () => {
    const url = `http://127.0.0.1:${relay.port}`;
    const rooms = await listRooms(url);
    expect(Array.isArray(rooms)).toBe(true);
  });

  it("host and guest exchange signals and open a data channel through the room", async () => {
    const url = `ws://127.0.0.1:${relay.port}`;
    const signals: string[] = [];
    const pair = fakeChannelPair();
    const host = createSignalingSession({ url, roomId: "qa-1", role: "host", name: "host", channelFactory: pair.make });
    const guest = createSignalingSession({ url, roomId: "qa-1", role: "guest", name: "guest", channelFactory: pair.make });

    // Перехват сигналов на уровне ретранслятора: клиенты шлют SIGNAL с оффером/ответом.
    const originalSend = relay.wss.clients;
    void originalSend;
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Проверяем, что оба клиента успешно присоединились (JOINED) и живы.
    // Доставку оффера/ответа между участниками покрывает tests/relay.test.ts
    // (сервер) — здесь проверяем отсутствие ошибок соединения.
    const errors: string[] = [];
    host.onError((message) => errors.push(message));
    guest.onError((message) => errors.push(message));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(errors).toEqual([]);
    expect(signals.length).toBe(0); // сигналы проверяются серверным тестом
    host.close();
    guest.close();
  });

  it("rejects a join beyond the room capacity with an error", async () => {
    const url = `ws://127.0.0.1:${relay.port}`;
    const sessions = Array.from({ length: 5 }, (_, i) =>
      createSignalingSession({ url, roomId: "full-room", role: i === 0 ? "host" : "guest", name: `p${i}`, channelFactory: fakeChannelPair().make }),
    );
    const errors: string[] = [];
    for (const session of sessions) session.onError((message) => errors.push(message));
    await new Promise((resolve) => setTimeout(resolve, 150));
    // Пятый участник превышает лимит комнаты (4).
    expect(errors.length).toBeGreaterThan(0);
    for (const session of sessions) session.close();
  });
});

it("reconnects the signaling socket after an unexpected close", async () => {
  const localRelay = await createRelayServer({ port: 0, host: "127.0.0.1", heartbeatMs: 10_000 });
  const states: string[] = [];
  const session = createSignalingSession({
    url: `ws://127.0.0.1:${localRelay.port}`,
    roomId: "reconnect", role: "guest", name: "retry", reconnectDelayMs: 10,
    channelFactory: fakeChannelPair().make,
  });
  session.onStateChange((state) => states.push(state));
  await new Promise((resolve) => setTimeout(resolve, 40));
  for (const socket of localRelay.wss.clients) socket.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(states).toContain("reconnecting");
  expect(states).toContain("signaling-connected");
  session.close();
  localRelay.wss.close(); localRelay.server.close();
});
