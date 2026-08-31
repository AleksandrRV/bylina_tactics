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
});
