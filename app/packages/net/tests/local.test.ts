import { describe, expect, it } from "vitest";
import { createLocalTransport } from "../src/index.js";

describe("createLocalTransport", () => {
  it("delivers a message to a subscriber", async () => {
    const transport = createLocalTransport();
    const seen: unknown[] = [];
    transport.subscribe((message) => {
      seen.push(message.payload);
    });
    transport.send({ type: "COMMAND", senderId: "p", timestamp: 1, payload: { type: "END_TURN" } });
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual([{ type: "END_TURN" }]);
  });
});
