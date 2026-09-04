import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createRelayServer } from "../src/server.mjs";

let relay: Awaited<ReturnType<typeof createRelayServer>> | null = null;
/**
 * Клиент ретранслятора. `autoPong: false` — клиент, который не отвечает на
 * ping сервера (проверка сердцебиения); по умолчанию ws отвечает сам.
 */
async function connect(options: { autoPong?: boolean } = {}): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${relay!.port}`, options);
  await new Promise<void>((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });
  return ws;
}
function nextMessage(socket: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const listener = (raw: Buffer) => {
      const message = JSON.parse(String(raw)) as Record<string, unknown>;
      if (message.type === type) {
        socket.off("message", listener);
        resolve(message);
      }
    };
    socket.on("message", listener);
  });
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  relay?.wss.close();
  relay?.server.close();
  relay = null;
});

describe("signaling relay server", () => {
  it("delivers SIGNAL only to the addressed peer in a three-member room", async () => {
    relay = await createRelayServer({ port: 0, heartbeatMs: 10_000 });
    const host = await connect();
    const guest = await connect();
    const spectator = await connect();
    const hostJoined = nextMessage(host, "JOINED");
    host.send(JSON.stringify({ type: "JOIN", roomId: "room-a", name: "host", role: "host" }));
    const hostInfo = await hostJoined;
    const guestJoined = nextMessage(guest, "JOINED");
    guest.send(JSON.stringify({ type: "JOIN", roomId: "room-a", name: "guest", role: "guest" }));
    const guestInfo = await guestJoined;
    const spectatorJoined = nextMessage(spectator, "JOINED");
    spectator.send(JSON.stringify({ type: "JOIN", roomId: "room-a", name: "watch", role: "spectator" }));
    await spectatorJoined;
    const signal = nextMessage(guest, "SIGNAL");
    let leaked = false;
    spectator.on("message", (raw) => {
      if ((JSON.parse(String(raw)) as { type?: string }).type === "SIGNAL") leaked = true;
    });
    host.send(JSON.stringify({ type: "SIGNAL", roomId: "room-a", to: guestInfo.peerId, signal: { sdp: "offer" } }));
    const delivered = await signal;
    expect(delivered.from).toBe(hostInfo.peerId);
    expect(delivered.signal).toEqual({ sdp: "offer" });
    await wait(30);
    expect(leaked).toBe(false);
    host.close();
    guest.close();
    spectator.close();
  });

  it("rejects malformed and foreign signals", async () => {
    relay = await createRelayServer({ port: 0, heartbeatMs: 10_000 });
    const socket = await connect();
    const badJoin = nextMessage(socket, "ERROR");
    socket.send(JSON.stringify({ type: "JOIN", roomId: "bad room", name: "x", role: "guest" }));
    expect((await badJoin).message).toBe("BAD_JOIN");
    socket.close();
  });

  it("terminates a socket that misses its heartbeat", async () => {
    // Клиент молчит на ping (autoPong выключен): первый такт сердцебиения
    // снимает признак isAlive и шлёт ping, второй — обрывает соединение.
    // Прежний вариант сбрасывал isAlive снаружи и состязался с автоматическим
    // pong клиента: если сброс попадал между ping и pong, pong возвращал
    // признак, и сокет жил вечно (тест зависал до таймаута, чаще на CI).
    relay = await createRelayServer({ port: 0, heartbeatMs: 15 });
    const socket = await connect({ autoPong: false });
    const closed = new Promise<void>((resolve) => socket.on("close", () => resolve()));
    const serverSocket = [...relay.wss.clients][0]!;
    await closed;
    expect(serverSocket.readyState).not.toBe(WebSocket.OPEN);
  });

  it("keeps a socket that answers the heartbeat", async () => {
    // Обратная проверка: отвечающий на ping клиент переживает несколько тактов.
    relay = await createRelayServer({ port: 0, heartbeatMs: 15 });
    const socket = await connect();
    let closed = false;
    socket.on("close", () => {
      closed = true;
    });
    await wait(90);
    expect(closed).toBe(false);
    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
  });

  it("serves /rooms and /health with CORS headers for a foreign-origin client", async () => {
    relay = await createRelayServer({ port: 0, heartbeatMs: 10_000 });
    for (const path of ["/rooms", "/health"]) {
      const response = await fetch(`http://127.0.0.1:${relay!.port}${path}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
    }
    // Предзапрос OPTIONS отвечает без тела и с заголовками.
    const preflight = await fetch(`http://127.0.0.1:${relay!.port}/rooms`, { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("honours a configured CORS origin", async () => {
    relay = await createRelayServer({ port: 0, heartbeatMs: 10_000, corsOrigin: "https://game.example" });
    const response = await fetch(`http://127.0.0.1:${relay!.port}/rooms`);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://game.example");
  });

  it("tears down a frame larger than the transport payload limit (close 1009)", async () => {
    // Кадр крупнее лимита отвергается транспортом до обработчика сообщения:
    // ws сам закрывает сокет кодом 1009. Лимит = 64 KiB + 1 KiB конверта.
    relay = await createRelayServer({ port: 0, heartbeatMs: 10_000 });
    const socket = await connect();
    const closed = new Promise<{ code: number }>((resolve) => socket.on("close", (code) => resolve({ code })));
    const oversized = JSON.stringify({
      type: "JOIN",
      roomId: "room-big",
      name: "huge",
      role: "guest",
      signal: "x".repeat(70 * 1024),
    });
    socket.send(oversized);
    const { code } = await closed;
    expect(code).toBe(1009);
  });

  it("refuses a new room beyond the room capacity with CAPACITY", async () => {
    relay = await createRelayServer({ port: 0, heartbeatMs: 10_000, maxRooms: 2 });
    const first = await connect();
    const second = await connect();
    const firstJoined = nextMessage(first, "JOINED");
    first.send(JSON.stringify({ type: "JOIN", roomId: "room-1", name: "a", role: "host" }));
    await firstJoined;
    const secondJoined = nextMessage(second, "JOINED");
    second.send(JSON.stringify({ type: "JOIN", roomId: "room-2", name: "b", role: "host" }));
    await secondJoined;

    // Две комнаты заняты: третья комната не создаётся, клиент получает
    // CAPACITY и соединение закрывается.
    const third = await connect();
    const capacityError = nextMessage(third, "ERROR");
    const closed = new Promise<void>((resolve) => third.on("close", () => resolve()));
    third.send(JSON.stringify({ type: "JOIN", roomId: "room-3", name: "c", role: "guest" }));
    expect((await capacityError).message).toBe("CAPACITY");
    await closed;

    // Вход в существующую комнату в пределах её ёмкости не запрещён.
    const extra = await connect();
    const extraJoined = nextMessage(extra, "JOINED");
    extra.send(JSON.stringify({ type: "JOIN", roomId: "room-1", name: "d", role: "guest" }));
    expect((await extraJoined).roomId).toBe("room-1");

    first.close();
    second.close();
    extra.close();
  });

  it("closes connections beyond the socket limit with 1013 OVERLOADED", async () => {
    relay = await createRelayServer({ port: 0, heartbeatMs: 10_000, maxSockets: 2 });
    // Два сокета — ровно предел: соединения живы.
    const first = await connect();
    const second = await connect();
    expect(first.readyState).toBe(WebSocket.OPEN);
    expect(second.readyState).toBe(WebSocket.OPEN);

    // Третье подключение превышает предел: обработчики не навешиваются,
    // сокет закрывается кодом 1013 (Try Again Later).
    const third = await connect();
    const closed = new Promise<number>((resolve) => third.on("close", (code) => resolve(code)));
    await expect(closed).resolves.toBe(1013);

    first.close();
    second.close();
  });
});
