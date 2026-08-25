import { describe, expect, it } from "vitest";
import { BIOME_PALETTES, RENDER_COLORS, RENDER_CSS_VARIABLES, RENDER_STATUS } from "../src/index.js";

describe("render package", () => {
  it("declares PixiJS as the field backend", () => {
    expect(RENDER_STATUS).toBe("pixi");
  });

  it("publishes one semantic palette for PixiJS and CSS", () => {
    expect(RENDER_COLORS.targeting.ready).toBe(RENDER_COLORS.ui.amber);
    expect(RENDER_COLORS.targeting.blocked).toBe(RENDER_COLORS.ui.danger);
    expect(RENDER_CSS_VARIABLES["--amber"]).toBe("#e0b34a");
    expect(RENDER_CSS_VARIABLES["--mist-dim"]).toBe("#b8b3a5");
  });

  it("publishes four deterministic biome palettes with three shades per tier", () => {
    expect(Object.keys(BIOME_PALETTES).sort()).toEqual(["meadow", "scorched", "swamp", "thicket"]);
    for (const palette of Object.values(BIOME_PALETTES)) {
      expect(palette.face).toHaveLength(3);
      expect(palette.face.every((tier) => tier.length === 3)).toBe(true);
      expect(palette.riser).toHaveLength(3);
    }
  });
});
