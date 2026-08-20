export const CORE_VERSION = "0.3.0";

export { createTacticsKernel } from "./kernel.js";
export type { KernelOptions, TacticsKernel } from "./kernel.js";
export {
  createDebugMatch,
  DEBUG_ALLY_ID,
  DEBUG_COVER_ID,
  DEBUG_ENEMY_ID,
  DEBUG_PLAYER_ID,
  ENEMY_OWNER,
  PLAYER_OWNER,
} from "./debug-map.js";
export { distH, facingAfterStep, inBounds, makeGrid, tileAt } from "./grid.js";
export { canFinish, canTransit, edgeCost } from "./occupancy.js";
export { apCostFor, findPath, listReachable } from "./pathfinding.js";
export { hasLineOfSight, supercover } from "./los.js";
export { effectiveRange, heightRangeMod, inMeleeReach, inRangedReach } from "./range.js";
export { evaluateCover } from "./cover.js";
export { previewAttack, resolveAttack } from "./combat.js";
export type { AttackResolution, HitPreview } from "./combat.js";
export { DEBUG_BOW, DEBUG_SWORD, defaultWeapons } from "./weapons.js";
export type { WeaponStats } from "./weapons.js";
export { clampChance, createMulberry32 } from "./rng.js";
export type {
  ApplyResult,
  CellPos,
  Command,
  EntityState,
  GameEvent,
  Grid,
  MatchState,
  ReachableCell,
  RejectReason,
  Tile,
} from "./types.js";
