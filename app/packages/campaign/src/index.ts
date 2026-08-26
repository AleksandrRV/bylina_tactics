import type { CampaignConfig, ItemConfig, MissionConfig } from "@bylina/content";

/**
 * Автомат Летучего Корабля (module-core-campaign).
 *
 * Выпуск 0.12.0 замыкает цикл запасов (game-design §3.1, roadmap §5.3):
 * - награды миссий: золото, травы, артефакты — зачисляются при успехе;
 * - Кузня: изготовление предметов по записям конфигурации за запасы;
 * - снаряжение бойца перед высадкой: один предмет на бойца, влияет на
 *   следующее сражение (оружие либо модификаторы характеристик);
 * - открытие участков карты сканированием: корабль сканирует окрестность
 *   своего положения, открывая точки в радиусе; правила — в конфигурации
 *   кампании (поле `scan`).
 */

export type MissionOutcome = "victory" | "defeat";
export type CampaignPhase = "active" | "lost";

export type MissionPointStatus = "open" | "done" | "locked";

export interface Resources {
  gold: number;
  herbs: number;
  artifacts: number;
}

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
  /** Предмет из запасов корабля, надетый на бойца. */
  equippedItemId: string | null;
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
  /** Награда миссии (при успехе; при поражении — нули). */
  rewards: Resources;
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

export interface ScanResult {
  /** Затраченные на сканирование запасы. */
  cost: Resources;
  /** Открытые сканированием точки. */
  opened: string[];
}

/** Визуальное событие перелёта корабля, не влияющее на правила кампании. */
export interface ShipFlight {
  /** Уникальный номер события в жизни автомата. */
  id: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

export interface CampaignState {
  darkness: number;
  darknessMax: number;
  phase: CampaignPhase;
  /** Запасы корабля. */
  resources: Resources;
  /** Изготовленные предметы (записи `items`). */
  inventory: string[];
  /** Положение Летучего Корабля на карте царства. */
  shipPosition: { x: number; y: number };
  /** Точки в порядке конфигурации. */
  missions: MissionPointState[];
  /** Реестр дружины. */
  fighters: FighterState[];
  /** Генералы, погибшие окончательно (0.18.0): не возвращаются в кампании. */
  deadGenerals: string[];
  /** Идентификатор начатой, но не завершённой миссии. */
  activeMissionId: string | null;
  lastResult: {
    missionId: string;
    outcome: MissionOutcome;
    darknessGained: number;
    rewards: Resources;
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
  /** Записи предметов Кузни. */
  getItems(): ItemConfig[];
  /** Границы численности высадки из конфигурации кампании (`deployMin`, `deployMax`). */
  getDeployLimits(): { min: number; max: number };
  /** Начать доступную миссию; возвращает false, если миссия недоступна. */
  startMission(id: string): boolean;
  /**
   * Завершить начатую миссию исходом и составом участников. Применяет
   * прирост Тьмы, награду, исходы бойцов, пополнение; корабль перелетает
   * к точке миссии. Возвращает null, если команда недопустима.
   */
  finishMission(
    id: string,
    outcome: MissionOutcome,
    participants: MissionParticipant[],
    /** Генералы, погибшие в этой миссии (0.18.0): исключаются из кампании. */
    generalDeaths?: string[],
  ): MissionFinishResult | null;
  /** Покинуть начатую миссию без последствий (возврат на карту). */
  abandonMission(): void;
  /** Сканирование окрестности корабля: открывает точки в радиусе за стоимость. */
  scan(): ScanResult | null;
  /** Последний перелёт корабля для анимации карты; это не часть сохранения. */
  getLastFlight(): ShipFlight | null;
  /** Изготовить предмет в Кузне (один экземпляр каждой записи). */
  craftItem(itemId: string): boolean;
  /** Надеть предмет на бойца; `null` снимает снаряжение. */
  equipItem(fighterId: number, itemId: string | null): boolean;
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

const ZERO_RESOURCES: Resources = { gold: 0, herbs: 0, artifacts: 0 };

export interface CampaignOptions {
  /** Запас здоровья записей юнитов дружины (из модуля содержания). */
  unitStats?: Record<string, { maxHealth: number }>;
  /** Записи предметов Кузни (из модуля содержания). */
  items?: ItemConfig[];
  /** Восстановленное состояние кампании (сохранение, версия 0.13.0). */
  initialState?: CampaignState;
  /**
   * Допустимые записи классов для назначения рекруту (0.19.2): при заданном
   * списке `assignClass` отклоняет записи вне его — защита от назначения
   * чужой или несуществующей записи.
   */
  classUnitIds?: string[];
}

export function createCampaign(config: CampaignConfig, options: CampaignOptions = {}): CampaignApi {
  const hpOf = (unitId: string): number => options.unitStats?.[unitId]?.maxHealth ?? 6;
  const items = options.items ?? [];
  const missions = config.missions;
  const initialRoster = config.initialRoster.length > 0
    ? config.initialRoster
    : ["bogatyr", "strelets", "znaharka"];
  // Восстановление сохранённой кампании (0.13.0): счётчики идентификаторов
  // и имён переносятся из состояния, чтобы новые бойцы не конфликтовали
  // с уже существующими.
  let nextFighterId = options.initialState ? Math.max(0, ...options.initialState.fighters.map((fighter) => fighter.id)) + 1 : 1;
  let nameCursor = options.initialState?.fighters.length ?? 0;
  // Имена, занятые живыми бойцами: при восстановлении курсор имён может
  // отстать от уже выданных имён (состав записи меняется от боя к бою),
  // а при вместимости дружины больше списка имён — зациклиться. Новое имя
  // подбирается первым свободным среди живых, поэтому два живых бойца
  // никогда не носят одно имя.
  const usedNames = new Set(
    (options.initialState?.fighters ?? []).filter((fighter) => fighter.alive).map((fighter) => fighter.name),
  );

  const nextRecruitName = (): string => {
    for (let step = 0; step < RECRUIT_NAMES.length; step += 1) {
      const candidate = RECRUIT_NAMES[nameCursor % RECRUIT_NAMES.length];
      nameCursor += 1;
      if (candidate !== undefined && !usedNames.has(candidate)) {
        usedNames.add(candidate);
        return candidate;
      }
    }
    return `Рекрут ${nextFighterId}`;
  };

  const makeFighter = (unitId: string, level: number, hp?: number): FighterState => {
    const maxHp = hpOf(unitId);
    const fighter: FighterState = {
      id: nextFighterId,
      name: nextRecruitName(),
      unitId,
      level,
      hp: hp ?? maxHp,
      maxHp,
      wounded: false,
      alive: true,
      equippedItemId: null,
    };
    nextFighterId += 1;
    return fighter;
  };

  const firstMission = missions[0];
  const freshState: CampaignState = {
    darkness: 0,
    darknessMax: config.darknessMax,
    phase: "active",
    resources: { ...config.startingResources },
    inventory: [],
    shipPosition: firstMission ? { x: firstMission.x, y: firstMission.y } : { x: 50, y: 50 },
    missions: missions.map((mission, index) => ({
      id: mission.id,
      status: index === 0 ? "open" : "locked",
    })),
    fighters: initialRoster.map((unitId) => makeFighter(unitId, config.classUnlockLevel)),
    deadGenerals: [],
    activeMissionId: null,
    lastResult: null,
  };
  const state: CampaignState = options.initialState
    ? {
        ...options.initialState,
        darknessMax: config.darknessMax,
        resources: { ...options.initialState.resources },
        inventory: [...options.initialState.inventory],
        shipPosition: { ...options.initialState.shipPosition },
        missions: options.initialState.missions.map((mission) => ({ ...mission })),
        fighters: options.initialState.fighters.map((fighter) => ({ ...fighter })),
        deadGenerals: [...(options.initialState.deadGenerals ?? [])],
        lastResult: options.initialState.lastResult ? { ...options.initialState.lastResult } : null,
      }
    : freshState;
  const listeners = new Set<() => void>();
  // Полёт — одноразовое событие представления. Оно намеренно не входит в
  // CampaignState и не сериализуется: загрузка сохранения не должна повторно
  // запускать старую анимацию и не меняет правила кампании.
  let flightSequence = 0;
  let lastFlight: ShipFlight | null = null;

  // Снимок является публичным значением API: вложенные объекты тоже должны
  // быть независимыми от автомата. Иначе вызывающий код мог изменить
  // `lastResult.rewards` через результат getState() и обойти emit().
  const cloneLastResult = (result: CampaignState["lastResult"]): CampaignState["lastResult"] =>
    result
      ? {
          ...result,
          rewards: { ...result.rewards },
          fallen: [...result.fallen],
          wounded: [...result.wounded],
          leveledUp: [...result.leveledUp],
        }
      : null;

  const emit = (): void => {
    for (const listener of listeners) listener();
  };

  const findMission = (id: string): MissionPointState | undefined =>
    state.missions.find((mission) => mission.id === id);

  const livingCount = (): number => state.fighters.filter((fighter) => fighter.alive).length;

  const canPay = (cost: Resources): boolean =>
    state.resources.gold >= cost.gold
    && state.resources.herbs >= cost.herbs
    && state.resources.artifacts >= cost.artifacts;

  const pay = (cost: Resources): void => {
    state.resources.gold -= cost.gold;
    state.resources.herbs -= cost.herbs;
    state.resources.artifacts -= cost.artifacts;
  };

  const gain = (reward: Resources): void => {
    state.resources.gold += reward.gold;
    state.resources.herbs += reward.herbs;
    state.resources.artifacts += reward.artifacts;
  };

  return {
    getState: () => ({
      ...state,
      resources: { ...state.resources },
      inventory: [...state.inventory],
      shipPosition: { ...state.shipPosition },
      missions: state.missions.map((mission) => ({ ...mission })),
      fighters: state.fighters.map((fighter) => ({ ...fighter })),
      lastResult: cloneLastResult(state.lastResult),
    }),
    getMissions: () => missions.map((mission) => ({ ...mission })),
    getLastFlight: () => lastFlight
      ? { id: lastFlight.id, from: { ...lastFlight.from }, to: { ...lastFlight.to } }
      : null,
    getMission: (id) => missions.find((mission) => mission.id === id),
    getItems: () => items.map((item) => ({ ...item, cost: { ...item.cost } })),
    getDeployLimits: () => ({ min: config.deployMin, max: config.deployMax }),
    startMission: (id) => {
      if (state.phase !== "active" || state.activeMissionId !== null) return false;
      const point = findMission(id);
      if (!point || point.status !== "open") return false;
      state.activeMissionId = id;
      emit();
      return true;
    },
    finishMission: (id, outcome, participants, generalDeaths) => {
      if (state.phase !== "active" || state.activeMissionId !== id) return null;
      const point = findMission(id);
      const mission = missions.find((entry) => entry.id === id);
      if (!point || !mission) return null;

      const darknessGained = outcome === "victory" ? mission.darknessOnVictory : mission.darknessOnDefeat;
      state.darkness = Math.min(state.darknessMax, state.darkness + darknessGained);

      const rewards: Resources = outcome === "victory" ? { ...mission.rewards } : { ...ZERO_RESOURCES };
      if (outcome === "victory") gain(rewards);

      const fallen: string[] = [];
      const wounded: string[] = [];
      const leveledUp: string[] = [];

      for (const participant of participants) {
        const fighter = state.fighters.find((candidate) => candidate.id === participant.fighterId);
        if (!fighter || !fighter.alive) continue;
        if (!participant.survived) {
          fighter.alive = false;
          fighter.hp = 0;
          // Снаряжение погибшего возвращается в запасы корабля.
          fighter.equippedItemId = null;
          fallen.push(fighter.name);
          continue;
        }
        fighter.hp = Math.max(1, Math.min(fighter.maxHp, participant.hp));
        // §4 content-schema: ранение при запасе здоровья не выше woundHpRatio × maxHealth.
        // Порог не округляется: 4/12 > 0.3 не является ранением.
        const woundedNow = fighter.hp <= fighter.maxHp * config.woundHpRatio;
        if (woundedNow && !fighter.wounded) wounded.push(fighter.name);
        fighter.wounded = fighter.wounded || woundedNow;
        if (outcome === "victory") {
          fighter.level += 1;
          leveledUp.push(fighter.name);
        }
      }

      point.status = "done";
      state.activeMissionId = null;
      // Окончательная гибель генералов (0.18.0): погибший не возвращается.
      for (const generalId of generalDeaths ?? []) {
        if (!state.deadGenerals.includes(generalId)) state.deadGenerals.push(generalId);
      }
      // Корабль перелетает к завершённой точке; дальнейшие точки открываются сканированием.
      // Координаты перелёта — часть представления, а не новая механика кампании.
      const from = { ...state.shipPosition };
      const to = { x: mission.x, y: mission.y };
      state.shipPosition = to;
      lastFlight = { id: flightSequence++, from, to };

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
      state.lastResult = { missionId: id, outcome, darknessGained, rewards, fallen, wounded, leveledUp, newRecruit };
      if (campaignLost) {
        state.phase = "lost";
      }
      emit();
      return { darknessGained, rewards, campaignLost, lostReason, fallen, wounded, leveledUp, newRecruit };
    },
    abandonMission: () => {
      if (state.activeMissionId === null) return;
      state.activeMissionId = null;
      emit();
    },
    scan: () => {
      if (state.phase !== "active" || state.activeMissionId !== null) return null;
      const cost = { ...config.scan.cost };
      if (!canPay(cost)) return null;
      const opened: string[] = [];
      for (const point of state.missions) {
        if (point.status !== "locked") continue;
        const mission = missions.find((entry) => entry.id === point.id);
        if (!mission) continue;
        const distance = Math.hypot(mission.x - state.shipPosition.x, mission.y - state.shipPosition.y);
        if (distance <= config.scan.radius) {
          point.status = "open";
          opened.push(point.id);
        }
      }
      // Стоимость списывается только за фактически открытые точки (0.19.2):
      // пустое сканирование (все закрытые точки вне радиуса) запасы не тратит.
      if (opened.length === 0) return null;
      pay(cost);
      emit();
      return { cost, opened };
    },
    craftItem: (itemId) => {
      if (state.phase !== "active") return false;
      const item = items.find((entry) => entry.id === itemId);
      if (!item) return false;
      if (state.inventory.includes(itemId)) return false;
      if (!canPay(item.cost)) return false;
      pay(item.cost);
      state.inventory.push(itemId);
      emit();
      return true;
    },
    equipItem: (fighterId, itemId) => {
      if (state.phase !== "active") return false;
      const fighter = state.fighters.find((candidate) => candidate.id === fighterId);
      if (!fighter || !fighter.alive) return false;
      if (itemId === null) {
        if (fighter.equippedItemId === null) return false;
        fighter.equippedItemId = null;
        emit();
        return true;
      }
      if (!state.inventory.includes(itemId)) return false;
      if (fighter.equippedItemId === itemId) return false;
      // Предмет единственный: не может быть надет на двух бойцов сразу.
      if (state.fighters.some((candidate) => candidate.alive && candidate.equippedItemId === itemId)) return false;
      fighter.equippedItemId = itemId;
      emit();
      return true;
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
      // При заданном перечне классов (0.19.2) назначение чужой либо
      // несуществующей записи отклоняется.
      if (options.classUnitIds && !options.classUnitIds.includes(unitId)) return false;
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
