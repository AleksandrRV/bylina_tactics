import { describe, expect, it } from "vitest";
import type { Tile } from "@bylina/core";
import { CELL_SIZE, RISE } from "../src/field/constants.js";
import { fogCoverHeight } from "../src/field/geometry.js";

function tile(x: number, y: number, z: number): Tile {
  return { x, y, z, pit: false, blockLOS: false };
}

describe("fog cover height", () => {
  it("covers the south riser of a higher cell, not only the face", () => {
    const ridge = tile(5, 1, 2);
    const shelf = tile(5, 2, 1);
    const valley = tile(5, 3, 1);
    expect(fogCoverHeight(ridge, [ridge, shelf, valley])).toBe(CELL_SIZE + RISE);
    expect(fogCoverHeight(shelf, [ridge, shelf, valley])).toBe(CELL_SIZE);
  });

  it("covers the map-edge drop when there is no southern neighbour", () => {
    const edge = tile(0, 7, 2);
    expect(fogCoverHeight(edge, [edge])).toBe(CELL_SIZE + 2 * RISE);
  });
});
