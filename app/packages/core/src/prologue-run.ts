import { ENEMY_OWNER, PLAYER_OWNER } from "./debug-map.js";
import { distH, tileAt } from "./grid.js";
import {
  allowedPanel,
  createHintsManagerState,
  currentHint,
  dismissHint,
  enqueueHint,
  type HintRecord,
  type HintsManagerState,
} from "./hints-manager.js";
import type { TacticsKernel } from "./kernel.js";
import {
  createMissionScriptState,
  evaluateMissionTriggers,
  type MissionScriptState,
  type MissionTrigger,
} from "./mission-script.js";
import { pickScriptedCommand, type PrologueScript, type PrologueScriptState } from "./prologue-script.js";
import {
  createReinforcementsState,
  noteEnemyKill,
  tickReinforcements,
  type ReinforcementsConfig,
  type ReinforcementsState,
} from "./reinforcements.js";
import type { CellPos, Command, GameEvent, MatchState } from "./types.js";

type PrologueMissionId = "prologue_brushwood" | "prologue_cry" | string;

/**
 * Потолок стаи М2 после освобождения Федота (0.21.22). Совпадает с
 * `maxConcurrentEnemies` профиля подкреплений `m2_cry_wave`: на поле может
 * стоять не больше четырёх крыс разом, а убитых восполняет подкрепление.
 */
const M2_WAVE_MAX = 4;

export interface PrologueRunContext {
  missionId: PrologueMissionId;
  script?: PrologueScript;
  hints: readonly HintRecord[];
  showHints: boolean;
  reinforcements?: ReinforcementsConfig;
  ratMarker?: { x: number; y: number };
  /**
   * Клетки эвакуации из авторской раскладки (0.20.45). Без них зона
   * открывается всей западной колонкой — раскладка миссии о том, где
   * именно свет, знает больше.
   */
  extractCells?: { x: number; y: number }[];
  fedotWaveSpawns?: { x: number; y: number }[];
  waveCells?: { x: number; y: number }[];
  /** М3: клетка раненого упыря, который кидается на богатыря. */
  rusherCell?: { x: number; y: number };
  allyCell?: { x: number; y: number };
  healerCell?: { x: number; y: number };
}

export interface PrologueRunState {
  script: PrologueScriptState;
  mission: MissionScriptState;
  hints: HintsManagerState;
  reinforcements: ReinforcementsState;
  forceDefend: boolean;
  /**
   * М3: с начала миссии доступно только умение «Пролом» (0.21.32).
   * Снимается после применения. Второе принуждение пролога — канон §1.2.
   */
  forceSkillId: string | null;
  /**
   * М3: идентификатор раненого упыря волны. Пока Федот не выстрелил,
   * ходит только он — остальные стоят.
   */
  rusherId: number | null;
  /**
   * М3: после выхода волны экран сам передаёт ход Нави (без handOff
   * внутри сцены: иначе выстрел Федота вложился бы в чужой кадр).
   */
  handOffPending: boolean;
  pickupDone: boolean;
  fedotFreed: boolean;
  extracted: string[];
  objectiveKey: string;
  outcome: "ongoing" | "victory" | "defeat";
  waveArmed: boolean;
  firstWave: boolean;
  fedotJoined: boolean;
  vasilisaJoined: boolean;
  /**
   * М1: крыса вышла на поле (0.20.37). Флаг однократного появления: повторный
   * подбор палки крысу не досыпает. Гибель героя больше не откатывает сцену
   * к этой вехе — миссия начинается заново с начала (campaign.md §1.5).
   */
  ratSpawned: boolean;
  pendingCommand: Command | null;
  /**
   * М2: засада ещё впереди (0.20.45). Пока флаг стоит, герой волен
   * потратить одно ОД — второе принадлежит защитной стойке: рывок
   * обрывается на полпути, а «Конец хода» закрыт. Снимается выходом
   * первой пары крыс.
   */
  ambushPending: boolean;
  /**
   * М2: зона эвакуации открывается не в момент освобождения Федота, а
   * когда стая выбежала на поле (0.20.45). Флаг — поручение экрану боя:
   * ядро открывает зону только если экран почему-то пропустил шаг.
   */
  extractPending: boolean;
  /**
   * События скриптовых появлений, ещё не отданные средству отображения
   * (0.20.37). Появление происходит внутри `afterPrologueApply`, а не внутри
   * `apply`, поэтому события собираются здесь и проигрываются экраном боя
   * отдельно — иначе противник возникает на поле без всякой анимации.
   */
  pendingEvents: GameEvent[];
}

export function createPrologueRunState(missionId: string): PrologueRunState {
  return {
    script: { index: 0 },
    mission: createMissionScriptState(),
    hints: missionId === "prologue_glade" ? { shown: [], queue: [], forcedKey: "m3.blow" } : createHintsManagerState(),
    reinforcements: createReinforcementsState(),
    forceDefend: false,
    forceSkillId: missionId === "prologue_glade" ? "breach" : null,
    rusherId: null,
    handOffPending: false,
    pickupDone: false,
    fedotFreed: false,
    extracted: [],
    objectiveKey:
      missionId === "prologue_cry"
        ? "prologue.objective.rescueFedot"
        : missionId === "prologue_glade"
          ? "prologue.objective.clearGlade"
          : missionId === "prologue_village"
            ? "prologue.objective.clearStreet"
            : "prologue.objective.gather",
    outcome: "ongoing",
    waveArmed: false,
    firstWave: false,
    fedotJoined: false,
    vasilisaJoined: false,
    ratSpawned: false,
    pendingCommand: null,
    pendingEvents: [],
    // М2 начинается засадой: первое потраченное ОД — сигнал «шум в кустах».
    ambushPending: missionId === "prologue_cry",
    extractPending: false,
  };
}

/**
 * Полная копия состояния сцены пролога (0.21.24).
 *
 * Сохранение былины хранит не только снимок ядра, но и состояние сценария:
 * счётчик подкреплений, очередь подсказок, флаги вех, цель миссии, индекс
 * скрипта. Без него «Продолжить» поднимает поле, а вступление и цели
 * проигрываются заново поверх уже подобранных предметов. Копия глубокая:
 * состояние живёт в ссылке экрана и мутируется следующими ходами.
 */
export function clonePrologueRunState(state: PrologueRunState): PrologueRunState {
  return structuredClone(state);
}

/**
 * Прогресс сюжетной миссии, который переживает выход в меню и перезапуск
 * приложения. Снимок ядра сам по себе не знает, какие сцены уже сыграны
 * и видел ли игрок вступление — без этого блока «Продолжить» повторял
 * интро и цели поверх уже сделанных ходов.
 */
export interface PrologueProgress {
  run: PrologueRunState;
  firedCutscenes: string[];
  introSeen: boolean;
}

export function clonePrologueProgress(progress: PrologueProgress): PrologueProgress {
  return {
    run: clonePrologueRunState(progress.run),
    firedCutscenes: [...progress.firedCutscenes],
    introSeen: progress.introSeen,
  };
}

/** Структурная проверка прогресса пролога: битое поле не должно ронять сохранение. */
export function isPrologueProgress(value: unknown): value is PrologueProgress {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PrologueProgress>;
  if (!Array.isArray(candidate.firedCutscenes)) return false;
  if (candidate.firedCutscenes.some((key) => typeof key !== "string")) return false;
  if (typeof candidate.introSeen !== "boolean") return false;
  if (typeof candidate.run !== "object" || candidate.run === null) return false;
  const run = candidate.run as Partial<PrologueRunState>;
  return (
    typeof run.objectiveKey === "string" &&
    (run.outcome === "ongoing" || run.outcome === "victory" || run.outcome === "defeat") &&
    typeof run.pickupDone === "boolean" &&
    typeof run.script === "object" &&
    run.script !== null &&
    (run.forceSkillId === undefined || run.forceSkillId === null || typeof run.forceSkillId === "string") &&
    (run.rusherId === undefined || run.rusherId === null || typeof run.rusherId === "number") &&
    (run.handOffPending === undefined || typeof run.handOffPending === "boolean")
  );
}

const M1_TRIGGERS: MissionTrigger[] = [
  { id: "pickup_stick", kind: "OnPickup", itemId: "stick", once: true, flag: "stick" },
];

const M2_TRIGGERS: MissionTrigger[] = [];
// Освобождение Федота — не триггер соседства, а особое действие INTERACT
// (одно ОД, доступно только рядом с захваченным). Смена флага fedotFreed
// происходит в `afterPrologueApply` по событию UNIT_FREED.

const M3_TRIGGERS: MissionTrigger[] = [
  { id: "first_upyr_dead", kind: "OnUnitDied", unitId: "upyr", once: true, flag: "firstWave" },
];

const M4_TRIGGERS: MissionTrigger[] = [
  { id: "poison_join", kind: "OnPoisonApplied", side: "player", once: true, flag: "vasilisa_joined" },
  {
    id: "line_join",
    kind: "OnCrossLine",
    side: "player",
    lineAxis: "x",
    lineValue: 8,
    once: true,
    flag: "vasilisa_joined",
  },
];

function living(match: MatchState, configId: string) {
  return match.entities.find((entity) => entity.configId === configId && !entity.dead);
}

function restorePatch(kernel: TacticsKernel, mutate: (match: MatchState) => void): void {
  const snap = kernel.getSnapshot();
  mutate(snap);
  kernel.restoreMatch(snap, kernel.getFog());
}

function enqueue(state: PrologueRunState, ctx: PrologueRunContext, key: string, forced = false): void {
  const hint = ctx.hints.find((item) => item.key === key);
  if (!hint) return;
  state.hints = enqueueHint(state.hints, { ...hint, forced: forced || hint.forced }, { showHints: ctx.showHints });
}

export function gatePrologueCommand(state: PrologueRunState, command: Command): boolean {
  if (state.forceDefend) return command.type === "DEFEND";
  if (state.forceSkillId) {
    return command.type === "USE_SKILL" && command.skillId === state.forceSkillId;
  }
  return true;
}

/**
 * Обрезать команду по бюджету сцены (0.20.45).
 *
 * М2, часть А: пока засада впереди, герой волен потратить только одно ОД —
 * второе принадлежит защитной стойке. Заказанный рывок (2 ОД) не
 * отменяется и не запрещается: он обрывается на полпути, на дальней
 * клетке маршрута, доступной за одно ОД (campaign.md §7.2, п. 1).
 *
 * Функция чистая: ядро не трогает, команду только переписывает. Без неё
 * рывок съедал бы оба ОД, и стойку стало бы нечем оплатить — ход героя
 * зависал бы между закрытыми кнопками.
 */
export function clampPrologueCommand(
  kernel: TacticsKernel,
  state: PrologueRunState,
  command: Command,
  actorConfigIds?: readonly string[],
): Command {
  if (!state.ambushPending || command.type !== "MOVE") return command;
  const actor = kernel.getSnapshot().entities.find((entity) => entity.id === command.actorId && !entity.dead);
  if (!actor) return command;
  if (actorConfigIds && actorConfigIds.length > 0 && !actorConfigIds.includes(actor.configId)) return command;
  // Одно ОД остаётся на стойку.
  const budget = actor.ap - 1;
  if (budget <= 0) return command;
  const reachable = kernel.getReachable(actor.id);
  if (reachable.length === 0) return command;
  const costOf = (x: number, y: number): number =>
    reachable.find((cell) => cell.x === x && cell.y === y)?.apCost ?? Number.POSITIVE_INFINITY;
  if (costOf(command.to.x, command.to.y) <= budget) return command;
  const route = kernel.getPath(actor.id, { x: command.to.x, y: command.to.y, z: actor.z });
  if (!route || route.path.length === 0) return command;
  let stop: CellPos | null = null;
  for (const cell of route.path) {
    // Первая клетка маршрута — своя: её в списке достижимости нет.
    const cost = costOf(cell.x, cell.y);
    if (cost === Number.POSITIVE_INFINITY) continue;
    if (cost > budget) break;
    stop = cell;
  }
  // Маршрут начинается с клетки самого героя: остановка на ней означала бы
  // команду «стоять» и пустую трату ОД.
  if (!stop || (stop.x === actor.x && stop.y === actor.y)) return command;
  return { ...command, to: stop };
}

export function prologueHintView(state: PrologueRunState, catalog: readonly HintRecord[]) {
  return {
    hint: currentHint(state.hints, catalog),
    panelKey: allowedPanel(state.hints, catalog),
  };
}

export function dismissPrologueHint(state: PrologueRunState, key: string): PrologueRunState {
  return { ...state, hints: dismissHint(state.hints, key) };
}

function armClubAndRemoveStick(kernel: TacticsKernel): void {
  restorePatch(kernel, (match) => {
    match.entities = match.entities.filter((entity) => entity.configId !== "stick");
    const mikula = match.entities.find((entity) => entity.configId === "mikula_peasant" && !entity.dead);
    if (mikula) {
      // Слот оружия — один: если свободен, дубина сразу в руки; иначе — на базу (campaign inventory).
      // В ядре база недоступна, поэтому помечаем фолбэк меткой, которую сессия переложит в запасы.
      const hasSlot = !mikula.weaponIds || mikula.weaponIds.length === 0;
      if (hasSlot) {
        mikula.weaponId = "club";
        mikula.weaponIds = ["club"];
      } else {
        // Не теряем дубину: кладём как запасной ствол, сессия после победы переложит в инвентарь корабля.
        (match as unknown as { pendingClubToBase?: boolean }).pendingClubToBase = true;
        // На всякий случай сохраняем в списке, чтобы не потерялась при сериализации.
        if (!(mikula.weaponIds ?? []).includes("club")) mikula.weaponIds = [...(mikula.weaponIds ?? []), "club"];
      }
    }
  });
}

function revealExtract(kernel: TacticsKernel, cells?: readonly { x: number; y: number }[]): void {
  restorePatch(kernel, (match) => {
    if (cells && cells.length > 0) {
      for (const cell of cells) {
        const tile = tileAt(match.grid, cell.x, cell.y);
        if (tile) tile.extract = true;
      }
    } else {
      for (const tile of match.grid.tiles) {
        if (tile.x === 0) tile.extract = true;
      }
    }
    for (const entity of match.entities) {
      if (entity.configId === "mikula_peasant" || entity.configId === "fedot_stranded") {
        const skills = new Set(entity.skillIds ?? []);
        skills.add("evacuate");
        entity.skillIds = [...skills];
      }
    }
  });
}

/**
 * Открыть зону эвакуации (0.20.45).
 *
 * М2: зона загорается не в момент освобождения Федота, а когда стая уже
 * выбежала на поле и отыграла сцену — сначала крысы, потом пан камеры
 * на включившиеся точки выхода. Вызывается экраном боя; флаг
 * `extractPending` снимается здесь же.
 */
export function revealPrologueExtract(
  kernel: TacticsKernel,
  state: PrologueRunState,
  ctx: PrologueRunContext,
): PrologueRunState {
  revealExtract(kernel, ctx.extractCells);
  return { ...state, extractPending: false };
}

function stripPrologueSkills(entity: { configId: string; skillIds?: string[] }): void {
  if (entity.configId !== "strelets") return;
  entity.skillIds = (entity.skillIds ?? []).filter((id) => id !== "aimed_eye");
}

/**
 * События появлений, накопленные за один вызов `afterPrologueApply`
 * (0.20.37). Модульный накопитель, а не поле состояния: `spawnUnits`
 * вызывается из нескольких ветвей сценария, и все они работают в рамках
 * одного применения команды.
 */
let spawnEvents: GameEvent[] = [];

function spawnUnits(
  kernel: TacticsKernel,
  unitId: string,
  owner: number,
  cells: { x: number; y: number }[],
  countForElim: boolean,
): void {
  for (const cell of cells) {
    const tile = tileAt(kernel.getSnapshot().grid, cell.x, cell.y);
    // Пометка «в счёт истребления» передаётся ядру при появлении (0.20.45):
    // ядро ведёт счёт сторон само, и снятие пометки после появления
    // оставляло бы бой «выигранным» в момент выхода стаи М2.
    const spawned = kernel.spawnScripted(
      unitId,
      owner,
      { x: cell.x, y: cell.y, z: tile?.z ?? 1 },
      {
        countsForElimination: countForElim,
      },
    );
    spawnEvents = [...spawnEvents, ...kernel.drainSpawnEvents()];
    if (!spawned) continue;
    restorePatch(kernel, (match) => {
      const entity = match.entities.find((candidate) => candidate.id === spawned.id);
      if (!entity) return;
      stripPrologueSkills(entity);
    });
  }
}

function spawnRats(kernel: TacticsKernel, cells: { x: number; y: number }[], countForElim: boolean): void {
  spawnUnits(kernel, "forest_rat", ENEMY_OWNER, cells, countForElim);
}

/** Команда, за которую боец платит очками действия (0.20.45). */
function apSpendingCommand(command: Command): boolean {
  return command.type !== "END_TURN" && command.type !== "DEFEND";
}

function livingEnemies(match: MatchState) {
  return match.entities.filter(
    (entity) =>
      !entity.dead && entity.owner === ENEMY_OWNER && entity.coverType === 0 && entity.countsForElimination !== false,
  );
}

function livingPlayers(match: MatchState) {
  return match.entities.filter(
    (entity) => !entity.dead && entity.owner === PLAYER_OWNER && entity.coverType === 0 && entity.maxAp > 0,
  );
}

function joinVasilisa(kernel: TacticsKernel, ctx: PrologueRunContext): void {
  if (living(kernel.getSnapshot(), "znaharka")) return;
  spawnUnits(kernel, "znaharka", PLAYER_OWNER, [ctx.healerCell ?? { x: 12, y: 2 }], true);
}

export function afterPrologueApply(
  kernel: TacticsKernel,
  command: Command,
  events: readonly GameEvent[],
  state: PrologueRunState,
  ctx: PrologueRunContext,
): PrologueRunState {
  spawnEvents = [];
  const next: PrologueRunState = {
    ...state,
    mission: { fired: [...state.mission.fired], flags: { ...state.mission.flags } },
    extracted: [...state.extracted],
    // Накопитель: события появления живут в состоянии, пока экран боя их не
    // заберёт и не очистит. Иначе второй подряд вызов сценария потерял бы
    // выход крысы, поставленный первым.
    pendingEvents: [...state.pendingEvents],
  };
  if (next.outcome !== "ongoing") return harvest(next);

  const match = kernel.getSnapshot();
  const triggers =
    ctx.missionId === "prologue_cry"
      ? M2_TRIGGERS
      : ctx.missionId === "prologue_glade"
        ? M3_TRIGGERS
        : ctx.missionId === "prologue_village"
          ? M4_TRIGGERS
          : M1_TRIGGERS;
  const evaluated = evaluateMissionTriggers(match, events, triggers, next.mission);
  next.mission = evaluated.state;

  if (ctx.missionId === "prologue_brushwood") {
    const mikulaNow = living(match, "mikula_peasant");
    const stickNow = match.entities.find((entity) => entity.configId === "stick");
    const standingOnStick = Boolean(mikulaNow && stickNow && mikulaNow.x === stickNow.x && mikulaNow.y === stickNow.y);
    if ((evaluated.fired.some((item) => item.flag === "stick") || standingOnStick) && !next.pickupDone) {
      next.pickupDone = true;
      armClubAndRemoveStick(kernel);
      next.objectiveKey = "prologue.objective.destroyAll";
      if (ctx.ratMarker) {
        spawnRats(kernel, [ctx.ratMarker], true);
        next.ratSpawned = true;
      }
      // Подсказку «закончи ход» больше не ставим (0.20.40): сцена выхода
      // крысы сама передаёт ход Нави шагом `handOff`, и кнопка «Конец
      // хода» игроку не нужна — укус приходит сразу за вбеганием.
    }
    const mikula = living(kernel.getSnapshot(), "mikula_peasant");
    if (!mikula) {
      // Гибель героя — повтор миссии с начала (§1.5), не карточка поражения.
      // Исход остаётся «ongoing», пока экран боя не покажет Летописца.
      next.outcome = "ongoing";
      return harvest(next);
    }
    if (
      next.pickupDone &&
      !kernel.getSnapshot().entities.some((entity) => entity.configId === "forest_rat" && !entity.dead)
    ) {
      next.outcome = "victory";
    }
  }

  if (ctx.missionId === "prologue_cry") {
    // Зона эвакуации открыта с опозданием на один шаг сцены (0.20.45):
    // если экран боя не показал пан к точкам выхода, поле обязано открыть
    // их само — иначе миссию нельзя завершить.
    if (next.extractPending) {
      revealExtract(kernel, ctx.extractCells);
      next.extractPending = false;
    }
    // Первое потраченное ОД героя — «шум в кустах» (0.20.45). Раньше
    // сигнал ставило только перемещение: удар или умение оставляли засаду
    // за кадром. Стойка — первое принуждение пролога (§1.2); второе — «Пролом»
    // в М3. Поэтому перекрывается всё, кроме неё, и «Конец хода» тоже.
    if (next.ambushPending && !next.forceDefend && !next.fedotFreed && apSpendingCommand(command)) {
      next.forceDefend = true;
      enqueue(next, ctx, "m2.noise", true);
    }
    if (command.type === "DEFEND" && next.forceDefend) {
      next.forceDefend = false;
      next.ambushPending = false;
      next.hints = dismissHint(next.hints, "m2.noise");
      const f = ctx.ratMarker ?? { x: 9, y: 4 };
      spawnRats(kernel, [f, { x: f.x, y: Math.min(f.y + 1, kernel.getSnapshot().grid.height - 1) }], false);
    }
    // М2: "Стойка приняла удар" — сразу после сценарной атаки двух крыс
    // (промах+попадание) с небольшой паузой после цифры урона второй (0.21.28):
    // показывается после хода Нави, не после действия игрока.
    const enemyHitAfterAmbush = events.some((event) => {
      if (event.type !== "COMBAT_RESOLVED" || event.result === "MISS") return false;
      const source = match.entities.find((e) => e.id === event.sourceId);
      return source?.owner === ENEMY_OWNER;
    });
    if (enemyHitAfterAmbush && !next.ambushPending && !next.fedotFreed) {
      enqueue(next, ctx, "m2.stanceWorks");
    }
    // Освобождение Федота — само действие INTERACT (0.21.23): ядро уже сняло
    // immobile и вернуло пленника в отряд, здесь — последствия сценария.
    if (
      events.some((event) => event.type === "UNIT_FREED" && event.configId === "fedot_stranded") &&
      !next.fedotFreed
    ) {
      next.fedotFreed = true;
      // Зона эвакуации загорается позже — когда стая вышла на поле
      // (0.20.45): сначала крысы и их сцена, потом пан камеры к выходу.
      next.extractPending = true;
      // Стая М2 (0.21.22): потолок после освобождения Федота — четыре крысы,
      // как и у подкреплений (§7.2 п. 10). Стая досыпает до потолка, а не
      // выбегает вся: если пара засады ещё жива, выходят лишь столько,
      // сколько не хватает до четырёх, — иначе сразу после освобождения
      // количество превышало бы новый потолок, и подкрепления не могли бы
      // ни восполнить, ни держать его.
      const livingRats = kernel
        .getSnapshot()
        .entities.filter((entity) => entity.configId === "forest_rat" && !entity.dead).length;
      const waveRoom = Math.max(0, M2_WAVE_MAX - livingRats);
      const wave = (
        ctx.fedotWaveSpawns ?? [
          { x: 11, y: 1 },
          { x: 11, y: 2 },
          { x: 11, y: 3 },
          { x: 11, y: 4 },
          { x: 11, y: 5 },
          { x: 11, y: 6 },
        ]
      ).slice(0, waveRoom);
      spawnRats(kernel, wave, false);
      next.waveArmed = true;
      enqueue(next, ctx, "m2.wave");
    }
    for (const event of events) {
      if (event.type === "ENTITY_REMOVED" && event.reason === "EXTRACTED") {
        const snapBefore = match;
        const config = snapBefore.entities.find((entity) => entity.id === event.entityId)?.configId;
        if (config && !next.extracted.includes(config)) next.extracted.push(config);
      }
      if (event.type === "ENTITY_DIED") {
        const died = match.entities.find((entity) => entity.id === event.entityId);
        if (died?.configId === "forest_rat") next.reinforcements = noteEnemyKill(next.reinforcements);
      }
    }
    // ENTITY_REMOVED already dropped the unit — detect by absence.
    const after = kernel.getSnapshot();
    const mikulaGone = !living(after, "mikula_peasant");
    const fedotGone = !living(after, "fedot_stranded");
    if (events.some((event) => event.type === "ENTITY_REMOVED" && event.reason === "EXTRACTED")) {
      if (!living(after, "mikula_peasant") && events.some((event) => event.type === "ENTITY_REMOVED")) {
        if (!next.extracted.includes("mikula_peasant") && mikulaGone) next.extracted.push("mikula_peasant");
        if (!next.extracted.includes("fedot_stranded") && fedotGone) next.extracted.push("fedot_stranded");
      }
    }
    if (next.extracted.includes("mikula_peasant") && next.extracted.includes("fedot_stranded")) {
      next.outcome = "victory";
    }
    // Гибель героя или Федота — повтор миссии с начала (§1.5), не поражение.
    // Исход остаётся «ongoing», пока экран боя не покажет Летописца.
  }

  if (ctx.missionId === "prologue_glade") {
    if (command.type === "USE_SKILL" && next.forceSkillId && command.skillId === next.forceSkillId) {
      next.forceSkillId = null;
      next.hints = dismissHint(next.hints, "m3.blow");
    }
    if (events.some((event) => event.type === "ENTITY_DIED" && event.causeOfDeath === "FALL_INTO_PIT")) {
      enqueue(next, ctx, "m3.pit");
    }
    if (evaluated.fired.some((item) => item.flag === "firstWave") && !next.firstWave) {
      next.firstWave = true;
      next.handOffPending = true;
      const rusherAt = ctx.rusherCell ?? ctx.waveCells?.[0];
      const others = (ctx.waveCells ?? []).filter(
        (cell) => !rusherAt || cell.x !== rusherAt.x || cell.y !== rusherAt.y,
      );
      const beforeIds = new Set(kernel.getSnapshot().entities.map((entity) => entity.id));
      if (rusherAt) spawnUnits(kernel, "upyr", ENEMY_OWNER, [rusherAt], true);
      const spawned = kernel
        .getSnapshot()
        .entities.filter((entity) => entity.configId === "upyr" && !entity.dead && !beforeIds.has(entity.id));
      const rusherSpawn = spawned[0];
      if (rusherSpawn) {
        next.rusherId = rusherSpawn.id;
        restorePatch(kernel, (matchState) => {
          const entity = matchState.entities.find((candidate) => candidate.id === rusherSpawn.id);
          if (!entity) return;
          entity.hp = Math.max(1, Math.floor(entity.maxHp / 2));
        });
      }
      spawnUnits(kernel, "upyr", ENEMY_OWNER, others, true);
      enqueue(next, ctx, "m3.more");
    }
    const bogatyr = living(kernel.getSnapshot(), "bogatyr");
    const rusher =
      next.rusherId !== null
        ? kernel.getSnapshot().entities.find((entity) => entity.id === next.rusherId && !entity.dead)
        : undefined;
    if (
      next.firstWave &&
      !next.fedotJoined &&
      bogatyr &&
      rusher &&
      distH(bogatyr.x, bogatyr.y, rusher.x, rusher.y) <= 1 &&
      ctx.allyCell &&
      !living(kernel.getSnapshot(), "strelets")
    ) {
      spawnUnits(kernel, "strelets", PLAYER_OWNER, [ctx.allyCell], true);
      enqueue(next, ctx, "m3.shot");
    }
    if (command.type === "ATTACK") {
      const actor = match.entities.find((entity) => entity.id === command.actorId);
      if (actor?.configId === "strelets") next.fedotJoined = true;
    }
    const after = kernel.getSnapshot();
    if (livingPlayers(after).length && next.firstWave && !livingEnemies(after).length) next.outcome = "victory";
  }

  if (ctx.missionId === "prologue_village") {
    const poisonOrLine = evaluated.fired.some((item) => item.flag === "vasilisa_joined");
    if (poisonOrLine && !next.vasilisaJoined) {
      next.vasilisaJoined = true;
      joinVasilisa(kernel, ctx);
      enqueue(next, ctx, "m4.join");
    }
    const after = kernel.getSnapshot();
    if (livingPlayers(after).length && !livingEnemies(after).length) next.outcome = "victory";
  }

  return harvest(next);
}

/** Присоединить к состоянию события появлений, накопленные за вызов. */
function harvest(state: PrologueRunState): PrologueRunState {
  if (spawnEvents.length === 0) return state;
  return { ...state, pendingEvents: [...state.pendingEvents, ...spawnEvents] };
}

/** Забрать накопленные события появлений и опустошить накопитель. */
export function takePrologueSpawnEvents(state: PrologueRunState): {
  events: GameEvent[];
  state: PrologueRunState;
} {
  if (state.pendingEvents.length === 0) return { events: [], state };
  return { events: state.pendingEvents, state: { ...state, pendingEvents: [] } };
}

function approachBogatyr(kernel: TacticsKernel, actor: { id: number; x: number; y: number }): Command | null {
  const bogatyr = living(kernel.getSnapshot(), "bogatyr");
  if (!bogatyr) return null;
  const now = distH(actor.x, actor.y, bogatyr.x, bogatyr.y);
  if (now <= 1) return null;
  const reachable = kernel.getReachable(actor.id);
  const closer = reachable
    .filter((cell) => distH(cell.x, cell.y, bogatyr.x, bogatyr.y) < now)
    .sort((a, b) => {
      const da = distH(a.x, a.y, bogatyr.x, bogatyr.y);
      const db = distH(b.x, b.y, bogatyr.x, bogatyr.y);
      if (da !== db) return da - db;
      if (a.apCost !== b.apCost) return a.apCost - b.apCost;
      return a.y !== b.y ? a.y - b.y : a.x - b.x;
    });
  const best = closer[0];
  return best ? { type: "MOVE", actorId: actor.id, to: best } : null;
}

function rusherOf(kernel: TacticsKernel, state: PrologueRunState) {
  if (state.rusherId !== null) {
    return kernel.getSnapshot().entities.find((entity) => entity.id === state.rusherId && !entity.dead);
  }
  return kernel
    .getSnapshot()
    .entities.find((entity) => entity.configId === "upyr" && !entity.dead && entity.hp < entity.maxHp);
}

function applyScriptDecision(
  kernel: TacticsKernel,
  state: PrologueRunState,
  ctx: PrologueRunContext,
  owner: number,
): { command: Command | null; state: PrologueRunState; forceOutcome?: "hit" | "miss" | "min" | "max" } {
  const decision = pickScriptedCommand(kernel, ctx.script, state.script, { activeOwner: owner });
  const next = { ...state, script: decision.state };
  if (decision.forceOutcome) kernel.setForcedOutcome(decision.forceOutcome);
  if (decision.spawn) {
    spawnUnits(
      kernel,
      decision.spawn.unitId,
      decision.spawn.owner,
      [decision.spawn.at],
      decision.spawn.owner === ENEMY_OWNER,
    );
  }
  return { command: decision.command, state: next, forceOutcome: decision.forceOutcome };
}

export function tickPrologueEnemyTurn(
  kernel: TacticsKernel,
  state: PrologueRunState,
  ctx: PrologueRunContext,
): { command: Command | null; state: PrologueRunState; forceOutcome?: "hit" | "miss" | "min" | "max" } {
  const next = { ...state, reinforcements: { ...state.reinforcements } };
  // Тик вызывается перед каждой командой Нави, но прибавляет подкрепление
  // один раз за ход: сервис сам помнит ход, в котором уже отработал
  // (campaign.md §12.1, §7.2 п. 10; 0.21.19).
  if (ctx.missionId === "prologue_cry" && next.waveArmed && ctx.reinforcements) {
    const tick = tickReinforcements(kernel.getSnapshot(), ctx.reinforcements, next.reinforcements);
    next.reinforcements = tick.state;
    spawnRats(
      kernel,
      tick.spawns.map((spawn) => spawn.at),
      false,
    );
  }
  // М3, бросок раненого: пока Федот не выстрелил, ходит только этот упырь.
  // Остальные стоят — иначе обычный алгоритм бросил бы всю тройку разом.
  if (ctx.missionId === "prologue_glade" && next.firstWave && !next.fedotJoined) {
    const rusher = rusherOf(kernel, next);
    if (rusher && rusher.owner === ENEMY_OWNER && rusher.ap > 0) {
      const step = approachBogatyr(kernel, rusher);
      if (step) return { command: step, state: next };
    }
    return { command: null, state: next };
  }
  return applyScriptDecision(kernel, next, ctx, ENEMY_OWNER);
}

/** Скриптовые действия стороны игрока (выстрел Федота, вход Василисы). */
export function tickProloguePlayerTurn(
  kernel: TacticsKernel,
  state: PrologueRunState,
  ctx: PrologueRunContext,
): { command: Command | null; state: PrologueRunState; forceOutcome?: "hit" | "miss" | "min" | "max" } {
  // М3: Федот стреляет только в раненого упыря и только вплотную к богатырю.
  // Обычный скрипт берёт первого живого упыря с ОД — после броска это не он.
  if (ctx.missionId === "prologue_glade" && !state.fedotJoined) {
    const rusher = rusherOf(kernel, state);
    const bogatyr = living(kernel.getSnapshot(), "bogatyr");
    if (!rusher || !bogatyr || distH(rusher.x, rusher.y, bogatyr.x, bogatyr.y) > 1) {
      return { command: null, state };
    }
    const strelets = living(kernel.getSnapshot(), "strelets");
    if (strelets && strelets.owner === PLAYER_OWNER && strelets.ap > 0) {
      const weaponId = strelets.weaponId ?? strelets.weaponIds?.[0] ?? "bow";
      kernel.setForcedOutcome("max");
      return {
        command: { type: "ATTACK", actorId: strelets.id, targetId: rusher.id, weaponId },
        state,
        forceOutcome: "max",
      };
    }
  }
  return applyScriptDecision(kernel, state, ctx, PLAYER_OWNER);
}

/**
 * Гибель управляемого бойца в прологе — повтор миссии с начала (§1.5).
 * Эвакуированные в счёт не идут: они уже ушли с поля живыми.
 */
export function shouldRestartPrologueMission(
  state: PrologueRunState,
  events: readonly GameEvent[],
  match: MatchState,
): boolean {
  const died = events.some((event) => event.type === "ENTITY_DIED" || event.type === "MATCH_ENDED");
  if (!died) return false;
  const fallen = match.entities.filter(
    (entity) =>
      entity.owner === PLAYER_OWNER &&
      entity.coverType === 0 &&
      entity.dead &&
      !state.extracted.includes(entity.configId),
  );
  return fallen.length > 0;
}
