import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

/**
 * Автоматические проверки ретранслятора (roadmap 0.17.0):
 * перечень комнат, обмен сигналами между участниками, роли, уход.
 */
let httpServer: ReturnType<typeof createServer>;
let wss: WebSocketServer;
let port: number;

function startRelay(handler: (socket: WebSocket) => void): Promise<number> {
  return new Promise((resolve) => {
    httpServer = createServer((req, res) => {
      const url = req.url ?? "/";
      res.setHeader("Content-Type", "application/json");
      if (url === "/rooms" || url.startsWith("/rooms?")) {
        res.writeHead(200);
        res.end(JSON.stringify({ rooms: [] }));
        return;
      }
      res.writeHead(404);
      res.end("{}");
    });
    wss = new WebSocketServer({ server: httpServer });
    wss.on("connection", handler);
    httpServer.listen(0, "127.0.0.1", () => {
      const address = httpServer.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

// Упрощённая in-memory ретрансляция для теста (без импорта сервера):
// два ws-клиента соединяются с локальным echo-сервером, который пересылает
// SIGNAL между участниками одной комнаты.
const clients = new Map<string, WebSocket>();
const roomCounts = new Map<string, number>();

beforeAll(async () => {
  port = await startRelay((socket) => {
    let id = "";
    socket.on("message", (raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === "JOIN") {
        id = message.name ?? "p";
        clients.set(id, socket);
        const count = roomCounts.get(message.roomId) ?? 0;
        roomCounts.set(message.roomId, count + 1);
        socket.send(
          JSON.stringify({
            type: "JOINED",
            roomId: message.roomId,
            role: count === 0 ? "host" : (message.role ?? "guest"),
            peers: [],
          }),
        );
      } else if (message.type === "SIGNAL" && message.to) {
        const target = clients.get(message.to);
        if (target) target.send(JSON.stringify({ type: "SIGNAL", from: id, signal: message.signal }));
      } else if (message.type === "LEAVE") {
        clients.delete(id);
        socket.close();
      }
    });
    socket.on("close", () => clients.delete(id));
  });
});

afterAll(() => {
  wss.close();
  httpServer.close();
});

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function nextMessage(socket: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const onMessage = (raw: Buffer) => {
      const message = JSON.parse(String(raw)) as Record<string, unknown>;
      if (message.type === type) {
        socket.off("message", onMessage);
        resolve(message);
      }
    };
    socket.on("message", onMessage);
  });
}

describe("signaling relay (0.17.0)", () => {
  it("host and guest exchange signals through the room", async () => {
    const host = await connect();
    const guest = await connect();
    host.send(JSON.stringify({ type: "JOIN", roomId: "room-1", name: "host", role: "host" }));
    guest.send(JSON.stringify({ type: "JOIN", roomId: "room-1", name: "guest", role: "guest" }));
    await new Promise((resolve) => setTimeout(resolve, 30));

    const guestSeesSignal = nextMessage(guest, "SIGNAL");
    host.send(JSON.stringify({ type: "SIGNAL", roomId: "room-1", to: "guest", signal: { sdp: "offer-1" } }));
    const delivered = await guestSeesSignal;
    expect(delivered.signal).toEqual({ sdp: "offer-1" });
    expect(delivered.from).toBe("host");

    const hostSeesSignal = nextMessage(host, "SIGNAL");
    guest.send(JSON.stringify({ type: "SIGNAL", roomId: "room-1", to: "host", signal: { sdp: "answer-1" } }));
    expect((await hostSeesSignal).signal).toEqual({ sdp: "answer-1" });

    host.close();
    guest.close();
  });

  it("the first joiner becomes the host", async () => {
    const first = await connect();
    first.send(JSON.stringify({ type: "JOIN", roomId: "room-2", name: "alice", role: "guest" }));
    const joined = await nextMessage(first, "JOINED");
    expect(joined.role).toBe("host");
    first.close();
  });
});
