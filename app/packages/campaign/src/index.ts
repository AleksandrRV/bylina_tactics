import type { CampaignConfig, MissionConfig } from "@bylina/content";

/**
 * Автомат Летучего Корабля (module-core-campaign).
 *
 * Выпуск 0.10.0: счётчик Тьмы, перечень точек, прирост Тьмы после миссии,
 * высадка фиксированного отряда. Ранения, дружина, Кузня и финал не входят.
 *
 * Правила (base-design §3.1):
 * - точки открываются по порядку конфигурации: доступна первая, после
 *   завершения миссии открывается следующая;
 * - после завершения любой миссии счётчик Тьмы увеличивается на величину
 *   миссии: `darknessOnVictory` при успехе, `darknessOnDefeat` при поражении;
 * - поражение в отдельной миссии не завершает кампанию;
 * - кампания проиграна, когда счётчик Тьмы достиг максимума.
 *   (Победа по «Игле» и гибель дружины — последующие выпуски.)
 */

export type MissionOutcome = "victory" | "defeat";
export type CampaignPhase = "active" | "lost";

export type MissionPointStatus = "open" | "done" | "locked";

export interface MissionPointState {
  id: string;
  status: MissionPointStatus;
}

export interface MissionFinishResult {
  /** Прирост Тьмы, применённый после миссии. */
  darknessGained: number;
  /** Счётчик Тьмы достиг максимума: кампания проиграна. */
  campaignLost: boolean;
}

export interface CampaignState {
  darkness: number;
  darknessMax: number;
  phase: CampaignPhase;
  /** Точки в порядке конфигурации. */
  missions: MissionPointState[];
  /** Идентификатор начатой, но не завершённой миссии. */
  activeMissionId: string | null;
  lastResult: { missionId: string; outcome: MissionOutcome; darknessGained: number } | null;
}

export interface CampaignApi {
  getState(): CampaignState;
  /** Записи точек в порядке конфигурации. */
  getMissions(): MissionConfig[];
  getMission(id: string): MissionConfig | undefined;
  /** Начать доступную миссию; возвращает false, если миссия недоступна. */
  startMission(id: string): boolean;
  /**
   * Завершить начатую миссию исходом. Применяет прирост Тьмы по конфигурации,
   * помечает точку пройденной, открывает следующую. Возвращает null, если
   * команда недопустима (миссия не начата, кампания завершена).
   */
  finishMission(id: string, outcome: MissionOutcome): MissionFinishResult | null;
  /** Покинуть начатую миссию без последствий (возврат на карту). */
  abandonMission(): void;
  subscribe(listener: () => void): () => void;
}

export function createCampaign(config: CampaignConfig): CampaignApi {
  const missions = config.missions;
  const state: CampaignState = {
    darkness: 0,
    darknessMax: config.darknessMax,
    phase: "active",
    missions: missions.map((mission, index) => ({
      id: mission.id,
      status: index === 0 ? "open" : "locked",
    })),
    activeMissionId: null,
    lastResult: null,
  };
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const listener of listeners) listener();
  };

  const findMission = (id: string): MissionPointState | undefined =>
    state.missions.find((mission) => mission.id === id);

  const openNext = (): void => {
    const next = state.missions.find((mission) => mission.status !== "done");
    if (next && next.status === "locked") next.status = "open";
  };

  return {
    getState: () => ({ ...state, missions: state.missions.map((mission) => ({ ...mission })) }),
    getMissions: () => missions.map((mission) => ({ ...mission })),
    getMission: (id) => missions.find((mission) => mission.id === id),
    startMission: (id) => {
      if (state.phase !== "active" || state.activeMissionId !== null) return false;
      const point = findMission(id);
      if (!point || point.status !== "open") return false;
      state.activeMissionId = id;
      emit();
      return true;
    },
    finishMission: (id, outcome) => {
      if (state.phase !== "active" || state.activeMissionId !== id) return null;
      const point = findMission(id);
      const mission = missions.find((entry) => entry.id === id);
      if (!point || !mission) return null;
      const darknessGained = outcome === "victory" ? mission.darknessOnVictory : mission.darknessOnDefeat;
      state.darkness = Math.min(state.darknessMax, state.darkness + darknessGained);
      point.status = "done";
      state.activeMissionId = null;
      state.lastResult = { missionId: id, outcome, darknessGained };
      const campaignLost = state.darkness >= state.darknessMax;
      if (campaignLost) {
        state.phase = "lost";
      } else {
        openNext();
      }
      emit();
      return { darknessGained, campaignLost };
    },
    abandonMission: () => {
      if (state.activeMissionId === null) return;
      state.activeMissionId = null;
      emit();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
