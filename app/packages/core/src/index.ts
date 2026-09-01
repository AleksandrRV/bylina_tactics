export { CORE_VERSION, createTacticsKernel, isCaptive } from "./kernel.js";
export { APP_VERSION } from "./version.js";
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
export { createMissionMatch, createPvpMatch, createQuickMatch } from "./match.js";
export type { MissionMatchOptions, PvpMatchOptions, QuickMatchOptions, RosterMods, RosterSlot } from "./match.js";
export { isCombatant, livingOf, matchOutcome } from "./outcome.js";
export type { MatchOutcome } from "./outcome.js";
export { pickEnemyCommand, runEnemyTurn } from "./ai.js";
export {
  pickScriptedEnemyCommand,
  type ScriptedEnemyDecision,
  type TrainingEnemyAction,
  type TrainingEnemyCondition,
  type TrainingEnemyScript,
  type TrainingEnemyScriptState,
} from "./training-ai.js";
export {
  pickScriptedCommand,
  type PrologueScript,
  type PrologueScriptAction,
  type PrologueScriptState,
  type ScriptedDecision,
} from "./prologue-script.js";
export {
  evaluateMissionTriggers,
  createMissionScriptState,
  type MissionTrigger,
  type MissionScriptState,
} from "./mission-script.js";
export { compilePrologueLayout, createLayoutMatch } from "./prologue-layout.js";
export {
  cutsceneMatches,
  pickCutscene,
  withCutsceneDefaults,
  DEFAULT_CUTSCENE_ZOOM,
  type CutsceneConfig,
  type CutsceneEvent,
  type CutsceneStep,
  type CutsceneStepKind,
  type CutsceneTarget,
  type CutsceneTrigger,
  type CutsceneTriggerKind,
} from "./cutscene.js";
export type { PrologueLayout, CompiledLayout } from "./prologue-layout.js";
export { createPrologueMatch } from "./prologue-match.js";
export {
  createPrologueRunState,
  afterPrologueApply,
  gatePrologueCommand,
  clampPrologueCommand,
  revealPrologueExtract,
  tickPrologueEnemyTurn,
  tickProloguePlayerTurn,
  prologueHintView,
  dismissPrologueHint,
  shouldRestoreCheckpoint,
  takePrologueSpawnEvents,
} from "./prologue-run.js";
export type { PrologueRunState, PrologueRunContext } from "./prologue-run.js";
export {
  createReinforcementsState,
  tickReinforcements,
  noteEnemyKill,
  type ReinforcementsConfig,
  type ReinforcementsState,
} from "./reinforcements.js";
export {
  createHintsManagerState,
  enqueueHint,
  currentHint,
  dismissHint,
  allowedPanel,
  type HintRecord,
  type HintsManagerState,
} from "./hints-manager.js";
export { createTelemetryLog, recordTelemetry, skipCutsceneRate } from "./telemetry.js";
export type { TelemetryEvent, TelemetryLog } from "./telemetry.js";
export { distH, facingAfterStep, inBounds, makeGrid, tileAt } from "./grid.js";
export {
  DIAGONAL_SURCHARGE,
  canFinish,
  canTransit,
  diagonalEdgeCost,
  edgeCost,
  edgeCoverBetween,
  orthogonalEdgeCost,
} from "./occupancy.js";
export { apCostFor, findPath, listReachable } from "./pathfinding.js";
export {
  effectiveCoverTier,
  evaluateObstacles,
  hasLineOfSight,
  supercover,
  terrainCoverTier,
  traceRay,
} from "./los.js";
export type { IntersectionType, ObstacleResult, TracedCell } from "./los.js";
export { effectiveRange, heightRangeMod, inMeleeReach, inRangedReach } from "./range.js";
export { evaluateCover } from "./cover.js";
export { previewAttack, resolveAttack } from "./combat.js";
export type { AttackOptions, AttackResolution, HitPreview } from "./combat.js";
export { DEBUG_BOW, DEBUG_SWORD, defaultWeapons } from "./weapons.js";
export type { WeaponStats } from "./weapons.js";
export type { SkillEffect, SkillPreview, SkillStats, StatusId } from "./skills.js";
export { clampChance, createMulberry32 } from "./rng.js";
export { cellVisibility, computeVisibleCells, createFogState, refreshFog } from "./fog.js";
export type { CellVisibility, FogOfOwner, FogState } from "./fog.js";
export type {
  ApplyResult,
  CellPos,
  Command,
  EntityState,
  GameEvent,
  Grid,
  MatchState,
  MissionObjective,
  ReachableCell,
  RejectReason,
  Tile,
} from "./types.js";
export { eventsVisibleTo } from "./network-events.js";
