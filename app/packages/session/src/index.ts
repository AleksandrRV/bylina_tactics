export const APP_VERSION = "0.2.0";

export type AppScreen = "boot" | "menu" | "settings" | "field";

export type GameMode = "quickMatch" | "campaign" | "pvp";

export const MODE_OPENS_IN: Record<GameMode, string> = {
  quickMatch: "0.5.0",
  campaign: "0.10.0",
  pvp: "0.14.0",
};

export interface SessionState {
  screen: AppScreen;
  unavailableMode: GameMode | null;
}

export interface SessionApi {
  get(): SessionState;
  goTo(screen: AppScreen): void;
  openField(): void;
  openMode(mode: GameMode): void;
  dismissUnavailable(): void;
  subscribe(listener: (state: SessionState) => void): () => void;
}

export function createSession(initial: AppScreen = "boot"): SessionApi {
  let state: SessionState = { screen: initial, unavailableMode: null };
  const listeners = new Set<(state: SessionState) => void>();

  const emit = (next: SessionState): void => {
    state = next;
    for (const listener of listeners) listener(state);
  };

  return {
    get: () => state,
    goTo: (screen) => {
      emit({ screen, unavailableMode: null });
    },
    openField: () => {
      emit({ screen: "field", unavailableMode: null });
    },
    openMode: (mode) => {
      emit({ screen: "menu", unavailableMode: mode });
    },
    dismissUnavailable: () => {
      emit({ ...state, unavailableMode: null });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
