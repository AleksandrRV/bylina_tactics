export const CORE_VERSION = "0.5.0";

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
export {
  BOW,
  CLAWS,
  DEFAULT_TRAINING_UNITS,
  SLING,
  SWORD,
  TRAINING_BOGATYR_ID,
  TRAINING_COVER_ID,
  TRAINING_STRELETS_ID,
  TRAINING_UPYR_A_ID,
  TRAINING_UPYR_B_ID,
  TRAINING_UPYR_C_ID,
  TRAINING_ZNAHARKA_ID,
  createTrainingMatch,
  defaultTrainingWeapons,
  weaponStatsFromRecord,
} from "./training-map.js";
export type { SpawnUnitConfig } from "./training-map.js";
export { QUICK_MATCH_MAP, enemySpawns, generateBattlefield, playerSpawns } from "./mapgen.js";
export type { MapGenConfig, SpawnPoint } from "./mapgen.js";
export { createQuickMatch } from "./match.js";
export type { QuickMatchOptions } from "./match.js";
export { isCombatant, livingOf, matchOutcome } from "./outcome.js";
export type { MatchOutcome } from "./outcome.js";
export { pickEnemyCommand, runEnemyTurn } from "./ai.js";
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
