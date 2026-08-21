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
import type { CampaignApi, MissionOutcome, MissionParticipant } from "@bylina/campaign";

export const APP_VERSION = "0.11.0";

export type AppScreen =
  | "boot"
  | "menu"
  | "settings"
  | "battle"
  | "difficulty"
  | "result"
  | "campaign"
  | "missionResult"
  | "deployment";

export type GameMode = "quickMatch" | "campaign" | "pvp";

export type BattleKind = "quick" | "campaign";

export type DifficultyId = "easy" | "normal" | "hard";

export type MatchOutcome = "victory" | "defeat";

export const MODE_OPENS_IN: Record<GameMode, string> = {
  quickMatch: "0.5.0",
  campaign: "0.10.0",
  pvp: "0.14.0",
};

export interface CampaignFinishInfo {
  darknessGained: number;
  campaignLost: boolean;
  fallen: string[];
  wounded: string[];
  leveledUp: string[];
  newRecruit: string | null;
}

export interface SessionState {
  screen: AppScreen;
  unavailableMode: GameMode | null;
  paused: boolean;
  battleKind: BattleKind | null;
  difficulty: DifficultyId | null;
  /** Идентификатор активной миссии кампании. */
  activeMissionId: string | null;
  /** Состав высадки: идентификаторы бойцов дружины. */
  deployment: number[];
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
  /** Регистрирует единственный автомат кампании локальной партии. */
  bindCampaign(campaign: CampaignApi): void;
  /** Открыть карту корабля (ветка «Новая былина»). */
  openCampaign(): void;
  /** Начать доступную миссию и открыть формирование высадки. */
  startCampaignMission(missionId: string): boolean;
  /** Подтвердить высадку (от 1 до 5 живых бойцов) и перейти в сражение. */
  confirmDeployment(fighterIds: number[]): boolean;
  /** Завершить активную миссию исходом и исходом участников высадки. */
  finishCampaignMission(outcome: MissionOutcome, participants: MissionParticipant[]): CampaignFinishInfo | null;
  /** Покинуть начатую миссию без последствий и вернуться на карту. */
  leaveCampaignMission(): void;
  /** Вернуться на карту корабля с экрана итога миссии. */
  backToCampaign(): void;
  getCampaign(): CampaignApi;
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
  activeMissionId: null,
  deployment: [],
  matchSeed: 0,
  outcome: null,
};

export function createSession(initial: AppScreen = "boot"): SessionApi {
  let state: SessionState = { screen: initial, ...idle };
  let tacticsHost: TacticsKernel | null = null;
  let campaign: CampaignApi | null = null;
  const listeners = new Set<(state: SessionState) => void>();
  const requireTacticsHost = (): TacticsKernel => {
    if (!tacticsHost) throw new Error("Tactics host is not bound");
    return tacticsHost;
  };
  const requireCampaign = (): CampaignApi => {
    if (!campaign) throw new Error("Campaign automaton is not bound");
    return campaign;
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
      if (mode === "campaign") {
        emit({ ...idle, screen: "campaign" });
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
    bindCampaign: (automaton) => {
      campaign = automaton;
    },
    openCampaign: () => {
      emit({ ...idle, screen: "campaign" });
    },
    startCampaignMission: (missionId) => {
      const ok = requireCampaign().startMission(missionId);
      if (!ok) return false;
      emit({
        ...idle,
        screen: "deployment",
        battleKind: "campaign",
        activeMissionId: missionId,
        matchSeed: Date.now() >>> 0,
      });
      return true;
    },
    confirmDeployment: (fighterIds) => {
      if (state.screen !== "deployment" || state.activeMissionId === null) return false;
      const fighters = requireCampaign().getState().fighters;
      const alive = fighterIds.every((fighterId) => {
        const fighter = fighters.find((candidate) => candidate.id === fighterId);
        return Boolean(fighter?.alive);
      });
      if (!alive || fighterIds.length < 1 || fighterIds.length > 5) return false;
      emit({ ...state, screen: "battle", deployment: [...fighterIds] });
      return true;
    },
    finishCampaignMission: (outcome, participants) => {
      const active = state.activeMissionId;
      if (state.battleKind !== "campaign" || active === null) return null;
      const result = requireCampaign().finishMission(active, outcome, participants);
      if (!result) return null;
      emit({ ...state, screen: "missionResult", paused: false, outcome });
      return result;
    },
    leaveCampaignMission: () => {
      requireCampaign().abandonMission();
      emit({ ...idle, screen: "campaign" });
    },
    backToCampaign: () => {
      emit({ ...idle, screen: "campaign" });
    },
    getCampaign: () => requireCampaign(),
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
