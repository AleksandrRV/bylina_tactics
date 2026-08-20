export const CORE_VERSION = "0.2.0";

export { createTacticsKernel } from "./kernel.js";
export type { TacticsKernel } from "./kernel.js";
export { createDebugMatch, DEBUG_ALLY_ID, DEBUG_COVER_ID, DEBUG_PLAYER_ID, PLAYER_OWNER } from "./debug-map.js";
export { distH, facingAfterStep, inBounds, makeGrid, tileAt } from "./grid.js";
export { canFinish, canTransit, edgeCost } from "./occupancy.js";
export { apCostFor, findPath, listReachable } from "./pathfinding.js";
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
