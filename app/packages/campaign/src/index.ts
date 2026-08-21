import type { CampaignConfig, MissionConfig } from "@bylina/content";

/**
 * Автомат Летучего Корабля (module-core-campaign).
 *
 * Выпуск 0.11.0 добавляет постоянную дружину (base-design §3.1):
 * - реестр бойцов: рекруты без класса и бойцы классов;
 * - высадка от deployMin до deployMax живых бойцов;
 * - окончательная гибель: погибший в миссии исключается навсегда;
 * - ранение: выживший с запасом здоровья не выше `woundHpRatio × maxHealth`
 *   получает ранение со штрафами конфигурации до лечения в Горнице;
 * - уровень: выжившие после победы получают уровень; рекрут, достигший
 *   `classUnlockLevel`, получает класс по выбору игрока;
 * - пополнение: после победы в дружину вступает новый рекрут, пока
 *   численность меньше `rosterCap`;
 * - поражение кампании: счётчик Тьмы достиг максимума либо не осталось
 *   живых бойцов.
 */

export type MissionOutcome = "victory" | "defeat";
export type CampaignPhase = "active" | "lost";

export type MissionPointStatus = "open" | "done" | "locked";

export interface MissionPointState {
  id: string;
  status: MissionPointStatus;
}

export interface FighterState {
  id: number;
  name: string;
  /** Запись юнита (класс либо `recruitUnitId` для рекрута). */
  unitId: string;
  level: number;
  hp: number;
  maxHp: number;
  /** Признак ранения: штрафы действуют до лечения в Горнице. */
  wounded: boolean;
  alive: boolean;
}

export interface MissionParticipant {
  fighterId: number;
  survived: boolean;
  /** Запас здоровья на момент завершения миссии. */
  hp: number;
}

export interface MissionFinishResult {
  /** Прирост Тьмы, применённый после миссии. */
  darknessGained: number;
  /** Кампания завершена: Тьма заполнена либо дружина пуста. */
  campaignLost: boolean;
  /** Причина завершения, если кампания проиграна. */
  lostReason?: "darkness" | "roster";
  /** Имена погибших в миссии бойцов. */
  fallen: string[];
  /** Имена получивших ранение бойцов. */
  wounded: string[];
  /** Имена повысивших уровень бойцов. */
  leveledUp: string[];
  /** Имя нового рекрута, вступившего в дружину. */
  newRecruit: string | null;
}

export interface CampaignState {
  darkness: number;
  darknessMax: number;
  phase: CampaignPhase;
  /** Точки в порядке конфигурации. */
  missions: MissionPointState[];
  /** Реестр дружины. */
  fighters: FighterState[];
  /** Идентификатор начатой, но не завершённой миссии. */
  activeMissionId: string | null;
  lastResult: {
    missionId: string;
    outcome: MissionOutcome;
    darknessGained: number;
    fallen: string[];
    wounded: string[];
    leveledUp: string[];
    newRecruit: string | null;
  } | null;
}

export interface CampaignApi {
  getState(): CampaignState;
  /** Записи точек в порядке конфигурации. */
  getMissions(): MissionConfig[];
  getMission(id: string): MissionConfig | undefined;
  /** Начать доступную миссию; возвращает false, если миссия недоступна. */
  startMission(id: string): boolean;
  /**
   * Завершить начатую миссию исходом и составом участников. Применяет
   * прирост Тьмы, исходы бойцов (гибель, ранение, уровень), пополнение,
   * открывает следующую точку. Возвращает null, если команда недопустима.
   */
  finishMission(id: string, outcome: MissionOutcome, participants: MissionParticipant[]): MissionFinishResult | null;
  /** Покинуть начатую миссию без последствий (возврат на карту). */
  abandonMission(): void;
  /** Лечение раненого в Горнице: здоровье восстанавливается, ранение снимается. */
  healFighter(fighterId: number): boolean;
  /** Назначить класс рекруту, достигшему `classUnlockLevel`. */
  assignClass(fighterId: number, unitId: string): boolean;
  subscribe(listener: () => void): () => void;
}

/** Имена новобранцев; имена — данные, а не строки локализации. */
const RECRUIT_NAMES: readonly string[] = [
  "Ратибор",
  "Любомир",
  "Светозар",
  "Велимир",
  "Борислав",
  "Яромир",
  "Творимир",
  "Мирослав",
  "Доброгост",
  "Всеслав",
];

export interface CampaignOptions {
  /** Запас здоровья записей юнитов дружины (из модуля содержания). */
  unitStats?: Record<string, { maxHealth: number }>;
}

export function createCampaign(config: CampaignConfig, options: CampaignOptions = {}): CampaignApi {
  const hpOf = (unitId: string): number => options.unitStats?.[unitId]?.maxHealth ?? 6;
  const missions = config.missions;
  const initialRoster = config.initialRoster.length > 0
    ? config.initialRoster
    : ["bogatyr", "strelets", "znaharka"];
  let nextFighterId = 1;
  let nameCursor = 0;

  const makeFighter = (unitId: string, level: number, hp?: number): FighterState => {
    const maxHp = hpOf(unitId);
    const fighter: FighterState = {
      id: nextFighterId,
      name: RECRUIT_NAMES[nameCursor % RECRUIT_NAMES.length] ?? `Рекрут ${nextFighterId}`,
      unitId,
      level,
      hp: hp ?? maxHp,
      maxHp,
      wounded: false,
      alive: true,
    };
    nextFighterId += 1;
    nameCursor += 1;
    return fighter;
  };

  const state: CampaignState = {
    darkness: 0,
    darknessMax: config.darknessMax,
    phase: "active",
    missions: missions.map((mission, index) => ({
      id: mission.id,
      status: index === 0 ? "open" : "locked",
    })),
    fighters: initialRoster.map((unitId) => makeFighter(unitId, config.classUnlockLevel)),
    activeMissionId: null,
    lastResult: null,
  };
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const listener of listeners) listener();
  };

  const findMission = (id: string): MissionPointState | undefined =>
    state.missions.find((mission) => mission.id === id);

  const livingCount = (): number => state.fighters.filter((fighter) => fighter.alive).length;

  const openNext = (): void => {
    const next = state.missions.find((mission) => mission.status !== "done");
    if (next && next.status === "locked") next.status = "open";
  };

  return {
    getState: () => ({
      ...state,
      missions: state.missions.map((mission) => ({ ...mission })),
      fighters: state.fighters.map((fighter) => ({ ...fighter })),
    }),
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
    finishMission: (id, outcome, participants) => {
      if (state.phase !== "active" || state.activeMissionId !== id) return null;
      const point = findMission(id);
      const mission = missions.find((entry) => entry.id === id);
      if (!point || !mission) return null;

      const darknessGained = outcome === "victory" ? mission.darknessOnVictory : mission.darknessOnDefeat;
      state.darkness = Math.min(state.darknessMax, state.darkness + darknessGained);

      const fallen: string[] = [];
      const wounded: string[] = [];
      const leveledUp: string[] = [];

      for (const participant of participants) {
        const fighter = state.fighters.find((candidate) => candidate.id === participant.fighterId);
        if (!fighter || !fighter.alive) continue;
        if (!participant.survived) {
          fighter.alive = false;
          fighter.hp = 0;
          fallen.push(fighter.name);
          continue;
        }
        fighter.hp = Math.max(1, Math.min(fighter.maxHp, participant.hp));
        const woundedNow = fighter.hp <= Math.max(1, Math.round(fighter.maxHp * config.woundHpRatio));
        if (woundedNow && !fighter.wounded) wounded.push(fighter.name);
        fighter.wounded = fighter.wounded || woundedNow;
        if (outcome === "victory") {
          fighter.level += 1;
          leveledUp.push(fighter.name);
        }
      }

      point.status = "done";
      state.activeMissionId = null;

      let newRecruit: string | null = null;
      if (outcome === "victory" && livingCount() > 0 && state.fighters.length < config.rosterCap) {
        const recruit = makeFighter(config.recruitUnitId, 1);
        state.fighters.push(recruit);
        newRecruit = recruit.name;
      }

      const campaignLost = state.darkness >= state.darknessMax || livingCount() === 0;
      const lostReason = state.darkness >= state.darknessMax
        ? "darkness"
        : livingCount() === 0
          ? "roster"
          : undefined;
      state.lastResult = { missionId: id, outcome, darknessGained, fallen, wounded, leveledUp, newRecruit };
      if (campaignLost) {
        state.phase = "lost";
      } else {
        openNext();
      }
      emit();
      return { darknessGained, campaignLost, lostReason, fallen, wounded, leveledUp, newRecruit };
    },
    abandonMission: () => {
      if (state.activeMissionId === null) return;
      state.activeMissionId = null;
      emit();
    },
    healFighter: (fighterId) => {
      const fighter = state.fighters.find((candidate) => candidate.id === fighterId);
      if (!fighter || !fighter.alive || !fighter.wounded) return false;
      fighter.hp = fighter.maxHp;
      fighter.wounded = false;
      emit();
      return true;
    },
    assignClass: (fighterId, unitId) => {
      const fighter = state.fighters.find((candidate) => candidate.id === fighterId);
      if (!fighter || !fighter.alive) return false;
      if (fighter.unitId !== config.recruitUnitId) return false;
      if (fighter.level < config.classUnlockLevel) return false;
      fighter.unitId = unitId;
      fighter.maxHp = hpOf(unitId);
      fighter.hp = fighter.maxHp;
      emit();
      return true;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
