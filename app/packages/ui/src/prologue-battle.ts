import {
  afterPrologueApply,
  compilePrologueLayout,
  createPrologueMatch,
  createPrologueRunState,
  gatePrologueCommand,
  shouldRestoreCheckpoint,
  tickPrologueEnemyTurn,
  tickProloguePlayerTurn,
  createTelemetryLog,
  recordTelemetry,
  type TelemetryLog,
  type PrologueRunContext,
  type PrologueRunState,
  type SpawnUnitConfig,
  type TacticsKernel,
  type Command,
  type GameEvent,
} from "@bylina/core";
import type { ContentBundle, PrologueMissionConfig } from "@bylina/content";

export function prologueUnits(content: ContentBundle): SpawnUnitConfig[] {
  return [...content.units, ...content.prologueBestiary.units] as SpawnUnitConfig[];
}

export function buildPrologueContext(
  mission: PrologueMissionConfig,
  content: ContentBundle,
  showHints: boolean,
): PrologueRunContext {
  const layout = mission.map.layout ? compilePrologueLayout(mission.map.layout) : null;
  const rat = layout?.markers.F?.[0];
  const profileName = mission.reinforcements;
  const profile = profileName
    ? content.reinforcements.profiles?.[profileName] ?? content.reinforcements.default
    : undefined;
  return {
    missionId: mission.id,
    script: mission.script,
    hints: content.prologueHints.hints,
    showHints,
    reinforcements: profile,
    ratMarker: rat,
    fedotWaveSpawns: layout?.markers.F?.slice(1),
    waveCells: layout?.markers.S,
    allyCell: layout?.markers.A?.[0],
    healerCell: layout?.markers.z?.[0],
  };
}

export function initPrologueMatch(mission: PrologueMissionConfig, content: ContentBundle, seed: number) {
  if (!mission.map.layout) throw new Error(`Prologue mission ${mission.id} has no layout`);
  return createPrologueMatch({
    layout: mission.map.layout,
    units: prologueUnits(content),
    seed,
    hideExtract: mission.id === "prologue_cry",
  });
}

export {
  createPrologueRunState,
  afterPrologueApply,
  gatePrologueCommand,
  tickPrologueEnemyTurn,
  tickProloguePlayerTurn,
  shouldRestoreCheckpoint,
  createTelemetryLog,
  recordTelemetry,
};
export type { PrologueRunState, PrologueRunContext, TacticsKernel, Command, GameEvent, TelemetryLog };
