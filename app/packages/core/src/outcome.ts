import { ENEMY_OWNER, PLAYER_OWNER } from "./debug-map.js";
import type { EntityState, MatchState } from "./types.js";

export type MatchOutcome = "ongoing" | "victory" | "defeat";

export function isCombatant(entity: EntityState): boolean {
  return !entity.dead && entity.coverType === 0 && entity.owner !== 0;
}

export function livingOf(state: MatchState, owner: number): EntityState[] {
  return state.entities.filter((entity) => isCombatant(entity) && entity.owner === owner);
}

/** Успех — уничтожены все противники. Поражение — гибель всех бойцов игрока. */
export function matchOutcome(state: MatchState): MatchOutcome {
  if (livingOf(state, PLAYER_OWNER).length === 0) return "defeat";
  if (livingOf(state, ENEMY_OWNER).length === 0) return "victory";
  return "ongoing";
}
