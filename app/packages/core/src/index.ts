export { CORE_VERSION, createTacticsKernel } from "./kernel.js";
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
  BRANCH,
  CLAWS,
  DEFAULT_TRAINING_UNITS,
  NEEDLE,
  SLING,
  SWORD,
  defaultTrainingWeapons,
  weaponStatsFromRecord,
} from "./defaults.js";
export type { SpawnUnitConfig } from "./defaults.js";
export { QUICK_MATCH_MAP, enemySpawns, generateBattlefield, playerSpawns } from "./mapgen.js";
export type { MapGenConfig, SpawnPoint } from "./mapgen.js";
export { createQuickMatch } from "./match.js";
export type { QuickMatchOptions } from "./match.js";
export { isCombatant, livingOf, matchOutcome } from "./outcome.js";
export type { MatchOutcome } from "./outcome.js";
export { pickEnemyCommand, runEnemyTurn } from "./ai.js";
export { distH, facingAfterStep, inBounds, makeGrid, tileAt } from "./grid.js";
export { canFinish, canTransit, edgeCost, edgeCoverBetween } from "./occupancy.js";
export { apCostFor, findPath, listReachable } from "./pathfinding.js";
export { effectiveCoverTier, evaluateObstacles, hasLineOfSight, supercover, terrainCoverTier, traceRay } from "./los.js";
export type { IntersectionType, ObstacleResult, TracedCell } from "./los.js";
export { effectiveRange, heightRangeMod, inMeleeReach, inRangedReach } from "./range.js";
export { evaluateCover } from "./cover.js";
export { previewAttack, resolveAttack } from "./combat.js";
export type { AttackOptions, AttackResolution, HitPreview } from "./combat.js";
export { DEBUG_BOW, DEBUG_SWORD, defaultWeapons } from "./weapons.js";
export type { WeaponStats } from "./weapons.js";
export type { SkillEffect, SkillPreview, SkillStats, StatusId } from "./skills.js";
export { clampChance, createMulberry32 } from "./rng.js";
export {
  cellVisibility,
  computeVisibleCells,
  createFogState,
  refreshFog,
} from "./fog.js";
export type { CellVisibility, FogOfOwner, FogState } from "./fog.js";
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
