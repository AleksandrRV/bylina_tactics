import type { TrainingHintConfig } from "@bylina/content";
import { trainingManualTurnRecoveryAllowed } from "./training-progress.js";

/** Shared training-flow decisions; UI effects stay in BattleScreenView. */
export function useTrainingFlow(activeHint: TrainingHintConfig | null, units: readonly { ap: number }[]) {
  return { canRecoverTurn: trainingManualTurnRecoveryAllowed(activeHint, units) };
}
