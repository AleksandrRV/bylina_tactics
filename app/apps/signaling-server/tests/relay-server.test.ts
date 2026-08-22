import { afterAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createRelayServer } from "../src/server.mjs";

/**
 * Проверки реального ретранслятора (0.19.2): сигналы допустимы только
 * в комнату, в которую участник вступил.
 */
let relay: Awaited<ReturnType<typeof createRelayServer>> | null = null;

async function connect(): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${relay!.port}`);
  await new Promise((resolve, reject) => {
    ws.on("open", () => resolve(undefined));
    ws.on("error", reject);
  });
  return ws;
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("signaling relay server (0.19.2)", () => {
  it("rejects a SIGNAL to a room the peer did not join", async () => {
    relay = await createRelayServer({ port: 0 });
    const outsider = await connect();
    const insider = await connect();
    outsider.send(JSON.stringify({ type: "JOIN", roomId: "room-a", name: "outsider", role: "guest" }));
    insider.send(JSON.stringify({ type: "JOIN", roomId: "room-b", name: "insider", role: "guest" }));
    await wait(50);

    const errorSeen = nextMessage(outsider, "ERROR");
    outsider.send(JSON.stringify({ type: "SIGNAL", roomId: "room-b", signal: { sdp: "sneaky" } }));
    const error = await errorSeen;
    expect(error.message).toBe("NOT_IN_ROOM");

    // Участник комнаты B не получил посторонний сигнал.
    let leaked = false;
    insider.on("message", (raw) => {
      const message = JSON.parse(String(raw)) as Record<string, unknown>;
      if (message.type === "SIGNAL") leaked = true;
    });
    await wait(80);
    expect(leaked).toBe(false);

    outsider.close();
    insider.close();
  });

  afterAll(() => {
    relay?.wss.close();
    relay?.server.close();
  });
});
