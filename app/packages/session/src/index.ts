import { matchOutcome } from "@bylina/core";
import type {
  ApplyResult,
  CellPos,
  Command,
  HitPreview,
  MatchState,
  ReachableCell,
  SkillPreview,
  TacticsKernel,
} from "@bylina/core";

export const APP_VERSION = "0.9.0";

export type AppScreen = "boot" | "menu" | "settings" | "battle" | "difficulty" | "result";

export type GameMode = "quickMatch" | "campaign" | "pvp";

export type BattleKind = "quick";

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
  openQuickMatch(): void;
  selectDifficulty(id: DifficultyId): void;
  finishMatch(outcome: MatchOutcome): void;
  playAgain(): void;
  openMode(mode: GameMode): void;
  dismissUnavailable(): void;
  setPaused(paused: boolean): void;
  /** Регистрирует единственное ведущее ядро текущего локального боя. */
  bindTacticsHost(host: TacticsKernel): void;
  /** Единственный путь изменения тактического состояния из интерфейса. */
  applyBattleCommand(command: Command): ApplyResult;
  getBattleSnapshot(owner: number): MatchState;
  getBattleReachable(actorId: number): ReachableCell[];
  getBattlePath(actorId: number, to: CellPos): { path: CellPos[]; mpCost: number; apCost: 1 | 2 } | null;
  getBattleHitPreview(actorId: number, targetId: number, weaponId?: string): HitPreview;
  getBattleSkillPreview(actorId: number, skillId: string, targetId?: number, targetPos?: CellPos): SkillPreview;
  getBattleVisible(owner: number): Set<string>;
  getBattleExplored(owner: number): Set<string>;
  getBattleOutcome(): "ongoing" | "victory" | "defeat";
  subscribeBattle(listener: () => void): () => void;
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
  let tacticsHost: TacticsKernel | null = null;
  const listeners = new Set<(state: SessionState) => void>();
  const requireTacticsHost = (): TacticsKernel => {
    if (!tacticsHost) throw new Error("Tactics host is not bound");
    return tacticsHost;
  };

  const emit = (next: SessionState): void => {
    state = next;
    for (const listener of listeners) listener(state);
  };

  return {
    get: () => state,
    goTo: (screen) => {
      emit({ screen, ...idle });
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
    bindTacticsHost: (host) => {
      tacticsHost = host;
    },
    applyBattleCommand: (command) => {
      if (!tacticsHost || state.screen !== "battle") return { ok: false, reason: "ILLEGAL" };
      return tacticsHost.apply(command);
    },
    getBattleSnapshot: (owner) => requireTacticsHost().getSnapshotFor(owner),
    getBattleReachable: (actorId) => requireTacticsHost().getReachable(actorId),
    getBattlePath: (actorId, to) => requireTacticsHost().getPath(actorId, to),
    getBattleHitPreview: (actorId, targetId, weaponId) => requireTacticsHost().getHitPreview(actorId, targetId, weaponId),
    getBattleSkillPreview: (actorId, skillId, targetId, targetPos) =>
      requireTacticsHost().getSkillPreview(actorId, skillId, targetId, targetPos),
    getBattleVisible: (owner) => requireTacticsHost().getVisibleCells(owner),
    getBattleExplored: (owner) => requireTacticsHost().getExploredCells(owner),
    getBattleOutcome: () => matchOutcome(requireTacticsHost().getSnapshot()),
    subscribeBattle: (listener) => requireTacticsHost().subscribe(listener),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
