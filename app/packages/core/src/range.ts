import { distH } from "./grid.js";

/** Документ математики, §3. */
export function heightRangeMod(zFrom: number, zTo: number): -1 | 0 | 1 {
  if (zFrom > zTo) return 1;
  if (zFrom < zTo) return -1;
  return 0;
}

export function effectiveRange(zFrom: number, zTo: number, base: number): number {
  return Math.max(0, base + heightRangeMod(zFrom, zTo));
}

export function inRangedReach(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  base: number,
): boolean {
  return distH(ax, ay, bx, by) <= effectiveRange(az, bz, base);
}

export function inMeleeReach(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): boolean {
  return distH(ax, ay, bx, by) <= 1 && Math.abs(az - bz) <= 1;
}
