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
import { createMissionScriptState, evaluateMissionTriggers, type MissionScriptState, type MissionTrigger } from "./mission-script.js";
import { pickScriptedCommand, type PrologueScript, type PrologueScriptState } from "./prologue-script.js";
import {
  createReinforcementsState,
  noteEnemyKill,
  tickReinforcements,
  type ReinforcementsConfig,
  type ReinforcementsState,
} from "./reinforcements.js";
import type { Command, GameEvent, MatchState } from "./types.js";

export type PrologueMissionId = "prologue_brushwood" | "prologue_cry" | string;

export interface PrologueRunContext {
  missionId: PrologueMissionId;
  script?: PrologueScript;
  hints: readonly HintRecord[];
  showHints: boolean;
  reinforcements?: ReinforcementsConfig;
  ratMarker?: { x: number; y: number };
  fedotWaveSpawns?: { x: number; y: number }[];
  waveCells?: { x: number; y: number }[];
  allyCell?: { x: number; y: number };
  healerCell?: { x: number; y: number };
}

export interface PrologueRunState {
  script: PrologueScriptState;
  mission: MissionScriptState;
  hints: HintsManagerState;
  reinforcements: ReinforcementsState;
  forceDefend: boolean;
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
   * М1: крыса вышла на поле (0.20.37). С этого момента миссия имеет
   * контрольную точку — гибель Микулы откатывает сцену к появлению крысы,
   * а не завершает миссию поражением (campaign.md §1.5, §13.8).
   */
  ratSpawned: boolean;
  pendingCommand: Command | null;
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
    hints: createHintsManagerState(),
    reinforcements: createReinforcementsState(),
    forceDefend: false,
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
  };
}

const M1_TRIGGERS: MissionTrigger[] = [
  { id: "pickup_stick", kind: "OnPickup", itemId: "stick", once: true, flag: "stick" },
];

const M2_TRIGGERS: MissionTrigger[] = [
  { id: "free_fedot", kind: "OnUnitAdjacent", unitId: "mikula_peasant", otherUnitId: "fedot_stranded", once: true, flag: "fedotFreed" },
];

const M3_TRIGGERS: MissionTrigger[] = [
  { id: "first_upyr_dead", kind: "OnUnitDied", unitId: "upyr", once: true, flag: "firstWave" },
  { id: "shield", kind: "OnSkillUsed", skillId: "shield_bash", once: true, flag: "blow" },
];

const M4_TRIGGERS: MissionTrigger[] = [
  { id: "poison_join", kind: "OnPoisonApplied", side: "player", once: true, flag: "vasilisa_joined" },
  { id: "line_join", kind: "OnCrossLine", side: "player", lineAxis: "x", lineValue: 8, once: true, flag: "vasilisa_joined" },
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
  if (!state.forceDefend) return true;
  return command.type === "DEFEND";
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
      mikula.weaponId = "club";
      mikula.weaponIds = ["club"];
    }
  });
}

function revealExtract(kernel: TacticsKernel): void {
  restorePatch(kernel, (match) => {
    for (const tile of match.grid.tiles) {
      if (tile.x === 0) tile.extract = true;
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

function freeFedot(kernel: TacticsKernel): void {
  restorePatch(kernel, (match) => {
    const fedot = match.entities.find((entity) => entity.configId === "fedot_stranded" && !entity.dead);
    if (!fedot) return;
    fedot.immobileTurns = undefined;
    fedot.maxAp = 2;
    fedot.ap = 2;
  });
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
    const spawned = kernel.spawnScripted(unitId, owner, { x: cell.x, y: cell.y, z: tile?.z ?? 1 });
    spawnEvents = [...spawnEvents, ...kernel.drainSpawnEvents()];
    if (!spawned) continue;
    restorePatch(kernel, (match) => {
      const entity = match.entities.find((candidate) => candidate.id === spawned.id);
      if (!entity) return;
      stripPrologueSkills(entity);
      if (!countForElim) entity.countsForElimination = false;
      if (unitId === "strelets" && owner === PLAYER_OWNER) {
        entity.ap = 0;
      }
    });
  }
}

function spawnRats(kernel: TacticsKernel, cells: { x: number; y: number }[], countForElim: boolean): void {
  spawnUnits(kernel, "forest_rat", ENEMY_OWNER, cells, countForElim);
}

function livingEnemies(match: MatchState) {
  return match.entities.filter(
    (entity) => !entity.dead && entity.owner === ENEMY_OWNER && entity.coverType === 0 && entity.countsForElimination !== false,
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
      // Контрольная точка уже поставлена: провал — это повтор сцены, а не
      // поражение (§1.5). Исход остаётся «ongoing» — иначе экран боя показал
      // бы карточку поражения до отката.
      next.outcome = next.ratSpawned ? "ongoing" : "defeat";
      return harvest(next);
    }
    if (next.pickupDone && !kernel.getSnapshot().entities.some((entity) => entity.configId === "forest_rat" && !entity.dead)) {
      next.outcome = "victory";
    }
  }

  if (ctx.missionId === "prologue_cry") {
    if (command.type === "MOVE" && !next.forceDefend && !next.fedotFreed) {
      next.forceDefend = true;
      enqueue(next, ctx, "m2.noise", true);
    }
    if (command.type === "DEFEND" && next.forceDefend) {
      next.forceDefend = false;
      next.hints = dismissHint(next.hints, "m2.noise");
      const f = ctx.ratMarker ?? { x: 9, y: 4 };
      spawnRats(kernel, [f, { x: f.x, y: Math.min(f.y + 1, kernel.getSnapshot().grid.height - 1) }], false);
    }
    if (events.some((event) => event.type === "COMBAT_RESOLVED" && event.result !== "MISS")) {
      enqueue(next, ctx, "m2.stanceWorks");
    }
    if (evaluated.fired.some((item) => item.flag === "fedotFreed") && !next.fedotFreed) {
      next.fedotFreed = true;
      freeFedot(kernel);
      revealExtract(kernel);
      const wave = ctx.fedotWaveSpawns ?? [
        { x: 11, y: 1 }, { x: 11, y: 2 }, { x: 11, y: 3 },
        { x: 11, y: 4 }, { x: 11, y: 5 }, { x: 11, y: 6 },
      ];
      spawnRats(kernel, wave, false);
      next.waveArmed = true;
      enqueue(next, ctx, "m2.wave");
      enqueue(next, ctx, "m2.gear");
    }
    for (const event of events) {
      if (event.type === "ENTITY_REMOVED" && event.reason === "EXTRACTED") {
        const gone = match.entities.find((entity) => entity.id === event.entityId);
        const id = gone?.configId ?? kernel.getSnapshot().entities.find(() => false)?.configId;
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
    if (!living(after, "mikula_peasant") && !next.extracted.includes("mikula_peasant")) {
      if (next.fedotFreed) {
        next.outcome = "ongoing";
      } else {
        next.outcome = "defeat";
      }
    }
    if (!living(after, "mikula_peasant") && next.extracted.includes("mikula_peasant") === false && next.fedotFreed) {
      // death after checkpoint is handled by caller via restoreBattleCheckpoint
    }
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
    if (!living(after, "mikula_peasant") && !next.extracted.includes("mikula_peasant") && !next.fedotFreed) {
      next.outcome = "defeat";
    }
    if (!living(after, "fedot_stranded") && !next.extracted.includes("fedot_stranded") && next.fedotFreed) {
      const fedot = after.entities.find((entity) => entity.configId === "fedot_stranded");
      if (fedot?.dead) next.outcome = "defeat";
    }
  }

  if (ctx.missionId === "prologue_glade") {
    if (evaluated.fired.some((item) => item.flag === "firstWave") && !next.firstWave) {
      next.firstWave = true;
      spawnUnits(kernel, "upyr", ENEMY_OWNER, ctx.waveCells ?? [], true);
      if (ctx.allyCell && !living(kernel.getSnapshot(), "strelets")) {
        spawnUnits(kernel, "strelets", PLAYER_OWNER, [ctx.allyCell], true);
      }
      enqueue(next, ctx, "m3.more");
      enqueue(next, ctx, "m3.shot");
    }
    if (evaluated.fired.some((item) => item.flag === "blow")) {
      enqueue(next, ctx, "m3.blow");
    }
    const after = kernel.getSnapshot();
    if (!livingPlayers(after).length) next.outcome = "defeat";
    else if (next.firstWave && !livingEnemies(after).length) next.outcome = "victory";
  }

  if (ctx.missionId === "prologue_village") {
    const poisonOrLine = evaluated.fired.some((item) => item.flag === "vasilisa_joined");
    if (poisonOrLine && !next.vasilisaJoined) {
      next.vasilisaJoined = true;
      joinVasilisa(kernel, ctx);
      enqueue(next, ctx, "m4.join");
    }
    const after = kernel.getSnapshot();
    if (!livingPlayers(after).length) next.outcome = "defeat";
    else if (!livingEnemies(after).length) next.outcome = "victory";
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

function applyScriptDecision(
  kernel: TacticsKernel,
  state: PrologueRunState,
  ctx: PrologueRunContext,
  owner: number,
): { command: Command | null; state: PrologueRunState; forceOutcome?: "hit" | "miss" | "min" } {
  const decision = pickScriptedCommand(kernel, ctx.script, state.script, { activeOwner: owner });
  const next = { ...state, script: decision.state };
  if (decision.forceOutcome) kernel.setForcedOutcome(decision.forceOutcome);
  if (decision.spawn) {
    spawnUnits(kernel, decision.spawn.unitId, decision.spawn.owner, [decision.spawn.at], decision.spawn.owner === ENEMY_OWNER);
  }
  return { command: decision.command, state: next, forceOutcome: decision.forceOutcome };
}

export function tickPrologueEnemyTurn(
  kernel: TacticsKernel,
  state: PrologueRunState,
  ctx: PrologueRunContext,
): { command: Command | null; state: PrologueRunState; forceOutcome?: "hit" | "miss" | "min" } {
  let next = { ...state, reinforcements: { ...state.reinforcements } };
  if (ctx.missionId === "prologue_cry" && next.waveArmed && ctx.reinforcements) {
    const tick = tickReinforcements(kernel.getSnapshot(), ctx.reinforcements, next.reinforcements);
    next.reinforcements = tick.state;
    spawnRats(kernel, tick.spawns.map((spawn) => spawn.at), false);
  }
  return applyScriptDecision(kernel, next, ctx, ENEMY_OWNER);
}

/** Скриптовые действия стороны игрока (выстрел Федота, вход Василисы). */
export function tickProloguePlayerTurn(
  kernel: TacticsKernel,
  state: PrologueRunState,
  ctx: PrologueRunContext,
): { command: Command | null; state: PrologueRunState; forceOutcome?: "hit" | "miss" | "min" } {
  return applyScriptDecision(kernel, state, ctx, PLAYER_OWNER);
}

function checkpointArmed(state: PrologueRunState): boolean {
  return state.fedotFreed || state.firstWave || state.vasilisaJoined || state.ratSpawned;
}

export function shouldRestoreCheckpoint(state: PrologueRunState, events: readonly GameEvent[], match: MatchState): boolean {
  if (!checkpointArmed(state)) return false;
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

export function adjacentTo(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return distH(a.x, a.y, b.x, b.y) <= 1;
}
