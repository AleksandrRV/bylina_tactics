import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createRelayServer } from "../src/server.mjs";

let relay: Awaited<ReturnType<typeof createRelayServer>> | null = null;
async function connect(): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${relay!.port}`);
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
    relay = await createRelayServer({ port: 0, heartbeatMs: 15 });
    const socket = await connect();
    const closed = new Promise<void>((resolve) => socket.on("close", () => resolve()));
    const serverSocket = [...relay.wss.clients][0] as WebSocket & { isAlive?: boolean };
    serverSocket.isAlive = false;
    await closed;
    expect(serverSocket.readyState).not.toBe(WebSocket.OPEN);
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
});
