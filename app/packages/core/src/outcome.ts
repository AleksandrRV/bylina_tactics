import { ENEMY_OWNER, PLAYER_OWNER } from "./debug-map.js";
import type { EntityState, MatchState } from "./types.js";

export type MatchOutcome = "ongoing" | "victory" | "defeat";

export function isCombatant(entity: EntityState): boolean {
  return !entity.dead && entity.coverType === 0 && entity.owner !== 0;
}

export function livingOf(state: MatchState, owner: number): EntityState[] {
  return state.entities.filter((entity) => isCombatant(entity) && entity.owner === owner);
}

function eliminationLivingOf(state: MatchState, owner: number): EntityState[] {
  return livingOf(state, owner).filter((entity) => entity.countsForElimination !== false);
}

/** Успех — уничтожены все противники. Поражение — гибель всех основных бойцов игрока; временные призывы не заменяют дружину. */
export function matchOutcome(state: MatchState): MatchOutcome {
  if (eliminationLivingOf(state, PLAYER_OWNER).length === 0) return "defeat";
  if (eliminationLivingOf(state, ENEMY_OWNER).length === 0) return "victory";
  return "ongoing";
}
