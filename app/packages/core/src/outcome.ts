import { PLAYER_OWNER } from "./debug-map.js";
import type { EntityState, MatchState } from "./types.js";

export type MatchOutcome = "ongoing" | "victory" | "defeat";

export function isCombatant(entity: EntityState): boolean {
  return !entity.dead && entity.coverType === 0 && entity.owner !== 0;
}

export function livingOf(state: MatchState, owner: number): EntityState[] {
  return state.entities.filter((entity) => isCombatant(entity) && entity.owner === owner);
}

/** Успех — уничтожены все противники. Поражение — гибель всех основных бойцов игрока; временные призывы не заменяют дружину. */
export function matchOutcome(state: MatchState): MatchOutcome {
  const livingOwners = new Set(
    state.entities
      .filter((entity) => isCombatant(entity) && entity.countsForElimination !== false)
      .map((entity) => entity.owner),
  );
  if (!livingOwners.has(PLAYER_OWNER)) return "defeat";
  // Owner 1 is the player perspective; any other living owner is an opponent.
  return [...livingOwners].some((owner) => owner !== PLAYER_OWNER) ? "ongoing" : "victory";
}
