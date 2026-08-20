import { describe, expect, it } from "vitest";
import { CORE_VERSION } from "../src/index.js";

describe("package version", () => {
  it("is 0.3.0", () => {
    expect(CORE_VERSION).toBe("0.3.0");
  });
});
