export const APP_VERSION = "0.5.0";

export type AppScreen = "boot" | "menu" | "settings" | "field" | "battle" | "difficulty" | "result";

export type GameMode = "quickMatch" | "campaign" | "pvp";

export type BattleKind = "training" | "quick";

export type DifficultyId = "easy" | "normal" | "hard";

export type MatchOutcome = "victory" | "defeat";

export const MODE_OPENS_IN: Record<GameMode, string> = {
  quickMatch: "0.5.0",
  campaign: "0.10.0",
  pvp: "0.14.0",
};

export interface SessionState {
  screen: AppScreen;
  unavailableMode: GameMode | null;
  paused: boolean;
  battleKind: BattleKind | null;
  difficulty: DifficultyId | null;
  matchSeed: number;
  outcome: MatchOutcome | null;
}

export interface SessionApi {
  get(): SessionState;
  goTo(screen: AppScreen): void;
  openField(): void;
  openBattle(): void;
  openQuickMatch(): void;
  selectDifficulty(id: DifficultyId): void;
  finishMatch(outcome: MatchOutcome): void;
  playAgain(): void;
  openMode(mode: GameMode): void;
  dismissUnavailable(): void;
  setPaused(paused: boolean): void;
  subscribe(listener: (state: SessionState) => void): () => void;
}

const idle: Omit<SessionState, "screen"> = {
  unavailableMode: null,
  paused: false,
  battleKind: null,
  difficulty: null,
  matchSeed: 0,
  outcome: null,
};

export function createSession(initial: AppScreen = "boot"): SessionApi {
  let state: SessionState = { screen: initial, ...idle };
  const listeners = new Set<(state: SessionState) => void>();

  const emit = (next: SessionState): void => {
    state = next;
    for (const listener of listeners) listener(state);
  };

  return {
    get: () => state,
    goTo: (screen) => {
      emit({ screen, ...idle });
    },
    openField: () => {
      emit({ screen: "field", ...idle });
    },
    openBattle: () => {
      emit({ ...idle, screen: "battle", battleKind: "training" });
    },
    openQuickMatch: () => {
      emit({ ...idle, screen: "difficulty" });
    },
    selectDifficulty: (id) => {
      emit({
        ...idle,
        screen: "battle",
        battleKind: "quick",
        difficulty: id,
        matchSeed: Date.now() >>> 0,
      });
    },
    finishMatch: (outcome) => {
      emit({ ...state, screen: "result", paused: false, outcome });
    },
    playAgain: () => {
      emit({ ...idle, screen: "difficulty" });
    },
    openMode: (mode) => {
      if (mode === "quickMatch") {
        emit({ ...idle, screen: "difficulty" });
        return;
      }
      emit({ screen: "menu", ...idle, unavailableMode: mode });
    },
    dismissUnavailable: () => {
      emit({ ...state, unavailableMode: null });
    },
    setPaused: (paused) => {
      if (state.screen !== "battle") return;
      emit({ ...state, paused });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
