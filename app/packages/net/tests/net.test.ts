import { describe, expect, it } from "vitest";
import {
  createChannelPair,
  createLocalTransport,
  decodeSessionCode,
  encodeSessionCode,
  createQrDataUrl,
} from "../src/index.js";
import type { Envelope } from "../src/index.js";

describe("session codec (0.15.0)", () => {
  it("round-trips a WebRTC signal description through the short string", () => {
    const signal = { type: "offer", sdp: "v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\ns=-\r\n" };
    const code = encodeSessionCode(signal);
    expect(code.length).toBeGreaterThan(0);
    expect(decodeSessionCode(code)).toEqual(signal);
  });

  it("rejects a broken code", () => {
    expect(() => decodeSessionCode("!!!not-a-code!!!")).toThrow();
  });

  it("generates a QR data URL for the session code", async () => {
    const code = encodeSessionCode({ type: "offer", sdp: "test" });
    const dataUrl = await createQrDataUrl(code);
    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });
});

describe("channel pair (two app instances)", () => {
  it("delivers messages only to the peer", async () => {
    const { a, b } = createChannelPair();
    const receivedA: Envelope[] = [];
    const receivedB: Envelope[] = [];
    a.subscribe((message) => receivedA.push(message));
    b.subscribe((message) => receivedB.push(message));

    a.send({ type: "PING", senderId: "a", timestamp: 1, payload: "hi" });
    b.send({ type: "PING", senderId: "b", timestamp: 2, payload: "yo" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(receivedA.map((message) => message.payload)).toEqual(["yo"]);
    expect(receivedB.map((message) => message.payload)).toEqual(["hi"]);
  });
});

describe("local transport", () => {
  it("broadcasts to all subscribers", async () => {
    const transport = createLocalTransport();
    const seen: string[] = [];
    transport.subscribe((message) => seen.push(String(message.payload)));
    transport.subscribe((message) => seen.push(String(message.payload)));
    transport.send({ type: "PING", senderId: "x", timestamp: 0, payload: "ok" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual(["ok", "ok"]);
  });
});

describe("runtime tactical payload validation", () => {
  it("accepts valid commands and rejects malformed commands", async () => {
    const { isCommandPayload, isEventBatchPayload, isSyncPayload } = await import("../src/index.js");
    expect(isCommandPayload({ type: "MOVE", actorId: 1, to: { x: 1, y: 2, z: 1 } })).toBe(true);
    expect(isCommandPayload({ type: "ATTACK", actorId: "1", targetId: 2, weaponId: "bow" })).toBe(false);
    expect(isEventBatchPayload([{ type: "ENTITY_MOVED" }])).toBe(true);
    expect(isEventBatchPayload({ type: "ENTITY_MOVED" })).toBe(false);
    expect(
      isSyncPayload({
        match: { turnNumber: 1, activeOwner: 1, grid: { tiles: [] }, entities: [] },
        visible: [],
        explored: [],
      }),
    ).toBe(true);
    expect(isSyncPayload({ match: {}, visible: [1], explored: [] })).toBe(false);
  });

  it("rejects a MOVE path longer than 256 steps (0.21.2, Major-2)", async () => {
    const { isCommandPayload } = await import("../src/index.js");
    const cell = (index: number) => ({ x: index, y: 0, z: 1 });
    // Маршрут в 256 шагов — на границе предела — принимается.
    expect(
      isCommandPayload({
        type: "MOVE",
        actorId: 1,
        to: cell(256),
        path: Array.from({ length: 256 }, (_, i) => cell(i)),
      }),
    ).toBe(true);
    // Маршрут в 257 шагов (а тем более на миллион, тот, что раньше
    // нагружал ведомого) отвергается.
    const longPath = Array.from({ length: 257 }, (_, i) => cell(i));
    expect(isCommandPayload({ type: "MOVE", actorId: 1, to: cell(257), path: longPath })).toBe(false);
    // Не-массив и путь с битой клеткой также отвергаются.
    expect(isCommandPayload({ type: "MOVE", actorId: 1, to: cell(0), path: "nope" })).toBe(false);
    expect(isCommandPayload({ type: "MOVE", actorId: 1, to: cell(0), path: [{ x: 1 }] })).toBe(false);
  });

  it("bounds the synchronization snapshot size (0.21.2, Minor-6)", async () => {
    const { isSyncPayload } = await import("../src/index.js");
    const cell = { x: 1, y: 1, z: 1 };
    const baseSync = (overrides: Record<string, unknown>) => ({
      match: { turnNumber: 1, activeOwner: 1, grid: { tiles: [cell] }, entities: [] },
      visible: [],
      explored: [],
      ...overrides,
    });
    // Слишком много сущностей.
    expect(
      isSyncPayload(
        baseSync({
          match: {
            turnNumber: 1,
            activeOwner: 1,
            grid: { tiles: [cell] },
            entities: Array.from({ length: 257 }, () => ({ id: 1 })),
          },
        }),
      ),
    ).toBe(false);
    // Слишком много клеток сетки.
    expect(
      isSyncPayload(
        baseSync({
          match: {
            turnNumber: 1,
            activeOwner: 1,
            grid: { tiles: Array.from({ length: 10_001 }, () => cell) },
            entities: [],
          },
        }),
      ),
    ).toBe(false);
    // Слишком длинные списки видимых клеток.
    expect(isSyncPayload(baseSync({ visible: Array.from({ length: 10_001 }, (_, i) => `${i},0`) }))).toBe(false);
    // Видимые клетки обязаны быть строками.
    expect(isSyncPayload(baseSync({ visible: [1, 2] }))).toBe(false);
    // Битая клетка сетки.
    expect(
      isSyncPayload(baseSync({ match: { turnNumber: 1, activeOwner: 1, grid: { tiles: [{ x: 0 }] }, entities: [] } })),
    ).toBe(false);
  });
});
