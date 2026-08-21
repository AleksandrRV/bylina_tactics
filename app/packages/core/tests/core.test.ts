import { describe, expect, it } from "vitest";
import { CORE_VERSION } from "../src/index.js";

describe("package version", () => {
  it("is 0.7.0", () => {
    expect(CORE_VERSION).toBe("0.7.0");
  });
});
