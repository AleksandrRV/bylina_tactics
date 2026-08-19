import { describe, expect, it } from "vitest";
import { CORE_VERSION, createTacticsKernel } from "../src/index.js";

describe("createTacticsKernel", () => {
  it("reports the package version and stays free of browser globals", () => {
    const kernel = createTacticsKernel();
    expect(kernel.version).toBe(CORE_VERSION);
    expect(kernel.version).toBe("0.1.0");
    expect(typeof globalThis.document).toBe("undefined");
  });
});
