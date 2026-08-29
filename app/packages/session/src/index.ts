import { matchOutcome } from "@bylina/core";
import type {
  ApplyResult,
  CellPos,
  Command,
  FogState,
  GameEvent,
  HitPreview,
  MatchState,
  ReachableCell,
  SkillPreview,
  TacticsKernel,
} from "@bylina/core";
import type { CampaignApi, MissionOutcome, MissionParticipant } from "@bylina/campaign";
import { createLocalTransport, isCommandPayload, isEventBatchPayload, isSyncPayload, type Envelope, type Transport } from "@bylina/net";
import { eventsVisibleTo } from "@bylina/core";
import type { Command as ReplayCommand } from "@bylina/core";
import type { ReplayJournal } from "@bylina/replay";

export const APP_VERSION = "0.20.44";

export type AppScreen =
  | "boot"
  | "menu"
  | "settings"
  | "battle"
  | "difficulty"
  | "result"
  | "campaign"
  | "missionResult"
  | "deployment"
  | "pvpRoom"
  | "replays"
  | "training"
  | "trainingBattle";

export type GameMode = "quickMatch" | "campaign" | "pvp";

export type BattleKind = "quick" | "campaign" | "pvp" | "pvpNet" | "replay" | "training" | "prologue";

/** Сторона в поочерёдной игре на одном устройстве (0.14.0). */
export type PvpSide = 1 | 2;

export type DifficultyId = "easy" | "normal" | "hard";

export type MatchOutcome = "victory" | "defeat";

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
  paused: boolean;
  battleKind: BattleKind | null;
  difficulty: DifficultyId | null;
  /** Идентификатор активной миссии кампании. */
  activeMissionId: string | null;
  /** Состав высадки: идентификаторы бойцов дружины. */
  deployment: number[];
  matchSeed: number;
  outcome: MatchOutcome | null;
  /**
   * Восстановленная партия кампании (0.13.0). Хранится в состоянии сессии,
   * а не одноразовым запросом: BattleScreen читает её при создании ядра,
   * и повторный вызов инициализатора (StrictMode) не теряет снимок.
   */
  restoredMatch?: MatchState;
  restoredFog?: FogState;
  /** Составы сторон поочерёдной игры (0.14.0). */
  pvp?: { side1: string[]; side2: string[] } | null;
  /** Победившая сторона поочерёдной игры (экран итога). */
  pvpWinner?: PvpSide | null;
  /** Роль в сетевой игре (0.15.0/0.16.0): ведущий, ведомый либо наблюдатель. */
  netRole?: "host" | "guest" | "spectator" | null;
  /** Номер стороны ведомого в сетевой игре (0.15.0). */
  netOwner?: number | null;
  /** Условие победы состязательного боя (0.16.0): уничтожение либо вынос яблока. */
  pvpObjective?: "elimination" | "apple" | null;
  /** Полный обзор наблюдателя (0.16.0, ui-design §7). */
  netOmniscient?: boolean | null;
  /** Роль подключённого ведомого: соперник либо наблюдатель (0.16.0). */
  netPeerRole?: "guest" | "spectator" | null;
  /** Обрыв канала состязательного боя (0.17.0, ui-design §8). */
  netDisconnected?: boolean | null;
  /** Журнал повтора для воспроизведения (0.17.0). */
  replayJournal?: ReplayJournal | null;
  /**
   * Приостановленная миссия кампании (0.20.19): контекст хранится отдельно
   * от навигационных полей, и вход из меню в другие разделы (обучение,
   * быстрый матч, настройки, повторы) его не стирает — «Продолжить»
   * возвращает в миссию после любых прогулок по меню.
   */
  suspendedCampaign?: {
    activeMissionId: string;
    deployment: number[];
    matchSeed: number;
    restoredMatch?: MatchState;
    restoredFog?: FogState;
  } | null;
  /** Активная миссия обучения (0.19.0). */
  trainingMissionId?: string | null;
  /** Пройденные миссии обучения (0.19.0). */
  trainingDone?: string[];
  /** Показанные туториалы «первого раза» кампании (0.20.0): каждый показывается один раз. */
  campaignHintsDone?: string[];
  /** Каркас маршрута пролога (0.20.31). UI не подключён до Этапа 3. */
  prologueMissionId?: string | null;
  /**
   * Счётчик запусков боя (0.20.38). Прирастает при КАЖДОМ переходе в
   * сражение — в том числе когда бой начинается с уже смонтированным
   * экраном боя (цепочка миссий пролога: итог М1 → М2, повтор миссии).
   * Экран сражения держит ядро, счётчик хода, подсказку и карточку итога
   * в собственном состоянии; без новой «эпохи» оболочка не перемонтирует
   * его, и следующая миссия не начинается — игрок видит подряд итоги
   * миссий, в которые не играл.
   */
  battleEpoch?: number;
  /** Победитель завершённой партии (для сохранения повтора). */
  replayWinner?: 1 | 2 | null;
  /** Черновик журнала текущего боя (команды, seed, составы). */
  replayDraft?: {
    seed: number;
    sides: { side1: string[]; side2: string[] };
    objective: "elimination" | "apple" | null;
    commands: ReplayCommand[];
  } | null;
}

export interface SessionApi {
  get(): SessionState;
  goTo(screen: AppScreen): void;
  openQuickMatch(): void;
  selectDifficulty(id: DifficultyId): void;
  finishMatch(outcome: MatchOutcome): void;
  playAgain(): void;
  openMode(mode: GameMode): void;
  setPaused(paused: boolean): void;
  /** Регистрирует единственный автомат кампании локальной партии. */
  bindCampaign(campaign: CampaignApi): void;
  /** Открыть карту корабля (ветка «Новая былина»). */
  openCampaign(): void;
  /**
   * Продолжить былину из сохранения (0.20.15): перейти к сохранённому
   * экрану ветки кампании (карта, высадка, итог миссии, бой); бой без
   * снимка партии заменяется картой корабля. Глобальный прогресс
   * (обучение, туториалы, трудность) сохраняется.
   */
  continueCampaign(entry: CampaignContinuation): void;
  /**
   * Приостановить бой кампании, не покидая миссии (0.20.17): снимок партии
   * и туман сохраняются в состоянии сессии, экран меняет вызывающий код
   * (обычно — выход в главное меню). «Продолжить» возвращает в бой.
   */
  suspendCampaignBattle(): void;
  /**
   * Вернуться к начатой миссии кампании (0.20.17): в приостановленный бой
   * (со снимком партии), иначе — к формированию высадки, иначе — на карту
   * корабля. Завершённая миссия боем не считается.
   */
  resumeCampaign(): void;
  /**
   * Приостановить начатую миссию кампании и вернуться на карту корабля,
   * не покидая миссии (0.20.18): снимок партии (если бой идёт) и туман
   * сохраняются в состоянии сессии. Используется кнопками «К карте
   * корабля» паузы боя и «Назад к карте» экрана высадки — покинуть
   * миссию можно только явно с карты.
   */
  suspendCampaignMission(): void;
  /**
   * Выход с карты корабля в главное меню с сохранением контекста начатой
   * миссии (0.20.18): «Продолжить» возвращает в миссию и после захода
   * на карту. Вне начатой миссии эквивалентен обычному переходу в меню.
   */
  campaignToMenu(): void;
  /** Погасить слот приостановленной миссии (новая былина, 0.20.19). */
  clearSuspendedCampaign(): void;
  /** Начать доступную миссию и открыть формирование высадки. */
  startCampaignMission(missionId: string): boolean;
  /** Подтвердить высадку (от 1 до 5 живых бойцов) и перейти в сражение. */
  confirmDeployment(fighterIds: number[]): boolean;
  /** Завершить активную миссию исходом и исходом участников высадки. */
  finishCampaignMission(
    outcome: MissionOutcome,
    participants: MissionParticipant[],
    generalDeaths?: string[],
  ): CampaignFinishInfo | null;
  /** Покинуть начатую миссию без последствий и вернуться на карту. */
  leaveCampaignMission(): void;
  /** Вернуться на карту корабля с экрана итога миссии. */
  backToCampaign(): void;
  getCampaign(): CampaignApi;
  /** Регистрирует единственное ведущее ядро текущего локального боя. */
  bindTacticsHost(host: TacticsKernel): void;
  /** Единственный путь изменения тактического состояния из интерфейса. */
  applyBattleCommand(command: Command): ApplyResult;
  /** Отладочная автопобеда текущего боя (только для разработки и QA). */
  debugAutoWinBattle(): ApplyResult;
  getBattleSnapshot(owner: number): MatchState;
  getBattleReachable(actorId: number): ReachableCell[];
  getBattlePath(actorId: number, to: CellPos): { path: CellPos[]; mpCost: number; apCost: 1 | 2 } | null;
  getBattleHitPreview(actorId: number, targetId: number, weaponId?: string): HitPreview;
  getBattleSkillPreview(actorId: number, skillId: string, targetId?: number, targetPos?: CellPos): SkillPreview;
  getBattleVisible(owner: number): Set<string>;
  getBattleExplored(owner: number): Set<string>;
  getBattleOutcome(): "ongoing" | "victory" | "defeat";
  /** Полный снимок ведущего для сохранения партии (0.13.0). */
  getBattleFullSnapshot(): MatchState | null;
  /** Полный туман войны всех сторон для сохранения партии (0.13.0). */
  getBattleFog(): FogState | null;
  /** Открыть комнату сбора поочерёдной игры (0.14.0). */
  openPvpRoom(): void;
  /** Начать поочерёдный бой: составы сторон, условие победы (0.16.0). */
  startPvpBattle(side1: string[], side2: string[], seed: number, options?: { objective?: "elimination" | "apple" }): void;
  /** Составы сторон текущего поочерёдного боя. */
  getPvpSides(): { side1: string[]; side2: string[] } | null;
  /** Отправить команду активной стороны через локальный транспорт (0.14.0). */
  sendPvpCommand(command: Command): void;
  /** Подписка на наборы событий поочерёдного боя (ведущий рассылает через транспорт). */
  subscribePvpEvents(listener: (events: GameEvent[]) => void): () => void;
  /** Завершить поочерёдный бой победой стороны. */
  finishPvpMatch(winnerSide: PvpSide): void;
  /** Ведущий: начать сетевой бой (0.15.0). Транспорт и роли уже установлены комнатой. */
  startNetPvpBattle(
    sides: { side1: string[]; side2: string[] },
    seed: number,
    transport: Transport,
    options?: { objective?: "elimination" | "apple"; peerRole?: "guest" | "spectator"; omniscient?: boolean },
  ): void;
  /** Ведомый: зарегистрировать сетевой бой (0.15.0); ядро не исполняется, снимок — от ведущего. */
  bindGuestNetPvp(owner: number, transport: Transport): void;
  /** Сетевой: снимок стороны (у ведомого — кэш последнего SYNC_PAYLOAD). */
  getNetSnapshot(): MatchState | null;
  /** Сетевой: видимые/разведанные клетки ведомого (из снимка ведущего). */
  getNetVisible(): Set<string>;
  getNetExplored(): Set<string>;
  /** Сетевой ведомый: команда уходит ведущему; события и снимок вернутся асинхронно. */
  sendNetCommand(command: Command): void;
  /** Сетевой ведомый: запрос предпросмотра достижимости (кэш ответа ведущего). */
  requestNetReachable(actorId: number): ReachableCell[];
  /** Сетевой ведомый: запрос предпросмотра попадания. */
  requestNetHitPreview(actorId: number, targetId: number, weaponId?: string): HitPreview | null;
  /** Сетевой ведомый: дождаться начального снимка ведущего. */
  waitForNetSync(): Promise<boolean>;
  /** Зарегистрировать наблюдателя (0.16.0): получает объединение сведений сторон, команд не шлёт. */
  bindNetSpectator(transport: Transport): void;
  /** Переключатель полного обзора наблюдателя (0.16.0). */
  setNetOmniscient(omniscient: boolean): void;
  /** Зафиксировать обрыв канала состязательного боя (0.17.0). */
  setNetDisconnected(disconnected: boolean): void;
  /** Черновик журнала текущего боя (0.17.0): команды и параметры партии. */
  getReplayDraft(): SessionState["replayDraft"];
  /** Очистить черновик журнала после сохранения повтора (0.17.0). */
  setReplayDraft(draft: SessionState["replayDraft"]): void;
  /** Завершить журнал текущего боя победой стороны (0.17.0). */
  finishReplayDraft(winner: 1 | 2 | null): void;
  /** Открыть воспроизведение сохранённого повтора (0.17.0). */
  startReplay(journal: ReplayJournal): void;
  /** Открыть экран обучения (0.19.0). */
  openTraining(): void;
  /** Начать миссию обучения (0.19.0). */
  startTrainingMission(missionId: string): boolean;
  /** Отметить миссию обучения пройденной (0.19.0). */
  completeTrainingMission(missionId: string): void;
  /** Сбросить прогресс обучения (0.20.2): все миссии снова считаются непройденными. */
  resetTrainingProgress(): void;
  /** Был ли показан туториал кампании с данным идентификатором (0.20.0). */
  isCampaignHintShown(hintId: string): boolean;
  /** Отметить туториал кампании показанным — повторно не появляется (0.20.0). */
  markCampaignHintShown(hintId: string): void;
  /**
   * Каркас старта миссии пролога (0.20.31). При `enabled: false` — no-op
   * (поведение идентично 0.20.30). Экраны пролога — Этап 2–3.
   */
  startPrologue(missionId: string, enabled: boolean): boolean;
  /** Следующая миссия пролога либо карта кампании. */
  advancePrologue(nextMissionId: string | null): boolean;
  /** Снимок чекпоинта боя (не пишется в журнал повтора). */
  saveBattleCheckpoint(): boolean;
  restoreBattleCheckpoint(): boolean;
  hasBattleCheckpoint(): boolean;
  subscribeBattle(listener: () => void): () => void;
  subscribe(listener: (state: SessionState) => void): () => void;
}

/**
 * Фоновое состояние переходов между экранами. `trainingDone` и
 * `campaignHintsDone` в нём намеренно отсутствуют (0.19.1/0.20.0): прогресс
 * обучения и туториалов постоянен — переходы между экранами не должны его
 * сбрасывать, а `emit` сохраняет значение из текущего состояния.
 */
const idle: Omit<SessionState, "screen" | "trainingDone" | "campaignHintsDone" | "suspendedCampaign"> = {
  paused: false,
  battleKind: null,
  difficulty: null,
  activeMissionId: null,
  deployment: [],
  matchSeed: 0,
  outcome: null,
  pvp: null,
  pvpWinner: null,
  netRole: null,
  netOwner: null,
  pvpObjective: null,
  netOmniscient: null,
  netPeerRole: null,
  netDisconnected: null,
  replayJournal: null,
  replayDraft: null,
  trainingMissionId: null,
  prologueMissionId: null,
};

/**
 * Продолжение былины из сохранения (0.20.15): контекст сессии, в котором
 * игра была сохранена. Прикладывается при нажатии «Продолжить» в главном
 * меню — до этого сессия стартует в меню, состояние кампании не загружено.
 */
export interface CampaignContinuation {
  /** Сохранённый экран ветки кампании. */
  screen: "campaign" | "deployment" | "missionResult" | "battle";
  activeMissionId?: string | null;
  deployment?: number[];
  matchSeed?: number;
  outcome?: MatchOutcome | null;
  /** Восстановленная партия (для экрана сражения). */
  restoredMatch?: MatchState;
  restoredFog?: FogState;
}

/** Экран активного тактического боя: обычное сражение и сражение обучения. */
export function isBattleScreen(screen: string): boolean {
  return screen === "battle" || screen === "trainingBattle";
}

export function createSession(
  initial: AppScreen = "boot",
  restored?: Partial<Omit<SessionState, "screen">>,
): SessionApi {
  let state: SessionState = { screen: initial, trainingDone: [], campaignHintsDone: [], ...idle, ...(restored ?? {}) };
  let battleCheckpoint: { match: MatchState; fog: FogState } | null = null;
  let tacticsHost: TacticsKernel | null = null;
  let campaign: CampaignApi | null = null;
  /** Локальный транспорт поочерёдной игры: команды сторон → ведущий → события (0.14.0). */
  let pvpTransport: ReturnType<typeof createLocalTransport> | null = null;
  /** Транспорт сетевой игры у ведущего (0.15.0). */
  let netHostTransport: Transport | null = null;
  /** Состояние ведомого сетевой игры: кэш снимка и ответов предпросмотра (0.15.0). */
  let netGuest: {
    transport: Transport;
    owner: number;
    snapshot: MatchState | null;
    visible: Set<string>;
    explored: Set<string>;
    reachable: Map<number, ReachableCell[]>;
    hit: Map<string, HitPreview>;
  } | null = null;
  /** Подписчики боевых обновлений (ядро у ведущего, кэш у ведомого). */
  const battleListeners = new Set<() => void>();
  const notifyBattle = (): void => {
    for (const listener of battleListeners) listener();
  };
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
    // Прогресс обучения и туториалов постоянен: если очередное состояние не
    // несёт явных значений (переходы навигации через idle), сохраняются
    // текущие — отметки не теряются между экранами (0.19.1, 0.20.0).
    state = {
      ...next,
      trainingDone: next.trainingDone ?? state.trainingDone ?? [],
      campaignHintsDone: next.campaignHintsDone ?? state.campaignHintsDone ?? [],
      // Слот приостановленной миссии постоянен (0.20.19): навигация через
      // idle его не несёт — сохраняется текущий; очищается только явно
      // (null в next: покинута миссия, завершена, новая былина).
      suspendedCampaign: Object.prototype.hasOwnProperty.call(next, "suspendedCampaign")
        ? next.suspendedCampaign ?? null
        : state.suspendedCampaign ?? null,
    };
    for (const listener of listeners) listener(state);
  };

  /**
   * Переход в сражение (0.20.38): единственный канал запуска боя. Помимо
   * навигации он открывает новую «эпоху» экрана — счётчик, по которому
   * оболочка перемонтирует экран боя. Ядро партии, счётчик хода, подсказка
   * обучения и карточка миссии живут в состоянии компонента, поэтому вход
   * в следующий бой с тем же экраном (цепочка миссий пролога, повтор
   * миссии, «ещё раз») обязан дать компоненту новый ключ — иначе бой
   * продолжается на поле предыдущей миссии.
   */
  const openBattle = (next: SessionState): void => {
    emit({ ...next, battleEpoch: (state.battleEpoch ?? 0) + 1 });
  };

  /** Ведущий: снимок подключённого (0.15.0/0.16.0). Гость получает свою сторону
   *  по зрению; наблюдатель — объединение сведений сторон либо полный обзор. */
  const sendGuestSync = (): void => {
    if (!tacticsHost || !netHostTransport) return;
    if (state.netPeerRole === "spectator") {
      const full = tacticsHost.getSnapshot();
      if (state.netOmniscient === true) {
        netHostTransport.send({
          type: "SYNC_PAYLOAD",
          senderId: "host",
          timestamp: Date.now(),
          payload: {
            match: full,
            visible: [...tacticsHost.getVisibleCells(1), ...tacticsHost.getVisibleCells(2)],
            explored: [...tacticsHost.getExploredCells(1), ...tacticsHost.getExploredCells(2)],
          },
        });
        return;
      }
      const vis1 = tacticsHost.getVisibleCells(1);
      const vis2 = tacticsHost.getVisibleCells(2);
      const exp1 = tacticsHost.getExploredCells(1);
      const exp2 = tacticsHost.getExploredCells(2);
      const explored = new Set([...exp1, ...exp2]);
      const unionEntities = full.entities.filter((entity) => {
        if (entity.owner === 0) return explored.has(`${entity.x},${entity.y}`);
        if (entity.owner === 1) return vis1.has(`${entity.x},${entity.y}`) && !entity.hidden;
        if (entity.owner === 2) return vis2.has(`${entity.x},${entity.y}`) && !entity.hidden;
        return false;
      });
      netHostTransport.send({
        type: "SYNC_PAYLOAD",
        senderId: "host",
        timestamp: Date.now(),
        payload: {
          match: { ...full, entities: unionEntities },
          visible: [...new Set([...vis1, ...vis2])],
          explored: [...explored],
        },
      });
      return;
    }
    // Соперник: сторона 2 по зрению.
    netHostTransport.send({
      type: "SYNC_PAYLOAD",
      senderId: "host",
      timestamp: Date.now(),
      payload: {
        match: tacticsHost.getSnapshotFor(2),
        visible: [...tacticsHost.getVisibleCells(2)],
        explored: [...tacticsHost.getExploredCells(2)],
      },
    });
  };

  /** Ведущий: запросы предпросмотра ведомого (network-protocol.md §4). */
  const handleGuestQuery = (message: Envelope): void => {
    if (!tacticsHost || !netHostTransport) return;
    const query = message.payload as { type: "REACHABLE" | "HIT"; actorId: number; targetId?: number; weaponId?: string };
    if (query.type === "REACHABLE") {
      netHostTransport.send({
        type: "QUERY_RESULT",
        senderId: "host",
        timestamp: Date.now(),
        payload: { type: "REACHABLE", actorId: query.actorId, cells: tacticsHost.getReachable(query.actorId) },
      });
    } else if (query.type === "HIT" && query.targetId !== undefined) {
      netHostTransport.send({
        type: "QUERY_RESULT",
        senderId: "host",
        timestamp: Date.now(),
        payload: { type: "HIT", actorId: query.actorId, targetId: query.targetId, weaponId: query.weaponId, preview: tacticsHost.getHitPreview(query.actorId, query.targetId, query.weaponId) },
      });
    }
  };

  /** Ведомый: применить ответ предпросмотра в кэш. */
  const applyGuestQueryResult = (payload: unknown): void => {
    if (!netGuest) return;
    const result = payload as { type: "REACHABLE" | "HIT"; actorId: number; targetId?: number; weaponId?: string; cells?: ReachableCell[]; preview?: HitPreview };
    if (result.type === "REACHABLE" && result.cells) {
      netGuest.reachable.set(result.actorId, result.cells);
    } else if (result.type === "HIT" && result.preview && result.targetId !== undefined) {
      netGuest.hit.set(`${result.actorId}:${result.targetId}:${result.weaponId ?? ""}`, result.preview);
    }
    notifyBattle();
  };

  return {
    get: () => state,
    goTo: (screen) => {
      if (screen !== "battle") {
        pvpTransport = null;
        netHostTransport = null;
        netGuest = null;
      }
      emit({ screen, ...idle });
    },
    openQuickMatch: () => {
      emit({ ...idle, screen: "difficulty" });
    },
    selectDifficulty: (id) => {
      openBattle({
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
      // Состязательный режим открыт с версии 0.14.0 (поочерёдная игра).
      if (mode === "pvp") {
        emit({ ...idle, screen: "pvpRoom" });
        return;
      }
      // Все режимы перечислены выше; иных значений у `GameMode` нет.
    },
    openPvpRoom: () => {
      emit({ ...idle, screen: "pvpRoom" });
    },
    setPaused: (paused) => {
      if (!isBattleScreen(state.screen)) return;
      emit({ ...state, paused });
    },
    bindCampaign: (automaton) => {
      campaign = automaton;
      if (state.battleKind === "prologue" && campaign.getState().chapter !== "prologue") {
        campaign.setChapter("prologue");
      }
    },
    openCampaign: () => {
      emit({ ...idle, screen: "campaign" });
    },
    continueCampaign: (entry) => {
      // Бой восстанавливается только со снимком партии: без ядра и снимка
      // BattleScreen не смонтируется — возвращаемся на карту корабля.
      const screen =
        entry.screen === "battle" && !entry.restoredMatch ? "campaign" : entry.screen;
      const open = screen === "battle" ? openBattle : emit;
      open({
        ...idle,
        screen,
        battleKind: screen === "battle" ? "campaign" : null,
        activeMissionId: entry.activeMissionId ?? null,
        deployment: entry.deployment ?? [],
        matchSeed: entry.matchSeed ?? 0,
        outcome: entry.outcome ?? null,
        difficulty: state.difficulty,
        trainingDone: state.trainingDone ?? [],
        campaignHintsDone: state.campaignHintsDone ?? [],
        restoredMatch: screen === "battle" ? entry.restoredMatch : undefined,
        restoredFog: screen === "battle" ? entry.restoredFog : undefined,
      });
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
        suspendedCampaign: null,
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
      // Границы численности высадки задаются конфигурацией кампании (content-schema §4).
      const limits = requireCampaign().getDeployLimits();
      // One fighter may occupy one deployment slot only; duplicate IDs would otherwise
      // create duplicate entities despite passing the roster-size check.
      const unique = new Set(fighterIds).size === fighterIds.length;
      if (!unique || !alive || fighterIds.length < limits.min || fighterIds.length > limits.max) return false;
      openBattle({ ...state, screen: "battle", deployment: [...fighterIds] });
      return true;
    },
    finishCampaignMission: (outcome, participants, generalDeaths) => {
      const active = state.activeMissionId;
      if (state.battleKind !== "campaign" || active === null) return null;
      const result = requireCampaign().finishMission(active, outcome, participants, generalDeaths);
      if (!result) return null;
      emit({ ...state, screen: "missionResult", paused: false, outcome, suspendedCampaign: null });
      return result;
    },
    leaveCampaignMission: () => {
      requireCampaign().abandonMission();
      emit({ ...idle, screen: "campaign", suspendedCampaign: null });
    },
    clearSuspendedCampaign: () => {
      // Новая былина (0.20.19): слот прошлая mission больше не относится
      // к свежему автомату кампании.
      emit({ ...state, suspendedCampaign: null });
    },
    suspendCampaignBattle: () => {
      if (state.battleKind === "prologue" && state.prologueMissionId) {
        const snapshot = tacticsHost ? tacticsHost.getSnapshot() : state.restoredMatch;
        const fog = tacticsHost ? tacticsHost.getFog() : state.restoredFog;
        emit({
          screen: "menu",
          ...idle,
          prologueMissionId: state.prologueMissionId,
          suspendedCampaign: {
            activeMissionId: state.prologueMissionId,
            deployment: [],
            matchSeed: state.matchSeed,
            restoredMatch: snapshot ?? state.restoredMatch,
            restoredFog: fog ?? state.restoredFog,
          },
        });
        return;
      }
      if (state.battleKind !== "campaign" || state.activeMissionId === null) {
        // Не бой кампании — обычный выход в меню; слот приостановленной
        // миссии (если был) сохраняется — emit не стирает его.
        emit({ screen: "menu", ...idle });
        return;
      }
      // Снимок партии и туман — в слот приостановленной миссии (0.20.19):
      // навигационные поля обнуляются (idle), поэтому дальнейшие заходы в
      // обучение/быстрый матч/настройки из меню контекст не потеряют.
      const snapshot = tacticsHost ? tacticsHost.getSnapshot() : state.restoredMatch;
      const fog = tacticsHost ? tacticsHost.getFog() : state.restoredFog;
      emit({
        screen: "menu",
        ...idle,
        suspendedCampaign: {
          activeMissionId: state.activeMissionId,
          deployment: state.deployment,
          matchSeed: state.matchSeed,
          restoredMatch: snapshot ?? state.restoredMatch,
          restoredFog: fog ?? state.restoredFog,
        },
      });
    },
    resumeCampaign: () => {
      const slot = state.suspendedCampaign ?? null;
      if (slot && slot.activeMissionId.startsWith("prologue_")) {
        openBattle({
          ...idle,
          screen: "battle",
          battleKind: "prologue",
          prologueMissionId: slot.activeMissionId,
          matchSeed: slot.matchSeed,
          restoredMatch: slot.restoredMatch,
          restoredFog: slot.restoredFog,
          suspendedCampaign: null,
        });
        return;
      }
      const active = requireCampaign().getState().activeMissionId;
      // Слот действителен, только пока миссия начата в автомате кампании:
      // завершённая либо покинутая миссия боем/высадкой не считается.
      if (slot && slot.activeMissionId === active) {
        if (slot.restoredMatch) {
          openBattle({
            ...idle,
            screen: "battle",
            battleKind: "campaign",
            activeMissionId: slot.activeMissionId,
            deployment: slot.deployment,
            matchSeed: slot.matchSeed,
            outcome: null,
            restoredMatch: slot.restoredMatch,
            restoredFog: slot.restoredFog,
            suspendedCampaign: null,
          });
          return;
        }
        emit({
          ...idle,
          screen: "deployment",
          battleKind: "campaign",
          activeMissionId: slot.activeMissionId,
          deployment: slot.deployment,
          matchSeed: slot.matchSeed,
          outcome: null,
          suspendedCampaign: null,
        });
        return;
      }
      emit({ ...idle, screen: "campaign", suspendedCampaign: null });
    },
    suspendCampaignMission: () => {
      if (state.battleKind !== "campaign" || state.activeMissionId === null) {
        emit({ ...idle, screen: "campaign" });
        return;
      }
      // Боевой снимок берётся, пока ядро привязано; экран высадки снимка
      // не имеет — миссия возобновится с формирования высадки. Контекст —
      // в слоте (0.20.19), навигационные поля чистые.
      const snapshot = tacticsHost ? tacticsHost.getSnapshot() : state.restoredMatch;
      const fog = tacticsHost ? tacticsHost.getFog() : state.restoredFog;
      emit({
        ...idle,
        screen: "campaign",
        suspendedCampaign: {
          activeMissionId: state.activeMissionId,
          deployment: state.deployment,
          matchSeed: state.matchSeed,
          restoredMatch: snapshot ?? state.restoredMatch,
          restoredFog: fog ?? state.restoredFog,
        },
      });
    },
    campaignToMenu: () => {
      // Слот приостановленной миссии не зависит от навигации (0.20.19);
      // здесь достаточно чистого перехода в меню.
      emit({ screen: "menu", ...idle });
    },
    backToCampaign: () => {
      emit({ ...idle, screen: "campaign" });
    },
    getCampaign: () => requireCampaign(),
    startPvpBattle: (side1, side2, seed, options?: { objective?: "elimination" | "apple" }) => {
      state = { ...state, replayDraft: { seed, sides: { side1: [...side1], side2: [...side2] }, objective: options?.objective ?? null, commands: [] }, netDisconnected: null };
      // Локальный транспорт: обе стороны на одном устройстве, правила
      // исполняет ведущий (этот же процесс). Команда стороны применяется
      // ядром, набор событий рассылается обратно через транспорт.
      const transport = createLocalTransport();
      pvpTransport = transport;
      transport.subscribe((message: Envelope) => {
        if (message.type !== "COMMAND" || !isCommandPayload(message.payload)) return;
        const command = message.payload as Command;
        state = { ...state, replayDraft: state.replayDraft ? { ...state.replayDraft, commands: [...state.replayDraft.commands, command] } : state.replayDraft };
        const applied = tacticsHost?.apply(command);
        if (!applied) return;
        if (applied.ok) {
          transport.send({
            type: "EVENT_BATCH",
            senderId: "host",
            timestamp: Date.now(),
            payload: applied.events,
          });
        } else {
          transport.send({
            type: "REJECT",
            senderId: "host",
            timestamp: Date.now(),
            payload: { commandType: (message.payload as Command).type, reason: applied.reason },
          });
        }
      });
      openBattle({
        ...idle,
        screen: "battle",
        battleKind: "pvp",
        matchSeed: seed,
        pvp: { side1: [...side1], side2: [...side2] },
        pvpWinner: null,
        pvpObjective: options?.objective ?? null,
      });
    },
    getPvpSides: () => (state.pvp ? { side1: [...state.pvp.side1], side2: [...state.pvp.side2] } : null),
    sendPvpCommand: (command) => {
      if (!pvpTransport || state.screen !== "battle" || state.battleKind !== "pvp") return;
      // Отправитель — активная сторона: ядро само проверит право хода.
      const senderId = String(tacticsHost?.getSnapshot().activeOwner ?? 1);
      pvpTransport.send({ type: "COMMAND", senderId, timestamp: Date.now(), payload: command });
    },
    subscribePvpEvents: (listener) => {
      if (netGuest) {
        return netGuest.transport.subscribe((message: Envelope) => {
          if (message.type === "EVENT_BATCH" && isEventBatchPayload(message.payload)) listener(message.payload as GameEvent[]);
        });
      }
      if (!pvpTransport) return () => undefined;
      return pvpTransport.subscribe((message: Envelope) => {
        if (message.type === "EVENT_BATCH" && isEventBatchPayload(message.payload)) listener(message.payload as GameEvent[]);
      });
    },
    finishPvpMatch: (winnerSide) => {
      emit({
        ...state,
        screen: "result",
        paused: false,
        pvpWinner: winnerSide,
        outcome: winnerSide === 1 ? "victory" : "defeat",
        // Победитель фиксируется для сохранения повтора (0.17.0).
        replayWinner: winnerSide,
      });
    },
    startNetPvpBattle: (sides, seed, transport, options?: { objective?: "elimination" | "apple"; peerRole?: "guest" | "spectator"; omniscient?: boolean }) => {
      state = { ...state, replayDraft: { seed, sides: { side1: [...sides.side1], side2: [...sides.side2] }, objective: options?.objective ?? null, commands: [] }, netDisconnected: null };
      netHostTransport = transport;
      // Ведущий исполняет правила: команды ведомого применяются ядром,
      // события и снимок стороны ведомого уходят по каналу.
      transport.subscribe((message) => {
        if (message.type === "SYNC_REQUEST") {
          // Роль подключающегося определяет сам участник (technology §1):
          // наблюдатель запускает приложение с ролью наблюдателя.
          const requested = (message.payload as { role?: string } | null)?.role;
          if (requested === "spectator" || requested === "guest") {
            emit({ ...state, netPeerRole: requested });
          }
          sendGuestSync();
          return;
        }
        if (message.type === "QUERY") {
          handleGuestQuery(message);
          return;
        }
        if (message.type !== "COMMAND" || !isCommandPayload(message.payload)) return;
        const command = message.payload as Command;
        state = { ...state, replayDraft: state.replayDraft ? { ...state.replayDraft, commands: [...state.replayDraft.commands, command] } : state.replayDraft };
        // Ведомый управляет только своей стороной (номер 2): чужие ходы
        // отклоняются, даже если команда формально допустима.
        const guestOwner = 2;
        const actor = command.type === "END_TURN"
          ? undefined
          : tacticsHost?.getSnapshot().entities.find((entity) => entity.id === command.actorId);
        const ownerOk = command.type === "END_TURN"
          ? command.playerId === String(guestOwner)
          : actor?.owner === guestOwner;
        if (!ownerOk) {
          transport.send({
            type: "REJECT",
            senderId: "host",
            timestamp: Date.now(),
            payload: { commandType: command.type, reason: "NOT_YOUR_TURN" },
          });
          return;
        }
        const applied = tacticsHost?.apply(command);
        if (!applied) return;
        if (applied.ok) {
          // Сокращение пакетов по зрению (network-protocol.md §5):
          // ведомому — только события, видимые его стороне.
          const guestEvents = tacticsHost
            ? eventsVisibleTo(applied.events, tacticsHost.getSnapshot(), tacticsHost.getFog(), 2)
            : applied.events;
          transport.send({ type: "EVENT_BATCH", senderId: "host", timestamp: Date.now(), payload: guestEvents });
          sendGuestSync();
        } else {
          transport.send({
            type: "REJECT",
            senderId: "host",
            timestamp: Date.now(),
            payload: { commandType: (message.payload as Command).type, reason: applied.reason },
          });
        }
      });
      openBattle({
        ...idle,
        screen: "battle",
        battleKind: "pvpNet",
        matchSeed: seed,
        pvp: { side1: [...sides.side1], side2: [...sides.side2] },
        pvpWinner: null,
        netRole: "host",
        netOwner: 1,
        pvpObjective: options?.objective ?? null,
        netOmniscient: options?.omniscient ?? false,
        netPeerRole: options?.peerRole ?? "guest",
      });
    },
    bindGuestNetPvp: (owner, transport) => {
      netGuest = {
        transport,
        owner,
        snapshot: null,
        visible: new Set(),
        explored: new Set(),
        reachable: new Map(),
        hit: new Map(),
      };
      openBattle({
        ...idle,
        screen: "battle",
        battleKind: "pvpNet",
        matchSeed: 0,
        pvp: null,
        pvpWinner: null,
        netRole: "guest",
        netOwner: owner,
      });
      transport.subscribe((message) => {
        if (message.type === "SYNC_PAYLOAD" && isSyncPayload(message.payload)) {
          const payload = message.payload as { match: MatchState; visible: string[]; explored: string[] };
          if (!netGuest) return;
          netGuest.snapshot = payload.match;
          netGuest.visible = new Set(payload.visible ?? []);
          netGuest.explored = new Set(payload.explored ?? []);
          notifyBattle();
        } else if (message.type === "QUERY_RESULT") {
          applyGuestQueryResult(message.payload);
        }
      });
      // Запрос начального снимка у ведущего (роль — соперник).
      transport.send({ type: "SYNC_REQUEST", senderId: "guest", timestamp: Date.now(), payload: { role: "guest" } });
    },
    getNetSnapshot: () => netGuest?.snapshot ?? null,
    getNetVisible: () => new Set(netGuest?.visible ?? []),
    getNetExplored: () => new Set(netGuest?.explored ?? []),
    sendNetCommand: (command) => {
      if (!netGuest || state.netRole === "spectator") return;
      netGuest.transport.send({ type: "COMMAND", senderId: "guest", timestamp: Date.now(), payload: command });
    },
    requestNetReachable: (actorId) => {
      if (!netGuest) return [];
      const cached = netGuest.reachable.get(actorId);
      netGuest.transport.send({
        type: "QUERY",
        senderId: "guest",
        timestamp: Date.now(),
        payload: { type: "REACHABLE", actorId },
      });
      return cached ?? [];
    },
    requestNetHitPreview: (actorId, targetId, weaponId) => {
      if (!netGuest) return null;
      const key = `${actorId}:${targetId}:${weaponId ?? ""}`;
      const cached = netGuest.hit.get(key);
      netGuest.transport.send({
        type: "QUERY",
        senderId: "guest",
        timestamp: Date.now(),
        payload: { type: "HIT", actorId, targetId, weaponId },
      });
      return cached ?? null;
    },
    waitForNetSync: () =>
      new Promise((resolve) => {
        if (netGuest?.snapshot) {
          resolve(true);
          return;
        }
        // Поллинг без window: метод работает и в среде без обозревателя
        // (автоматические проверки канала, Node-тесты).
        const started = Date.now();
        const timer = setInterval(() => {
          if (netGuest?.snapshot) {
            clearInterval(timer);
            resolve(true);
          } else if (Date.now() - started >= 5000) {
            clearInterval(timer);
            resolve(Boolean(netGuest?.snapshot));
          }
        }, 50);
      }),
    bindNetSpectator: (transport) => {
      netGuest = {
        transport,
        owner: 0,
        snapshot: null,
        visible: new Set(),
        explored: new Set(),
        reachable: new Map(),
        hit: new Map(),
      };
      openBattle({
        ...idle,
        screen: "battle",
        battleKind: "pvpNet",
        matchSeed: 0,
        pvp: null,
        pvpWinner: null,
        netRole: "spectator",
        netOwner: 0,
        pvpObjective: null,
        netOmniscient: false,
        netPeerRole: null,
      });
      transport.subscribe((message) => {
        if (message.type === "SYNC_PAYLOAD" && isSyncPayload(message.payload)) {
          const payload = message.payload as { match: MatchState; visible: string[]; explored: string[] };
          if (!netGuest) return;
          netGuest.snapshot = payload.match;
          netGuest.visible = new Set(payload.visible ?? []);
          netGuest.explored = new Set(payload.explored ?? []);
          notifyBattle();
        }
      });
      transport.send({ type: "SYNC_REQUEST", senderId: "spectator", timestamp: Date.now(), payload: { role: "spectator" } });
    },
    setNetOmniscient: (omniscient) => {
      emit({ ...state, netOmniscient: omniscient });
      // Немедленно обновить снимок наблюдателя.
      if (tacticsHost && netHostTransport) sendGuestSync();
    },
    setNetDisconnected: (disconnected) => {
      emit({ ...state, netDisconnected: disconnected });
    },
    getReplayDraft: () => (state.replayDraft ? { ...state.replayDraft, sides: { side1: [...state.replayDraft.sides.side1], side2: [...state.replayDraft.sides.side2] }, commands: [...state.replayDraft.commands] } : null),
    setReplayDraft: (draft) => {
      emit({ ...state, replayDraft: draft });
    },
    finishReplayDraft: (winner) => {
      emit({ ...state, replayWinner: winner });
    },
    startReplay: (journal) => {
      openBattle({ ...idle, screen: "battle", battleKind: "replay", replayJournal: journal });
    },
    openTraining: () => {
      emit({ ...idle, screen: "training" });
    },
    startTrainingMission: (missionId) => {
      if (!["movement", "combat", "skills"].includes(missionId)) return false;
      // Окружение обучения фиксировано: постоянный seed даёт одну и ту же
      // карту при каждом прохождении (game-design §3.5, доработка обучения).
      // Без фиксации генератор строил бы новое поле на каждом запуске.
      // «Бой» (0.20.2): подобрано окружение, где упырь действительно стоит
      // за укрытием, а игрок появляется на возвышении — текст подсказки про
      // укрытие и высоту соответствует полю (см. тесты обучения).
      const TRAINING_SEED = { movement: 101, combat: 46, skills: 303 } as const;
      openBattle({
        ...idle,
        screen: "trainingBattle",
        battleKind: "training",
        trainingMissionId: missionId,
        matchSeed: TRAINING_SEED[missionId as keyof typeof TRAINING_SEED] ?? 1,
      });
      return true;
    },
    completeTrainingMission: (missionId) => {
      const done = state.trainingDone ?? [];
      if (done.includes(missionId)) return;
      emit({ ...state, trainingDone: [...done, missionId] });
    },
    resetTrainingProgress: () => {
      emit({ ...state, trainingDone: [] });
    },
    isCampaignHintShown: (hintId) => (state.campaignHintsDone ?? []).includes(hintId),
    markCampaignHintShown: (hintId) => {
      const done = state.campaignHintsDone ?? [];
      if (done.includes(hintId)) return;
      emit({ ...state, campaignHintsDone: [...done, hintId] });
    },
    startPrologue: (missionId, enabled) => {
      if (!enabled) return false;
      if (campaign && campaign.getState().chapter !== "prologue") campaign.setChapter("prologue");
      const SEED: Record<string, number> = {
        prologue_brushwood: 701,
        prologue_cry: 702,
        prologue_glade: 703,
        prologue_village: 704,
      };
      openBattle({
        ...idle,
        screen: "battle",
        battleKind: "prologue",
        prologueMissionId: missionId,
        matchSeed: SEED[missionId] ?? 701,
        suspendedCampaign: null,
      });
      return true;
    },
    advancePrologue: (nextMissionId) => {
      if (!nextMissionId) {
        campaign?.openSandboxFromPrologue();
        emit({ ...idle, screen: "campaign", prologueMissionId: null });
        return true;
      }
      const SEED: Record<string, number> = {
        prologue_brushwood: 701,
        prologue_cry: 702,
        prologue_glade: 703,
        prologue_village: 704,
      };
      openBattle({
        ...idle,
        screen: "battle",
        battleKind: "prologue",
        prologueMissionId: nextMissionId,
        matchSeed: SEED[nextMissionId] ?? 701,
        suspendedCampaign: null,
      });
      return true;
    },
    saveBattleCheckpoint: () => {
      if (!tacticsHost) return false;
      battleCheckpoint = {
        match: tacticsHost.getSnapshot(),
        fog: tacticsHost.getFog(),
      };
      return true;
    },
    restoreBattleCheckpoint: () => {
      if (!tacticsHost || !battleCheckpoint) return false;
      tacticsHost.restoreMatch(battleCheckpoint.match, battleCheckpoint.fog);
      notifyBattle();
      return true;
    },
    hasBattleCheckpoint: () => battleCheckpoint !== null,
    bindTacticsHost: (host) => {
      tacticsHost = host;
      // Сетевой ведущий: ядро создано (BattleScreen смонтирован) — ведомый
      // получает первый снимок, если ещё не получил.
      if (netHostTransport && state.battleKind === "pvpNet") sendGuestSync();
    },
    applyBattleCommand: (command) => {
      // Единственный путь изменения тактического состояния из интерфейса.
      // Работает и в обучении (экран trainingBattle): иначе команды игрока
      // в миссиях обучения отклонялись бы и подсказки не продвигались (0.20.1).
      if (!tacticsHost || !isBattleScreen(state.screen)) return { ok: false, reason: "ILLEGAL" };
      if (state.battleKind === "pvp" || state.battleKind === "pvpNet") {
        state = { ...state, replayDraft: state.replayDraft ? { ...state.replayDraft, commands: [...state.replayDraft.commands, command] } : state.replayDraft };
      }
      const result = tacticsHost.apply(command);
      // Сетевой ведущий: любое изменение состояния (своё или гостя) уходит
      // ведомому — события, сокращённые по зрению, и свежий снимок стороны.
      if (result.ok && netHostTransport && state.battleKind === "pvpNet") {
        netHostTransport.send({
          type: "EVENT_BATCH",
          senderId: "host",
          timestamp: Date.now(),
          payload: eventsVisibleTo(result.events, tacticsHost.getSnapshot(), tacticsHost.getFog(), 2),
        });
        sendGuestSync();
      }
      return result;
    },
    debugAutoWinBattle: () => {
      if (!tacticsHost || !isBattleScreen(state.screen)) return { ok: false, reason: "ILLEGAL" };
      return tacticsHost.debugAutoWin();
    },
    getBattleSnapshot: (owner) => requireTacticsHost().getSnapshotFor(owner),
    getBattleFullSnapshot: () => (tacticsHost ? tacticsHost.getSnapshot() : null),
    getBattleFog: () => (tacticsHost ? tacticsHost.getFog() : null),
    getBattleReachable: (actorId) => requireTacticsHost().getReachable(actorId),
    getBattlePath: (actorId, to) => requireTacticsHost().getPath(actorId, to),
    getBattleHitPreview: (actorId, targetId, weaponId) => requireTacticsHost().getHitPreview(actorId, targetId, weaponId),
    getBattleSkillPreview: (actorId, skillId, targetId, targetPos) =>
      requireTacticsHost().getSkillPreview(actorId, skillId, targetId, targetPos),
    getBattleVisible: (owner) => requireTacticsHost().getVisibleCells(owner),
    getBattleExplored: (owner) => requireTacticsHost().getExploredCells(owner),
    getBattleOutcome: () => matchOutcome(requireTacticsHost().getSnapshot()),
    subscribeBattle: (listener) => {
      battleListeners.add(listener);
      if (tacticsHost) {
        const unlisten = tacticsHost.subscribe(listener);
        return () => {
          battleListeners.delete(listener);
          unlisten();
        };
      }
      return () => {
        battleListeners.delete(listener);
      };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
