import type { CampaignConfig, ItemConfig, MissionConfig, TalentConfig } from "@bylina/content";
import { migratePrologueFighters } from "./prologue-migration.js";

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
type CampaignPhase = "active" | "lost";
type CampaignChapter = "prologue" | "open";

type MissionPointStatus = "open" | "done" | "locked";

interface Resources {
  gold: number;
  herbs: number;
  artifacts: number;
}

interface MissionPointState {
  id: string;
  status: MissionPointStatus;
}

interface FighterState {
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
  /** Опыт внутри уровня: 0..XP_MAX-1 (порог 100, 0.21.27). */
  xp: number;
  /** Выбранные таланты класса по идентификаторам (0.21.30). */
  talents: string[];
  /**
   * Уровни, за которые выбор таланта ещё не сделан (0.21.30): очередь
   * растёт при повышении, экран кампании предлагает по одному окну.
   */
  pendingTalentLevels: number[];
}

/** Вариант выбора таланта: запись контента, дополненная уровнем (0.21.30). */
export interface TalentChoice {
  fighterId: number;
  level: number;
  options: TalentConfig[];
}

export interface XpGain {
  fighterId: number;
  name: string;
  levelBefore: number;
  levelAfter: number;
  xpBefore: number;
  xpAfter: number;
  gained: number;
  leveled: boolean;
}

export interface MissionParticipant {
  fighterId: number;
  survived: boolean;
  /** Запас здоровья на момент завершения миссии. */
  hp: number;
}

interface MissionFinishResult {
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
  /** Прирост опыта по бойцам (0.21.27). */
  xpGains: XpGain[];
}

interface ScanResult {
  /** Затраченные на сканирование запасы. */
  cost: Resources;
  /** Открытые сканированием точки. */
  opened: string[];
}

export const XP_MAX = 100;

export interface CampaignState {
  /** Глава: пролог (линейная цепочка) либо открытая карта (0.20.31). */
  chapter: CampaignChapter;
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
    /** Прирост опыта по бойцам (0.21.27): для анимированной полосы на экране победы. */
    xpGains: XpGain[];
  } | null;
}

export interface CampaignApi {
  getState(): CampaignState;
  setChapter(chapter: CampaignChapter): void;
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
  /** Изготовить предмет в Кузне (один экземпляр каждой записи). */
  craftItem(itemId: string): boolean;
  /** Надеть предмет на бойца; `null` снимает снаряжение. */
  equipItem(fighterId: number, itemId: string | null): boolean;
  /** Лечение раненого в Горнице: здоровье восстанавливается, ранение снимается. */
  healFighter(fighterId: number): boolean;
  /** Назначить класс рекруту, достигшему `classUnlockLevel`. */
  assignClass(fighterId: number, unitId: string): boolean;
  /**
   * Первый ожидающий выбор таланта (0.21.30): боец с непустой очередью
   * `pendingTalentLevels`, у класса которого есть записи для этого уровня.
   * Уровни без записей списываются молча. `null` — выбирать нечего.
   */
  getPendingTalentChoice(): TalentChoice | null;
  /** Выбрать талант из предложенной пары для указанного уровня бойца (0.21.30). */
  chooseTalent(fighterId: number, level: number, talentId: string): boolean;
  /** Записи выбранных талантов бойца (0.21.30): для высадки и карточки. */
  getFighterTalents(fighterId: number): TalentConfig[];
  /** Пара талантов класса для уровня (0.21.30); пустой массив — уровень без выбора. */
  getTalentOptions(unitId: string, level: number): TalentConfig[];
  /**
   * Переход пролог → открытая кампания (0.20.35). Идемпотентно, если глава уже `open`.
   * Точка перехода задаётся `prologueFinalMissionId` (конфиг этапа 1).
   */
  openSandboxFromPrologue(): boolean;
  /**
   * Прокачка героя пролога после М2 (0.21.25): Микула становится богатырём
   * и получает уровень 2. Оружие не переназначается — оно берётся из
   * экипировки (дубина сохраняется). Действует только в главе «prologue».
   * @deprecated Используйте assignClass с фильтром [bogatyr] (0.21.27).
   */
  promotePrologueHero(): boolean;
  /** Начисление опыта за сюжетную миссию пролога (0.21.27): без Тьмы/ресурсов, с анимацией полосы. */
  grantPrologueXp(missionId: string, gained?: number): XpGain[];
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

interface CampaignOptions {
  /** Запас здоровья записей юнитов дружины (из модуля содержания). */
  unitStats?: Record<string, { maxHealth: number }>;
  /** Записи предметов Кузни (из модуля содержания). */
  items?: ItemConfig[];
  /**
   * Восстановленное состояние кампании (сохранение, версия 0.13.0).
   * Поля талантов (0.21.30) в записях прежних версий отсутствуют — они
   * восстанавливаются пустыми.
   */
  initialState?: Omit<CampaignState, "chapter" | "fighters"> & {
    chapter?: CampaignChapter;
    fighters: (Omit<FighterState, "talents" | "pendingTalentLevels"> &
      Partial<Pick<FighterState, "talents" | "pendingTalentLevels">>)[];
  };
  /** Начальная глава (0.20.31). По умолчанию «open». */
  chapter?: CampaignChapter;
  /**
   * Финальная миссия пролога (0.20.31): после её победы автомат переходит
   * в открытую песочницу кампании (`openSandboxFromPrologue`).
   */
  prologueFinalMissionId?: string;
  /**
   * Герои пролога (0.21.30): при старте главы «prologue» дружина состоит
   * из них, а не из стартового состава песочницы — иначе опыт сюжетных
   * миссий некому начислять. Имена — данные сюжета; запись юнита — из
   * бестиария пролога. По умолчанию — Микула и Федот.
   */
  prologueRoster?: readonly { name: string; unitId: string }[];
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
  const initialRoster = config.initialRoster.length > 0 ? config.initialRoster : ["bogatyr", "strelets", "znaharka"];
  // Восстановление сохранённой кампании (0.13.0): счётчики идентификаторов
  // и имён переносятся из состояния, чтобы новые бойцы не конфликтовали
  // с уже существующими.
  let nextFighterId = options.initialState
    ? Math.max(0, ...options.initialState.fighters.map((fighter) => fighter.id)) + 1
    : 1;
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

  const makeFighter = (unitId: string, level: number, hp?: number, xp = 0, name?: string): FighterState => {
    const maxHp = hpOf(unitId);
    const fighter: FighterState = {
      id: nextFighterId,
      name: name ?? nextRecruitName(),
      unitId,
      level,
      hp: hp ?? maxHp,
      maxHp,
      wounded: false,
      alive: true,
      equippedItemId: null,
      xp,
      talents: [],
      pendingTalentLevels: [],
    };
    nextFighterId += 1;
    return fighter;
  };

  /** Герои пролога (0.21.30): Микула — уровень 1 без класса, опыт 0. */
  const PROLOGUE_ROSTER: readonly { name: string; unitId: string }[] = options.prologueRoster ?? [
    { name: "Микула", unitId: "mikula_peasant" },
    { name: "Федот", unitId: "fedot_stranded" },
  ];
  const prologueFighters = (): FighterState[] =>
    PROLOGUE_ROSTER.map((hero) => {
      usedNames.add(hero.name);
      return makeFighter(hero.unitId, 1, undefined, 0, hero.name);
    });

  const firstMission = missions[0];
  const startChapter: CampaignChapter = options.chapter ?? "open";
  const freshState: CampaignState = {
    chapter: startChapter,
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
    // Пролог (0.21.30): дружина — герои сюжета; стартовый состав
    // песочницы приходит при переходе (openSandboxFromPrologue).
    fighters:
      startChapter === "prologue"
        ? prologueFighters()
        : initialRoster.map((unitId) => makeFighter(unitId, config.classUnlockLevel)),
    deadGenerals: [],
    activeMissionId: null,
    lastResult: null,
  };
  const state: CampaignState = options.initialState
    ? {
        ...options.initialState,
        chapter: options.initialState.chapter ?? "open",
        darknessMax: config.darknessMax,
        resources: { ...options.initialState.resources },
        inventory: [...options.initialState.inventory],
        shipPosition: { ...options.initialState.shipPosition },
        missions: options.initialState.missions.map((mission) => ({ ...mission })),
        fighters: options.initialState.fighters.map((fighter) => ({
          ...fighter,
          xp: fighter.xp ?? 0,
          talents: [...(fighter.talents ?? [])],
          pendingTalentLevels: [...(fighter.pendingTalentLevels ?? [])],
        })),
        deadGenerals: [...(options.initialState.deadGenerals ?? [])],
        lastResult: options.initialState.lastResult
          ? {
              ...options.initialState.lastResult,
              rewards: { ...options.initialState.lastResult.rewards },
              fallen: [...options.initialState.lastResult.fallen],
              wounded: [...options.initialState.lastResult.wounded],
              leveledUp: [...options.initialState.lastResult.leveledUp],
              xpGains: [...((options.initialState.lastResult as CampaignState["lastResult"])?.xpGains ?? [])],
            }
          : null,
      }
    : freshState;
  const listeners = new Set<() => void>();

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
          xpGains: result.xpGains ? result.xpGains.map((gain) => ({ ...gain })) : [],
        }
      : null;

  const emit = (): void => {
    for (const listener of listeners) listener();
  };

  const findMission = (id: string): MissionPointState | undefined =>
    state.missions.find((mission) => mission.id === id);

  const livingCount = (): number => state.fighters.filter((fighter) => fighter.alive).length;

  const canPay = (cost: Resources): boolean =>
    state.resources.gold >= cost.gold &&
    state.resources.herbs >= cost.herbs &&
    state.resources.artifacts >= cost.artifacts;

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

  const applyXp = (fighter: FighterState, gained: number): XpGain => {
    const xpBefore = fighter.xp ?? 0;
    const levelBefore = fighter.level;
    let xp = xpBefore + gained;
    let level = levelBefore;
    let leveled = false;
    while (xp >= XP_MAX) {
      xp -= XP_MAX;
      level += 1;
      leveled = true;
      // Талант за каждый уровень выше порога класса (0.21.30): уровень
      // `classUnlockLevel` — выбор класса, выше — выбор одного из двух.
      if (level > config.classUnlockLevel) fighter.pendingTalentLevels.push(level);
    }
    fighter.xp = xp;
    fighter.level = level;
    return {
      fighterId: fighter.id,
      name: fighter.name,
      levelBefore,
      levelAfter: level,
      xpBefore,
      xpAfter: xp,
      gained,
      leveled,
    };
  };

  const SANDBOX_ROSTER = ["bogatyr", "strelets", "znaharka"] as const;

  /** Записи пролога без класса (0.21.30): таланты ждут назначения класса. */
  const PROLOGUE_CLASSLESS: Record<string, true> = { mikula_peasant: true, fedot_stranded: true };

  const talentOptions = (unitId: string, level: number): TalentConfig[] => {
    const pair = config.talents?.[unitId]?.[String(level)];
    return pair ? pair.map((talent) => ({ ...talent })) : [];
  };

  /** Сумма постоянных прибавок здоровья от выбранных талантов (0.21.30). */
  const talentHpBonus = (fighter: FighterState): number => {
    const all = Object.values(config.talents?.[fighter.unitId] ?? {}).flat();
    return fighter.talents.reduce((sum, talentId) => {
      const talent = all.find((entry) => entry.id === talentId);
      return sum + (talent?.passive?.maxHpMod ?? 0);
    }, 0);
  };

  const openSandboxFromPrologue = (): boolean => {
    if (state.chapter !== "prologue") return false;
    state.chapter = "open";
    state.fighters = migratePrologueFighters(state.fighters);
    for (const fighter of state.fighters) {
      if (fighter.unitId === "bogatyr" && fighter.level < 2) fighter.level = 2;
      fighter.xp = fighter.xp ?? 0;
      const maxHp = hpOf(fighter.unitId) + talentHpBonus(fighter);
      if (maxHp !== fighter.maxHp) {
        const ratio = fighter.maxHp > 0 ? fighter.hp / fighter.maxHp : 1;
        fighter.maxHp = maxHp;
        fighter.hp = Math.max(1, Math.min(maxHp, Math.round(ratio * maxHp)));
      }
    }
    for (const unitId of SANDBOX_ROSTER) {
      if (state.fighters.some((fighter) => fighter.unitId === unitId && fighter.alive)) continue;
      if (state.fighters.length >= config.rosterCap) break;
      const level = unitId === "bogatyr" ? Math.max(2, config.classUnlockLevel) : 1;
      state.fighters.push(makeFighter(unitId, level));
    }
    const empty = state.resources.gold === 0 && state.resources.herbs === 0 && state.resources.artifacts === 0;
    if (empty) gain(config.startingResources);
    const first = state.missions[0];
    if (first && first.status === "locked") first.status = "open";
    emit();
    return true;
  };

  /**
   * Прокачка героя пролога после М2 (0.21.25): Микула становится богатырём
   * и получает уровень 2. Оружие при смене класса НЕ переназначается — оно
   * берётся из экипировки (дубина из М1 остаётся у бойца). Идемпотентна.
   * @deprecated
   */
  const promotePrologueHero = (): boolean => {
    if (state.chapter !== "prologue") return false;
    const hero = state.fighters.find(
      (fighter) => fighter.alive && (fighter.unitId === "mikula_peasant" || fighter.unitId === "bogatyr"),
    );
    if (!hero) return false;
    let changed = false;
    if (hero.unitId === "mikula_peasant") {
      hero.unitId = "bogatyr";
      changed = true;
    }
    if (hero.level < 2) {
      hero.level = 2;
      changed = true;
    }
    hero.xp = hero.xp ?? 0;
    // Смена записи влечёт пересчёт запаса здоровья (крестьянин → богатырь):
    // соотношение текущего и максимального здоровья сохраняется, как и при
    // переходе в песочницу (openSandboxFromPrologue).
    const maxHp = hpOf(hero.unitId);
    if (maxHp !== hero.maxHp) {
      const ratio = hero.maxHp > 0 ? hero.hp / hero.maxHp : 1;
      hero.maxHp = maxHp;
      hero.hp = Math.max(1, Math.min(maxHp, Math.round(ratio * maxHp)));
      changed = true;
    }
    if (changed) emit();
    return true;
  };

  const grantPrologueXp = (missionId: string, gained = 50): XpGain[] => {
    if (state.chapter !== "prologue") return [];
    // Опыт только участникам миссии на всём протяжении (0.21.28): М1 только
    // Микула, М2 освобождённый Федот без опыта, М3 исключение — стрелец
    // получает опыт (скрыт в начале, активно участвует), М4 опыт всем троим.
    const PARTICIPANTS: Record<string, readonly string[]> = {
      prologue_brushwood: ["mikula_peasant"],
      prologue_cry: ["mikula_peasant"],
      prologue_glade: ["bogatyr", "strelets", "mikula_peasant", "fedot_stranded"],
      prologue_village: ["bogatyr", "strelets", "znaharka", "mikula_peasant", "fedot_stranded"],
    };
    const allowed = PARTICIPANTS[missionId];
    const xpGains: XpGain[] = [];
    const leveledUp: string[] = [];
    for (const fighter of state.fighters) {
      if (!fighter.alive) continue;
      if (allowed && !allowed.includes(fighter.unitId)) continue;
      const gainRec = applyXp(fighter, gained);
      xpGains.push(gainRec);
      if (gainRec.leveled) leveledUp.push(fighter.name);
    }
    // Фиксируем результат для экрана победы (prologue ResultScreen читает campaign.lastResult).
    state.lastResult = {
      missionId,
      outcome: "victory",
      darknessGained: 0,
      rewards: { ...ZERO_RESOURCES },
      fallen: [],
      wounded: [],
      leveledUp,
      newRecruit: null,
      xpGains,
    };
    emit();
    return xpGains;
  };

  return {
    getState: () => ({
      ...state,
      resources: { ...state.resources },
      inventory: [...state.inventory],
      shipPosition: { ...state.shipPosition },
      missions: state.missions.map((mission) => ({ ...mission })),
      fighters: state.fighters.map((fighter) => ({
        ...fighter,
        talents: [...fighter.talents],
        pendingTalentLevels: [...fighter.pendingTalentLevels],
      })),
      lastResult: cloneLastResult(state.lastResult),
    }),
    setChapter: (chapter) => {
      if (chapter === "prologue" && state.chapter !== "prologue") {
        // Вход в пролог из свежего автомата (0.21.30): состав песочницы
        // заменяется героями сюжета, чтобы опыт М1–М2 начислялся Микуле.
        // Уже начатая былина (пройденные точки, живой прогресс) не трогается.
        const untouched =
          state.darkness === 0 &&
          state.activeMissionId === null &&
          state.missions.every((mission) => mission.status !== "done") &&
          !state.fighters.some((fighter) => PROLOGUE_ROSTER.some((hero) => hero.unitId === fighter.unitId));
        if (untouched) state.fighters = prologueFighters();
      }
      state.chapter = chapter;
      emit();
    },
    getMissions: () => missions.map((mission) => ({ ...mission })),
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

      const isPrologue = state.chapter === "prologue";
      const sandbox = !isPrologue;
      const darknessGained = sandbox
        ? outcome === "victory"
          ? mission.darknessOnVictory
          : mission.darknessOnDefeat
        : 0;
      if (sandbox) {
        state.darkness = Math.min(state.darknessMax, state.darkness + darknessGained);
      }

      const rewards: Resources = sandbox && outcome === "victory" ? { ...mission.rewards } : { ...ZERO_RESOURCES };
      if (sandbox && outcome === "victory") gain(rewards);

      const fallen: string[] = [];
      const wounded: string[] = [];
      const leveledUp: string[] = [];
      const xpGains: XpGain[] = [];

      for (const participant of participants) {
        const fighter = state.fighters.find((candidate) => candidate.id === participant.fighterId);
        if (!fighter || !fighter.alive) continue;
        if (!participant.survived) {
          if (sandbox) {
            fighter.alive = false;
            fighter.hp = 0;
            fighter.equippedItemId = null;
            fallen.push(fighter.name);
          } else {
            fighter.hp = Math.max(1, participant.hp);
          }
          continue;
        }
        fighter.hp = Math.max(1, Math.min(fighter.maxHp, participant.hp));
        if (sandbox) {
          const woundedNow = fighter.hp <= fighter.maxHp * config.woundHpRatio;
          if (woundedNow && !fighter.wounded) wounded.push(fighter.name);
          fighter.wounded = fighter.wounded || woundedNow;
        }
        if (outcome === "victory") {
          if (sandbox) {
            // Песочница: опыт 100 за победу → уровень каждый раз (совместимость с тестами).
            const gainRec = applyXp(fighter, 100);
            xpGains.push(gainRec);
            if (gainRec.leveled) leveledUp.push(fighter.name);
          } else {
            // Пролог через finishMission (резерв): 50 за победу → М1 50% , М2 100% → уровень.
            const gainRec = applyXp(fighter, 50);
            xpGains.push(gainRec);
            if (gainRec.leveled) leveledUp.push(fighter.name);
          }
        } else {
          // Поражение — опыта нет, но полоса должна отобразиться нулевой прибавкой для анимации.
          xpGains.push({
            fighterId: fighter.id,
            name: fighter.name,
            levelBefore: fighter.level,
            levelAfter: fighter.level,
            xpBefore: fighter.xp ?? 0,
            xpAfter: fighter.xp ?? 0,
            gained: 0,
            leveled: false,
          });
        }
      }

      point.status = "done";
      state.activeMissionId = null;
      for (const generalId of generalDeaths ?? []) {
        if (sandbox && !state.deadGenerals.includes(generalId)) state.deadGenerals.push(generalId);
      }
      state.shipPosition = { x: mission.x, y: mission.y };

      let newRecruit: string | null = null;
      if (sandbox && outcome === "victory" && livingCount() > 0 && state.fighters.length < config.rosterCap) {
        const recruit = makeFighter(config.recruitUnitId, 1);
        state.fighters.push(recruit);
        newRecruit = recruit.name;
      }

      const campaignLost = sandbox && (state.darkness >= state.darknessMax || livingCount() === 0);
      const lostReason = sandbox
        ? state.darkness >= state.darknessMax
          ? "darkness"
          : livingCount() === 0
            ? "roster"
            : undefined
        : undefined;
      state.lastResult = {
        missionId: id,
        outcome,
        darknessGained,
        rewards,
        fallen,
        wounded,
        leveledUp,
        newRecruit,
        xpGains,
      };
      if (campaignLost) {
        state.phase = "lost";
      }
      const finalId = options.prologueFinalMissionId;
      if (isPrologue && outcome === "victory" && finalId && id === finalId) {
        openSandboxFromPrologue();
      }
      emit();
      return { darknessGained, rewards, campaignLost, lostReason, fallen, wounded, leveledUp, newRecruit, xpGains };
    },
    abandonMission: () => {
      if (state.activeMissionId === null) return;
      state.activeMissionId = null;
      emit();
    },
    scan: () => {
      if (state.chapter === "prologue") return null;
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
    openSandboxFromPrologue,
    promotePrologueHero,
    grantPrologueXp,
    assignClass: (fighterId, unitId) => {
      const fighter = state.fighters.find((candidate) => candidate.id === fighterId);
      if (!fighter || !fighter.alive) return false;
      // Пролог: крестьянин Микула считается рекрутом для стандартного окна выбора класса (0.21.27).
      const isRecruit = fighter.unitId === config.recruitUnitId || fighter.unitId === "mikula_peasant";
      if (!isRecruit) return false;
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
    getTalentOptions: talentOptions,
    getFighterTalents: (fighterId) => {
      const fighter = state.fighters.find((candidate) => candidate.id === fighterId);
      if (!fighter) return [];
      const tree = config.talents?.[fighter.unitId] ?? {};
      const all = Object.values(tree).flat();
      return fighter.talents
        .map((talentId) => all.find((talent) => talent.id === talentId))
        .filter((talent): talent is TalentConfig => talent !== undefined);
    },
    getPendingTalentChoice: () => {
      for (const fighter of state.fighters) {
        if (!fighter.alive || fighter.pendingTalentLevels.length === 0) continue;
        // Рекрут без класса сначала выбирает класс: древо зависит от него.
        if (fighter.unitId === config.recruitUnitId || fighter.unitId in PROLOGUE_CLASSLESS) continue;
        while (fighter.pendingTalentLevels.length > 0) {
          const level = fighter.pendingTalentLevels[0]!;
          const options = talentOptions(fighter.unitId, level);
          if (options.length === 2) return { fighterId: fighter.id, level, options };
          // Уровень без записей в древе — списывается без выбора.
          fighter.pendingTalentLevels.shift();
        }
      }
      return null;
    },
    chooseTalent: (fighterId, level, talentId) => {
      const fighter = state.fighters.find((candidate) => candidate.id === fighterId);
      if (!fighter || !fighter.alive) return false;
      if (!fighter.pendingTalentLevels.includes(level)) return false;
      const options = talentOptions(fighter.unitId, level);
      if (!options.some((talent) => talent.id === talentId)) return false;
      if (fighter.talents.includes(talentId)) return false;
      fighter.talents.push(talentId);
      fighter.pendingTalentLevels = fighter.pendingTalentLevels.filter((pending) => pending !== level);
      // Пассивный запас здоровья действует и вне боя: максимум растёт сразу.
      const chosen = options.find((talent) => talent.id === talentId);
      const hpBonus = chosen?.passive?.maxHpMod ?? 0;
      if (hpBonus !== 0) {
        fighter.maxHp = Math.max(1, fighter.maxHp + hpBonus);
        fighter.hp = Math.max(1, Math.min(fighter.maxHp, fighter.hp + Math.max(0, hpBonus)));
      }
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
