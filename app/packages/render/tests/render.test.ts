import { describe, expect, it } from "vitest";
import { RENDER_STATUS } from "../src/index.js";

describe("render package", () => {
  it("declares PixiJS as the field backend", () => {
    expect(RENDER_STATUS).toBe("pixi");
  });
});
