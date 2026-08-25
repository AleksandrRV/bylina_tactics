import {
  ENEMY_OWNER,
  PLAYER_OWNER,
  createMissionMatch,
  createPvpMatch,
  createQuickMatch,
  createTacticsKernel,
  defaultTrainingWeapons,
  pickEnemyCommand,
  pickScriptedEnemyCommand,
  weaponStatsFromRecord,
  type CellPos,
  type Command,
  type EntityState,
  type GameEvent,
  type HitPreview,
  type MatchState,
  type ReachableCell,
  type RosterMods,
  type SkillStats,
  type TacticsKernel,
  type TrainingEnemyScriptState,
  type WeaponStats,
} from "@bylina/core";
import type { TrainingMissionConfig } from "@bylina/content";
import { createFieldRenderer, type FieldRenderer } from "@bylina/render";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ACTION_SHORTCUTS, selectableActions, shortcutForAction } from "./action-shortcuts.js";
import { interactiveEntityAt, primaryAttackForEnemy } from "./cell-interaction.js";
import { shouldAutoEndTurn, trainingHintsSorted } from "./training-progress.js";
import {
  directiveAllowsAction,
  resolveTrainingDirective,
  trainingActionKindOfCommand,
  trainingCommandAllowed,
  trainingDenialKey,
  trainingStepCompleted,
  type TrainingActionKind,
  type TrainingDirectiveView,
} from "./training-scenario.js";
import { useServices, useT } from "./context.js";
import { useI18nTick, usePrefersReducedMotion, useSessionState, useSettingsState } from "./hooks.js";
import { CampaignHint } from "./CampaignHint.js";
import { pendingCampaignHints, type CampaignHintId } from "./campaign-hints.js";
import { unitPortrait } from "./portraits.js";
import { useBattleNetwork } from "./useBattleNetwork.js";
import { useBattleInput } from "./useBattleInput.js";
import { useReplayControls } from "./useReplayControls.js";
import "./battle.css";

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function unitNameKey(configId: string): string {
  return `unit.${configId}.name`;
}

/** Иконка автопобеды: молния как знак мгновенного разрешения. */
function AutoWinIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2 4.5 13.5H11L9.5 22 19 9.5h-6.5L13 2Z" />
    </svg>
  );
}

/** Иконка-жук: общепринятый символ отладочного режима. */
function DebugIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2l1.5 2.5M16 2l-1.5 2.5" />
      <ellipse cx="12" cy="14" rx="5" ry="6" />
      <path d="M12 8v12" />
      <path d="M7 12H3M21 12h-4M7.5 17l-3 2.5M16.5 17l3 2.5M7.5 11l-3-2.5M16.5 11l3-2.5" />
      <circle cx="12" cy="7" r="2.5" />
    </svg>
  );
}

/** Иконка выхода из обучения: дверь с выходящей стрелкой. */
function ExitIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 4H6v16h7" />
      <path d="M16 8l4 4-4 4" />
      <path d="M10 12h9" />
    </svg>
  );
}

export function BattleScreenView() {
  useI18nTick();
  const t = useT();
  const { session, content, debug } = useServices();
  const { paused, difficulty, battleKind, activeMissionId, deployment, matchSeed, trainingDone: trainingDoneMissions } = useSessionState();
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<FieldRenderer | null>(null);
  const hoverRef = useRef<string | null>(null);
  const portraitTapRef = useRef<{ id: number; at: number } | null>(null);
  const inputRef = useBattleInput();
  const reducedMotion = usePrefersReducedMotion();

  const [debugMovement, setDebugMovement] = useState(false);
  const [fastMode, setFastMode] = useState(false);
  const playbackSpeed: 1 | 2 = fastMode ? 2 : 1;
  const playbackSpeedRef = useRef<1 | 2>(playbackSpeed);
  playbackSpeedRef.current = playbackSpeed;

  const weapons = useMemo(() => {
    const base: Record<string, WeaponStats> = defaultTrainingWeapons();
    for (const record of content.weapons) {
      base[record.id] = weaponStatsFromRecord(record);
    }
    return base;
  }, [content.weapons]);

  const skills = useMemo(() => {
    const result: Record<string, SkillStats> = {};
    for (const record of content.skills) result[record.id] = record as SkillStats;
    return result;
  }, [content.skills]);

  // Сетевой ведомый (0.15.0) не исполняет правила: ядро у ведущего,
  // снимок и предпросмотр приходят по каналу.
  const network = useBattleNetwork(session, battleKind);
  const { netRole, isNetGuest, isSpectator } = network;
  const isReplay = battleKind === "replay";
  const replayJournal = session.get().replayJournal;
  const isTraining = battleKind === "training";
  const trainingMission = isTraining
    ? content.training.missions.find((mission) => mission.id === session.get().trainingMissionId)
    : undefined;
  const [kernel] = useState<TacticsKernel | null>(() => {
    if (isTraining && trainingMission) {
      const host = createTacticsKernel({
        initial: createMissionMatch({
          units: content.units,
          map: trainingMission.map,
          playerSlots: trainingMission.playerSlots,
          enemies: trainingMission.enemies,
          seed: matchSeed || 1,
        }),
        weapons,
        skills,
        units: content.units,
        seed: matchSeed || 1,
      });
      session.bindTacticsHost(host);
      return host;
    }
    if (isReplay && replayJournal) {
      const host = createTacticsKernel({
        initial: createPvpMatch({
          units: replayJournal.options.units,
          map: replayJournal.options.map,
          side1: replayJournal.options.side1,
          side2: replayJournal.options.side2,
          objective: replayJournal.options.objective,
          seed: replayJournal.options.seed,
        }),
        weapons,
        skills,
        units: content.units,
        seed: replayJournal.options.seed,
      });
      session.bindTacticsHost(host);
      return host;
    }
    if (isNetGuest) return null;
    // Ядро боя создаётся один раз на монтаж экрана. При восстановлении партии
    // (сохранение 0.13.0) используется снимок из состояния сессии; инициализатор
    // может вызываться повторно (StrictMode) — чтение состояния идемпотентно.
    const restored = session.get().restoredMatch;
    if (restored) {
      const host = createTacticsKernel({
        initial: restored,
        weapons,
        skills,
        units: content.units,
        fog: session.get().restoredFog,
      });
      session.bindTacticsHost(host);
      return host;
    }
    // Поочерёдная игра: составы сторон из комнаты сбора, поле режима (0.14.0);
    // сетевой ведущий строит ту же партию локально (0.15.0).
    let initial: MatchState;
    if (battleKind === "pvp" || battleKind === "pvpNet") {
      const sides = session.getPvpSides();
      if (!sides) throw new Error("PvP sides are missing");
      initial = createPvpMatch({
        units: content.units,
        map: content.pvp.map ?? content.quickMatch.map,
        side1: sides.side1,
        side2: sides.side2,
        objective: session.get().pvpObjective ?? "elimination",
        seed: matchSeed || 1,
      });
    } else if (battleKind === "campaign" && activeMissionId) {
      const mission = session.getCampaign().getMission(activeMissionId);
      if (!mission) throw new Error(`Unknown campaign mission: ${activeMissionId}`);
      const penalty = content.campaign.woundPenalty;
      const fighters = session.getCampaign().getState().fighters;
      const items = session.getCampaign().getItems();
      const playerSlots = deployment.map((fighterId) => {
        const fighter = fighters.find((candidate) => candidate.id === fighterId);
        if (!fighter || !fighter.alive) throw new Error(`Unknown fighter in deployment: ${fighterId}`);
        const mods: RosterMods = fighter.wounded
          ? { aimMod: penalty.aim, defenseMod: penalty.defense, mobilityMod: penalty.mobility }
          : {};
        // Снаряжение: оружие и модификаторы предмета добавляются к высадке.
        const item = fighter.equippedItemId ? items.find((entry) => entry.id === fighter.equippedItemId) : undefined;
        if (item) {
          mods.aimMod = (mods.aimMod ?? 0) + (item.aimMod ?? 0);
          mods.defenseMod = (mods.defenseMod ?? 0) + (item.defenseMod ?? 0);
          mods.mobilityMod = (mods.mobilityMod ?? 0) + (item.mobilityMod ?? 0);
          if (item.maxHpMod) mods.maxHpMod = (mods.maxHpMod ?? 0) + item.maxHpMod;
          if (item.weaponId) mods.extraWeaponIds = [item.weaponId];
        }
        return { unitId: fighter.unitId, hp: fighter.hp, ...mods };
      });
      initial = createMissionMatch({
        units: content.units,
        map: mission.map,
        playerSlots,
        enemies: mission.enemies,
        generals: mission.generals,
        excludedGenerals: session.getCampaign().getState().deadGenerals,
        objective: mission.type === "destroy"
          ? { kind: "destroy", unitId: mission.objectiveUnitId! }
          : mission.type === "rescue"
            ? { kind: "rescue", unitId: mission.escorteeUnitId! }
            : mission.type === "recon"
              ? { kind: "recon" }
              : undefined,
        seed: matchSeed || 1,
      });
    } else {
      const count =
        content.quickMatch.difficulties.find((item) => item.id === difficulty)?.enemyCount ??
        content.quickMatch.difficulties[0]?.enemyCount ??
        3;
      initial = createQuickMatch({
        units: content.units,
        map: content.quickMatch.map,
        playerSlots: content.quickMatch.playerSlots,
        enemyPool: content.quickMatch.enemyPool,
        enemyCount: count,
        seed: matchSeed || 1,
      });
    }
    const host = createTacticsKernel({ initial, weapons, skills, units: content.units });
    session.bindTacticsHost(host);
    return host;
  });

  const [, setTick] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [action, setAction] = useState<{ type: "weapon" | "skill"; id: string } | null>(null);
  const [aimId, setAimId] = useState<number | null>(null);
  const [skillTargetPos, setSkillTargetPos] = useState<CellPos | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [log, setLog] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [enemyPhase, setEnemyPhase] = useState(false);

  useEffect(
    () =>
      session.subscribeBattle(() => {
        setTick((value) => value + 1);
      }),
    [kernel],
  );

  // Режим обучения (0.19.0): активный шаг подсказки; отслеживание событий
  // для перехода к следующему шагу. Шаги выполняются по порядку поля step
  // конфигурации (0.19.1): порядок массива hints значения не имеет.
  const [hintStep, setHintStep] = useState(0);
  // Позиция в очереди сценария Нави (0.20.13): живёт на время боя, очередь
  // с маркерами конца хода читается последовательно.
  const enemyScriptRef = useRef<TrainingEnemyScriptState>({ index: 0 });
  const trainingHints = isTraining && trainingMission
    ? trainingHintsSorted(trainingMission.hints)
    : [];
  const activeHint = trainingHints[hintStep] ?? null;

  // Обновление шага по событиям действий ИГРОКА (0.19.1): подсказка
  // завершается только действием игрока — события хода Нави подсказки
  // не продвигают. Шаги с repeatUntil (0.20.13) проверяются по снимку:
  // «бить до победы» не завершается единичной атакой.
  const advanceTraining = (events: GameEvent[]): void => {
    if (!isTraining || !activeHint) return;
    const full = session.getBattleFullSnapshot();
    if (trainingStepCompleted(activeHint, events, full ?? snapshot)) setHintStep((value) => value + 1);
  };

  // Реактивные плашки обучения (0.20.1): отравление, воскрешение, призыв.
  // Показываются событиями любой стороны (яд накладывает кикимора в свой ход).
  const [trainingNote, setTrainingNote] = useState<string | null>(null);
  const noteTimerRef = useRef<number | undefined>(undefined);
  const showTrainingNote = (events: GameEvent[]): void => {
    if (!isTraining || !trainingMission?.notes) return;
    let key: string | null = null;
    for (const event of events) {
      if (event.type === "STATUS_CHANGED" && event.status === "POISON" && event.applied) {
        key = trainingMission.notes.poison;
        break;
      }
      if (event.type === "ENTITY_SPAWNED" && event.cause === "RESURRECTION") {
        key = trainingMission.notes.resurrect;
        break;
      }
      if (event.type === "ENTITY_SPAWNED" && event.cause === "SUMMON") {
        key = trainingMission.notes.summon;
        break;
      }
    }
    if (!key) return;
    setTrainingNote(key);
    if (noteTimerRef.current !== undefined) window.clearTimeout(noteTimerRef.current);
    noteTimerRef.current = window.setTimeout(() => setTrainingNote(null), 6000);
  };
  useEffect(() => () => {
    if (noteTimerRef.current !== undefined) window.clearTimeout(noteTimerRef.current);
  }, []);

  // Воспроизведение повтора (0.17.0): команды журнала применяются по таймеру.
  const { replayIndex, setReplayIndex, replayDone, setReplayDone } = useReplayControls();
  useEffect(() => {
    if (!isReplay || !replayJournal || !kernel || replayDone) return;
    const commands = replayJournal.commands;
    const timer = window.setInterval(() => {
      const index = replayIndex;
      if (index >= commands.length) {
        window.clearInterval(timer);
        setReplayDone(true);
        return;
      }
      const command = commands[index];
      if (command) {
        const applied = kernel.apply(command);
        if (applied.ok) void rendererRef.current?.play(applied.events);
      }
      setReplayIndex(index + 1);
    }, 480 / playbackSpeed);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReplay, replayJournal, kernel, replayIndex, replayDone, playbackSpeed]);


  // Обрыв канала состязательного боя (0.17.0): отсчёт 30 секунд.
  const netDisconnected = session.get().netDisconnected === true;
  const [disconnectLeft, setDisconnectLeft] = useState(30);
  useEffect(() => {
    if (!netDisconnected) return;
    setDisconnectLeft(30);
    const timer = window.setInterval(() => {
      setDisconnectLeft((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [netDisconnected]);

  // Поочерёдная игра: каждый рендер показывает сторону, чей сейчас ход
  // (сокрытие панели чужой стороны и туман стороны при передаче устройства).
  // Сетевой ведомый всегда видит только свою сторону; ведущий — активную.
  const netOwner = battleKind === "pvpNet" ? session.get().netOwner : null;
  const pvpActive = battleKind === "pvp" || battleKind === "pvpNet"
    ? (isNetGuest || isSpectator ? netOwner : (session.getBattleFullSnapshot()?.activeOwner ?? PLAYER_OWNER))
    : null;
  const viewOwner = pvpActive ?? PLAYER_OWNER;
  const enemyOwner = viewOwner === ENEMY_OWNER ? PLAYER_OWNER : ENEMY_OWNER;

  const EMPTY_SNAPSHOT: MatchState = {
    turnNumber: 1,
    activeOwner: viewOwner,
    grid: { width: 8, height: 6, tiles: [] },
    entities: [],
  };
  // Наблюдатель, как и гость, не исполняет правила: снимок приходит от ведущего.
  const usesNetSnapshot = isNetGuest || isSpectator;
  const snapshot = usesNetSnapshot
    ? (session.getNetSnapshot() ?? EMPTY_SNAPSHOT)
    : session.getBattleSnapshot(viewOwner);

  // Завершение миссии обучения: итоговая плашка вместо мгновенного возврата
  // (ui-design §3: «…→ итог → экран обучения»). Пройденной считается только
  // победа (0.19.1).
  const [trainingOver, setTrainingOver] = useState<"victory" | "defeat" | null>(null);

  // Строгий сценарий (0.20.13): активный шаг превращается в точное указание
  // (клетка, оружие, умение, цель, исполнитель). Всё остальное интерфейс не
  // исполняет; подсветка указания — единственный яркий элемент поля.
  const directiveView = useMemo<TrainingDirectiveView | null>(() => {
    if (!isTraining || !activeHint || trainingOver) return null;
    const full = session.getBattleFullSnapshot();
    if (!full) return null;
    return resolveTrainingDirective(activeHint, {
      snapshot: full,
      reachable: (actorId) => session.getBattleReachable(actorId),
      hitPreview: (actorId, targetId, weaponId) => session.getBattleHitPreview(actorId, targetId, weaponId),
      skillPreview: (actorId, skillId, targetId, pos) => session.getBattleSkillPreview(actorId, skillId, targetId, pos),
      skills,
    });
    // Пересчёт на каждое изменение боя: указание зависит от достижимости,
    // предпросмотров и состояния цели. Полный снимок ведущего обязателен:
    // сокращённый снимок стороны скрывает чужие сущности в тумане.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTraining, activeHint, trainingOver, skills, snapshot, session]);

  // Указание, оказавшееся невыполнимым (исполнитель погиб, цель уже мертва,
  // умение исчерпано), пропускается — сценарий самовосстанавливается.
  useEffect(() => {
    if (!isTraining || !activeHint || trainingOver) return;
    if (directiveView === null) setHintStep((value) => value + 1);
  }, [isTraining, activeHint, directiveView, trainingOver]);

  // Завершение миссии обучения (0.19.0; строгий сценарий 0.20.13). Пути к победе:
  // - миссия без противника («Первые шаги») завершается выполнением ВСЕХ
  //   шагов подсказки: по правилам ядра такая партия «выиграна» с самого
  //   начала, поэтому исход ядра здесь неприменим;
  // - миссия с противником («Бой», «Умения и состояния») играется до итога
  //   боя — уничтожения всех противников: последний шаг сценария
  //   (repeatUntil victory) ведёт игрока указаниями до самой победы, поэтому
  //   реактивные плашки (яд, воскрешение) успевают сработать.
  // Поражение — гибель всех бойцов игрока: Навь в обучении действует.
  const trainingDone = isTraining && trainingHints.length > 0 && hintStep >= trainingHints.length;
  useEffect(() => {
    if (!isTraining || busy || trainingOver) return;
    const outcome = session.getBattleOutcome();
    const missionHasEnemies = (trainingMission?.enemies.length ?? 0) > 0;
    const complete = missionHasEnemies ? outcome === "victory" : trainingDone;
    if (complete) {
      if (trainingMission) session.completeTrainingMission(trainingMission.id);
      setTrainingOver("victory");
      return;
    }
    if (outcome === "defeat") setTrainingOver("defeat");
  }, [snapshot.turnNumber, snapshot.entities, busy, isTraining, trainingDone, trainingHints.length, hintStep, trainingOver, trainingMission]);

  // Ограничение действий в обучении (строгий сценарий, 0.20.13): игрок может
  // совершать только то действие, которое предписывает активное указание, —
  // и только указанным исполнителем, оружием, умением и целью. Пауза и выход
  // из обучения остаются доступны всегда. Отклонённое действие поясняется
  // строкой лога (ключи training.locked.*, ui-design §4.5).
  const trainingAllows = (action: TrainingActionKind): boolean => directiveAllowsAction(directiveView, action);
  const trainingDeny = (action: TrainingActionKind): void => {
    if (directiveView) setLog(t(trainingDenialKey(directiveView, action)));
  };
  const trainingDirective = directiveView?.directive ?? null;
  const trainingActorId =
    trainingDirective && trainingDirective.kind !== "noop" && trainingDirective.kind !== "endTurn"
      ? trainingDirective.actorId
      : null;
  /** Разрешено ли текущее указание этому исполнителю с этим оружием. */
  const trainingWeaponAllowed = (weaponId: string): boolean =>
    !isTraining || (trainingDirective?.kind === "attack" && trainingDirective.weaponId === weaponId);
  /** Разрешено ли текущее указание этому умению. */
  const trainingSkillAllowed = (skillId: string): boolean =>
    !isTraining || (trainingDirective?.kind === "skill" && trainingDirective.skillId === skillId);

  const visibleCells = useMemo(
    () => (usesNetSnapshot ? session.getNetVisible() : session.getBattleVisible(viewOwner)),
    [kernel, snapshot.turnNumber, snapshot.entities, viewOwner, usesNetSnapshot],
  );
  const exploredCells = useMemo(
    () => (usesNetSnapshot ? session.getNetExplored() : session.getBattleExplored(viewOwner)),
    [kernel, snapshot.turnNumber, snapshot.entities, viewOwner, usesNetSnapshot],
  );

  const isOwn = (entity: EntityState): boolean =>
    !isSpectator && !isReplay && !entity.dead && entity.coverType === 0 && entity.owner === viewOwner && entity.maxAp > 0;

  const noActionPoints = useMemo(() => {
    const fighters = snapshot.entities.filter(
      (entity) => !entity.dead && entity.coverType === 0 && entity.owner === viewOwner && entity.maxAp > 0,
    );
    return fighters.length > 0 && fighters.every((entity) => entity.ap <= 0);
  }, [snapshot.entities, viewOwner]);

  // События поочерёдного боя приходят через транспорт (0.14.0/0.15.0):
  // локальный — на одном устройстве, сетевой — ведомому от ведущего.
  useEffect(() => {
    if (battleKind !== "pvp" && battleKind !== "pvpNet") return;
    const unlisten = session.subscribePvpEvents((events) => {
      announce(events);
      setAction(null);
      setAimId(null);
      setSkillTargetPos(null);
      setPreview(null);
      playThen(events);
    });
    return unlisten;
    // Подписка создаётся на время жизни экрана.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kernel, battleKind, session]);

  // Передача устройства в поочерёдной игре: при смене хода экран ждёт
  // подтверждения нового игрока, прежде чем показать его панель.
  const [passReady, setPassReady] = useState(false);
  useEffect(() => {
    setPassReady(false);
  }, [snapshot.turnNumber, pvpActive]);

  // Миссия кампании: запись точки для формулировки задачи и цели.
  const mission = battleKind === "campaign" && activeMissionId
    ? session.getCampaign().getMission(activeMissionId)
    : undefined;

  // Боевые туториалы кампании (0.20.0/0.20.1): «первый бой», «первый леший»,
  // «первая кикимора», «появление генерала». Показываются один раз, отключаются
  // настройкой подсказок; «первый бой» — модальной карточкой, остальные —
  // баннерами, не блокирующими поле.
  const hintSettings = useSettingsState();
  const { campaignHintsDone } = useSessionState();
  const battleWantedHints = useMemo(
    () => pendingCampaignHints({
      showHints: hintSettings.showHints,
      done: campaignHintsDone ?? [],
      onCampaignMap: false,
      lockedCount: 0,
      hasWounded: false,
      rosterTabActive: false,
      forgeTabActive: false,
      onDeployment: false,
      onBattle: battleKind === "campaign" && Boolean(mission),
      enemyTypes: mission?.enemies.map((entry) => entry.unitId) ?? [],
      onBattleWithGeneral: Boolean(mission?.generals?.length),
    }),
    [hintSettings.showHints, campaignHintsDone, battleKind, mission],
  );
  const [battleHintQueue, setBattleHintQueue] = useState<CampaignHintId[]>([]);
  useEffect(() => {
    setBattleHintQueue((previous) => {
      const next = [...previous];
      for (const id of battleWantedHints) {
        if (!next.includes(id)) next.push(id);
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battleWantedHints.join(","), kernel]);
  const activeBattleHint = hintSettings.showHints
    ? (battleHintQueue.find((id) => !session.isCampaignHintShown(id)) ?? null)
    : null;
  const closeBattleHint = (): void => {
    if (!activeBattleHint) return;
    session.markCampaignHintShown(activeBattleHint);
    setBattleHintQueue((previous) => previous.filter((id) => id !== activeBattleHint));
  };
  const objectiveEntity = mission
    ? snapshot.entities.find((entity) =>
        mission.type === "destroy"
          ? entity.configId === mission.objectiveUnitId
          : mission.type === "rescue"
            ? entity.configId === mission.escorteeUnitId
            : false,
      )
    : undefined;

  // Уведомление о записи в начале хода стороны кампании (ui-design §8).
  const [saveNotice, setSaveNotice] = useState(false);
  useEffect(() => {
    if (battleKind !== "campaign") return;
    setSaveNotice(true);
    const timer = window.setTimeout(() => setSaveNotice(false), 1600);
    return () => window.clearTimeout(timer);
  }, [snapshot.turnNumber, battleKind]);

  useEffect(() => {
    // Обучение: выбран всегда исполнитель текущего указания — произвольный
    // выбор бойца в обучении запрещён (строгий сценарий, 0.20.13).
    const first = (isTraining && trainingActorId !== null
      ? snapshot.entities.find((entity) => entity.id === trainingActorId)
      : undefined) ?? snapshot.entities.find(isOwn);
    setSelectedId(first?.id ?? null);
    setAction(null);
    setAimId(null);
    setSkillTargetPos(null);
    setPreview(null);
  }, [snapshot.turnNumber, viewOwner, trainingActorId]);

  const selected = snapshot.entities.find((entity) => entity.id === selectedId);
  const aimed = snapshot.entities.find((entity) => entity.id === aimId);

  const reachable = useMemo(() => {
    if (selectedId === null || action !== null || paused || busy) return [] as ReachableCell[];
    // Гость запрашивает достижимость у ведущего; наблюдатель и повтор не
    // вычисляют её вовсе (нет ядра / просмотр).
    if (isNetGuest) return session.requestNetReachable(selectedId);
    if (usesNetSnapshot || isReplay) return [] as ReachableCell[];
    return session.getBattleReachable(selectedId);
  }, [kernel, selectedId, action, snapshot.turnNumber, selected?.x, selected?.y, selected?.ap, paused, busy, isNetGuest, usesNetSnapshot, isReplay]);

  const byReach = useMemo(() => {
    const map = new Map<string, ReachableCell>();
    for (const cell of reachable) map.set(cellKey(cell.x, cell.y), cell);
    return map;
  }, [reachable]);

  // Подсветка строгого указания (0.20.13): маркер на поле берётся из самого
  // указания (чистая логика в training-scenario.ts, покрыта тестами), а
  // прочие элементы поля и панелей приглушаются (ui-design §4.5).
  const trainingHighlight = directiveView?.highlight ?? null;
  const trainingFocus = isTraining && directiveView !== null;

  // Ключ подсвечиваемого элемента панели/кнопки (ui-design §4.5):
  // "ap" | "weapon" | "skill" | "defend" | "overwatch" | "end_turn".
  const hintPanelKey = directiveView?.panelKey ?? null;

  const previewPath = useMemo(() => {
    if (!preview || selectedId === null) return [] as CellPos[];
    // Гость и наблюдатель не исполняют правила: маршрут им не вычисляется
    // (иначе requireTacticsHost бросит исключение).
    if (usesNetSnapshot) return [] as CellPos[];
    const [xs, ys] = preview.split(",");
    const path = session.getBattlePath(selectedId, { x: Number(xs), y: Number(ys), z: 0 });
    return path?.path ?? [];
  }, [preview, selectedId, kernel, snapshot.turnNumber, usesNetSnapshot]);

  const hit: HitPreview | null = useMemo(() => {
    if (selectedId === null || !action) return null;
    if (action.type === "weapon") {
      if (aimId === null) return null;
      if (isNetGuest) return session.requestNetHitPreview(selectedId, aimId, action.id);
      if (usesNetSnapshot || isReplay) return null;
      return session.getBattleHitPreview(selectedId, aimId, action.id);
    }
    if (aimId === null && !skillTargetPos) return null;
    // Предпросмотр умений у гостя/наблюдателя не вычисляется (нет ядра).
    if (usesNetSnapshot) return null;
    const result = session.getBattleSkillPreview(selectedId, action.id, aimId ?? undefined, skillTargetPos ?? undefined);
    return {
      available: result.available,
      reason: result.reason,
      chance: result.chance,
      dmgMin: result.dmgMin,
      dmgMax: result.dmgMax,
      cover: result.cover,
      heightMod: result.heightMod,
      flanked: result.flanked,
    };
  }, [kernel, selectedId, aimId, skillTargetPos, action, selected?.x, selected?.y, selected?.ap, aimed?.x, aimed?.y, aimed?.hp]);

  const areaPreview = useMemo(() => {
    if (action?.type !== "skill" || selectedId === null) return null;
    const skill = skills[action.id];
    const hasAreaTarget = (skill?.radius ?? 0) > 0 || Boolean(skill?.effects.some((effect) => effect.type === "spawn" || effect.type === "displace"));
    if (!skill || !hasAreaTarget) return null;
    const center = skill.category === "self" ? selected : skillTargetPos;
    return center
      ? { center: { x: center.x, y: center.y, z: center.z }, radius: skill.radius ?? 0 }
      : null;
  }, [action, selectedId, selected, skillTargetPos, skills]);

  const announce = (events: GameEvent[]): void => {
    const combat = events.find((event) => event.type === "COMBAT_RESOLVED");
    if (combat && combat.type === "COMBAT_RESOLVED") {
      if (combat.result === "MISS") setLog(t("combat.miss"));
      else if (combat.result === "CRIT") setLog(t("combat.crit", { dmg: combat.damageDealt }));
      else setLog(t("combat.hit", { dmg: combat.damageDealt }));
    }
    if (events.some((event) => event.type === "ENTITY_DIED")) setLog(t("combat.died"));
  };

  const finishFromEvents = (events: GameEvent[]): void => {
    const ended = events.find((event) => event.type === "MATCH_ENDED");
    if (!ended || ended.type !== "MATCH_ENDED") return;
    // Повтор: партия не «завершается»; обучение завершает экран отдельным эффектом.
    if (isReplay || isTraining) return;
    if (battleKind === "pvp" || battleKind === "pvpNet") {
      const winner = ended.winnerPlayerId === String(PLAYER_OWNER) ? 1 : ended.winnerPlayerId === String(ENEMY_OWNER) ? 2 : null;
      if (winner) session.finishPvpMatch(winner);
      return;
    }
    const outcome = ended.winnerPlayerId === String(PLAYER_OWNER) ? "victory" : "defeat";
    if (battleKind === "campaign") {
      // Исходы бойцов высадки: сопоставление по явной метке rosterIndex,
      // а не по порядку идентификаторов. Метка не зависит от призывов,
      // иллюзий и удалённых с поля сущностей.
      // Полный снимок ведущего: гибель генерала фиксируется даже вне обзора
      // стороны игрока (сокращённый снимок не содержит чужих сущностей вне
      // поля зрения — иначе окончательная гибель не была бы учтена).
      const full = session.getBattleFullSnapshot();
      const final = session.getBattleSnapshot(PLAYER_OWNER);
      const generalDeaths = (mission?.generals ?? []).filter((generalId) => {
        // Генералы спавнятся ядром с id ≥ 500 (match.ts): гибель рядового
        // с тем же configId не засчитывается генералу.
        const general = full?.entities.find(
          (entity) => entity.configId === generalId && entity.owner === ENEMY_OWNER && entity.id >= 500,
        );
        return general?.dead === true;
      });
      const participants = deployment.map((fighterId, index) => {
        const entity = final.entities.find((candidate) =>
          candidate.owner === PLAYER_OWNER &&
          candidate.coverType === 0 &&
          candidate.rosterIndex === index,
        );
        if (entity) return { fighterId, survived: !entity.dead, hp: entity.hp };
        // Эвакуированный боец (разведка) выжил: здоровье на момент ухода
        // зафиксировано ядром в состоянии боя (0.13.0).
        const extracted = (final.extracted ?? []).find((entry) => entry.rosterIndex === index);
        if (extracted) return { fighterId, survived: true, hp: extracted.hp };
        return { fighterId, survived: false, hp: 0 };
      });
      session.finishCampaignMission(outcome, participants, generalDeaths);
      return;
    }
    session.finishMatch(outcome);
  };

  const playThen = (events: GameEvent[], after?: () => void): void => {
    setBusy(true);
    void (rendererRef.current?.play(events) ?? Promise.resolve()).finally(() => {
      setBusy(false);
      finishFromEvents(events);
      after?.();
    });
  };

  /** Отладочная автопобеда: мгновенно уничтожает всех противников и открывает итог победы.
   *  Доступна только в отладочном режиме (?debug=1) и не действует в повторе (0.20.1).
   *  В обучении победа определяется шагами подсказки — автопобеда довершает
   *  и их, чтобы итог действительно открылся (0.20.2). */
  const debugAutoWin = (): void => {
    if (paused || busy || isReplay || !debug) return;
    const result = session.debugAutoWinBattle();
    if (!result.ok) return;
    if (isTraining) setHintStep(trainingHints.length);
    setPreview(null);
    setAimId(null);
    setSkillTargetPos(null);
    setAction(null);
    playThen(result.events);
  };

  /** Единственный канал команд: поочерёдная игра — через транспорт (0.14.0/0.15.0). */
  const applyCommand = (command: Command): void => {
    if (isSpectator || isReplay) return;
    if (battleKind === "pvp") {
      session.sendPvpCommand(command);
      return;
    }
    if (isNetGuest) {
      session.sendNetCommand(command);
      return;
    }
    // Обучение: финальная проверка строгого сценария (0.20.13) — команда
    // обязана совпадать с активным указанием; жестовые проверки кнопок и
    // кликов выше дают удобство, эта точка гарантирует полноту запрета.
    if (isTraining && !trainingCommandAllowed(directiveView, command)) {
      trainingDeny(trainingActionKindOfCommand(command));
      return;
    }
    const result = session.applyBattleCommand(command);
    if (!result.ok) {
      // Отклонённая команда объясняется игроку (0.20.2): в обучении шаги
      // ограничены, и без отклика неясно, почему действие не сработало.
      // Ключ `battle.reject.<причина>`; неизвестная причина — общий текст.
      const key = `battle.reject.${result.reason}`;
      setLog(t(key) === key ? t("battle.reject.generic") : t(key));
      return;
    }
    announce(result.events);
    // Подсказка обучения продвигается событиями действия самого игрока (0.19.1);
    // реактивные плашки (яд, воскрешение, призыв) показываются любыми событиями (0.20.1).
    advanceTraining(result.events);
    showTrainingNote(result.events);
    setAction(null);
    setAimId(null);
    setSkillTargetPos(null);
    setPreview(null);
    playThen(result.events);
  };

  const tryMove = (to: CellPos): void => {
    if (selectedId === null || paused || busy) return;
    if (snapshot.activeOwner !== viewOwner) return;
    // Обучение: перемещение допустимо только в подсвеченную клетку текущего
    // указания и только предписанным исполнителем (строгий сценарий, 0.20.13).
    if (isTraining) {
      const directive = trainingDirective;
      if (
        !directive ||
        directive.kind !== "move" ||
        directive.actorId !== selectedId ||
        directive.cell.x !== to.x ||
        directive.cell.y !== to.y
      ) {
        trainingDeny("move");
        return;
      }
    }
    applyCommand({ type: "MOVE", actorId: selectedId, to });
  };

  const tryAttack = (targetId: number): void => {
    if (selectedId === null || !action || paused || busy) return;
    if (snapshot.activeOwner !== viewOwner) return;
    // Обучение: только предписанное оружие/умение, исполнитель и цель
    // (строгий сценарий, 0.20.13). tryAttack обслуживает и оружейную атаку,
    // и умение по сущности.
    if (isTraining) {
      const directive = trainingDirective;
      const isWeapon = action.type === "weapon";
      const allowed =
        directive !== null &&
        ((isWeapon &&
          directive.kind === "attack" &&
          directive.actorId === selectedId &&
          directive.weaponId === action.id &&
          directive.targetId === targetId) ||
          (!isWeapon &&
            directive.kind === "skill" &&
            directive.actorId === selectedId &&
            directive.skillId === action.id &&
            directive.targetId === targetId));
      if (!allowed) {
        trainingDeny(isWeapon ? "attack" : "skill");
        return;
      }
    }
    const command: Command = action.type === "weapon"
      ? { type: "ATTACK", actorId: selectedId, targetId, weaponId: action.id }
      : { type: "USE_SKILL", actorId: selectedId, targetId, targetPos: skillTargetPos ?? undefined, skillId: action.id };
    applyCommand(command);
  };

  const useSelfSkill = (skillId: string): void => {
    if (selectedId === null || paused || busy || snapshot.activeOwner !== viewOwner) return;
    // Обучение: само-умение допустимо, только если предписано указанием.
    if (isTraining) {
      const directive = trainingDirective;
      if (
        !directive ||
        directive.kind !== "skill" ||
        directive.actorId !== selectedId ||
        directive.skillId !== skillId ||
        directive.targetId !== undefined
      ) {
        trainingDeny("skill");
        return;
      }
    }
    applyCommand({ type: "USE_SKILL", actorId: selectedId, skillId });
  };

  const tryPositionSkill = (pos: CellPos): void => {
    if (selectedId === null || action?.type !== "skill" || paused || busy) return;
    // Обучение: позиционное умение применяется только в подсвеченную клетку
    // указания (строгий сценарий, 0.20.13).
    if (isTraining) {
      const directive = trainingDirective;
      if (
        !directive ||
        directive.kind !== "skill" ||
        directive.actorId !== selectedId ||
        directive.skillId !== action.id ||
        directive.cell === undefined ||
        directive.cell.x !== pos.x ||
        directive.cell.y !== pos.y
      ) {
        trainingDeny("skill");
        return;
      }
    }
    const same = skillTargetPos?.x === pos.x && skillTargetPos.y === pos.y && skillTargetPos.z === pos.z;
    if (!same) {
      setSkillTargetPos(pos);
      setPreview(null);
      return;
    }
    applyCommand({
      type: "USE_SKILL",
      actorId: selectedId,
      skillId: action.id,
      targetId: aimId ?? undefined,
      targetPos: pos,
    });
  };

  const runEnemyPhase = async (): Promise<void> => {
    setEnemyPhase(true);
    try {
      // В обучении без противника («Первые шаги») ход Нави отсутствует:
      // завершаем его сразу, возвращая управление игроку. В миссиях с
      // противником («Бой», «Умения и состояния») Навь действует строго по
      // сценарию миссии (0.20.13, game-design §3.5): постоянные правила и
      // линейная очередь действий заданы в training.json5 (enemyScript);
      // когда очередь исчерпана, ход достаётся обычному детерминированному
      // алгоритму как предохранитель.
      if (isTraining && (trainingMission?.enemies.length ?? 0) === 0) {
        session.applyBattleCommand({ type: "END_TURN", playerId: String(ENEMY_OWNER) });
        finishFromEvents([]);
        return;
      }
      await sleep(430 / playbackSpeedRef.current);
      for (let guard = 0; guard < 96; guard += 1) {
        const snap = session.getBattleSnapshot(PLAYER_OWNER);
        if (snap.activeOwner !== ENEMY_OWNER) break;
        if (session.getBattleOutcome() !== "ongoing") break;
        if (!kernel) break;
        let command: Command | null;
        if (isTraining) {
          const decision = pickScriptedEnemyCommand(kernel, trainingMission?.enemyScript, enemyScriptRef.current);
          enemyScriptRef.current = decision.state;
          command = decision.command;
        } else {
          command = pickEnemyCommand(kernel);
        }
        const applied = command
          ? session.applyBattleCommand(command)
          : session.applyBattleCommand({ type: "END_TURN", playerId: String(ENEMY_OWNER) });
        if (!applied.ok) {
          session.applyBattleCommand({ type: "END_TURN", playerId: String(ENEMY_OWNER) });
          break;
        }
        await (rendererRef.current?.play(applied.events) ?? Promise.resolve());
        announce(applied.events);
        showTrainingNote(applied.events);
        finishFromEvents(applied.events);
        if (!command) break;
        if (session.getBattleOutcome() !== "ongoing") break;
        await sleep(190 / playbackSpeedRef.current);
      }
    } finally {
      setEnemyPhase(false);
    }
  };

  // Восстановление партии, сохранённой в ход Нави: алгоритм противника
  // продолжает ход с текущего состояния (иначе сторона осталась бы без хода).
  // В поочерёдной игре алгоритм не применяется — ход принадлежит человеку.
  useEffect(() => {
    if (battleKind === "pvp" || battleKind === "pvpNet") return;
    if (session.getBattleOutcome() !== "ongoing") return;
    if (session.getBattleSnapshot(PLAYER_OWNER).activeOwner !== ENEMY_OWNER) return;
    void runEnemyPhase();
    // Только при создании ядра (монтаж экрана, включая восстановление).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kernel]);

  const endTurn = (): void => {
    if (paused || busy) return;
    if (snapshot.activeOwner !== viewOwner) return;
    // Обучение: завершение хода — само по себе шаг сценария (0.20.13);
    // вне такого шага оно запрещено.
    if (isTraining && directiveView?.directive.kind !== "endTurn") {
      trainingDeny("endTurn");
      return;
    }
    setPreview(null);
    setAimId(null);
    setLog(null);
    if (battleKind === "pvp") {
      session.sendPvpCommand({ type: "END_TURN", playerId: String(viewOwner) });
      return;
    }
    if (isNetGuest) {
      session.sendNetCommand({ type: "END_TURN", playerId: String(viewOwner) });
      return;
    }
    const result = session.applyBattleCommand({ type: "END_TURN", playerId: String(viewOwner) });
    if (!result.ok) return;
    setBusy(true);
    void (async () => {
      try {
        advanceTraining(result.events);
        showTrainingNote(result.events);
        await (rendererRef.current?.play(result.events) ?? Promise.resolve());
        finishFromEvents(result.events);
        if (session.getBattleOutcome() === "ongoing" && session.getBattleSnapshot(PLAYER_OWNER).activeOwner === ENEMY_OWNER) {
          await runEnemyPhase();
        }
      } finally {
        setBusy(false);
      }
    })();
  };

  // Конец хода стороны наступает сам, когда ни один боец стороны не имеет
  // допустимых действий (math §16.7): при нулевых запасах ОД всех живых
  // бойцов активной стороны ход передаётся следующей стороне без команды.
  // В обучении автозавершение отключается на шаге «завершите ход» — этот
  // шаг учит нажимать кнопку. Повторы и наблюдатель ход не завершают.
  // Условие — чистая функция (training-progress.ts), покрыта тестами.
  useEffect(() => {
    const ownUnits = snapshot.entities.filter(
      (entity) => !entity.dead && entity.coverType === 0 && entity.owner === viewOwner && entity.maxAp > 0,
    );
    if (!shouldAutoEndTurn({
      paused,
      busy,
      enemyPhase,
      isReplay,
      isSpectator,
      isTraining,
      activeHint,
      autoEndTurn: hintSettings.autoEndTurn,
      activeOwner: snapshot.activeOwner,
      viewOwner,
      ownUnits,
      outcomeOngoing: session.getBattleOutcome() === "ongoing",
      isNetGuest: Boolean(isNetGuest),
    })) return;
    endTurn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.turnNumber, snapshot.entities, viewOwner, paused, busy, enemyPhase, isReplay, isSpectator, isNetGuest, isTraining, activeHint, hintSettings.autoEndTurn]);

  const onCell = (x: number, y: number): void => {
    if (paused || busy || snapshot.activeOwner !== viewOwner) return;
    // Ознакомительный шаг обучения (until "noop", 0.20.1): действие не
    // предполагается — шаг завершается кликом в любое место поля, сам клик
    // не выполняет перемещения/атаки (иначе подсказка «застревала» бы до
    // первого действия, а игроку нужно просто подтвердить понимание).
    if (isTraining && activeHint?.until === "noop") {
      setHintStep((value) => value + 1);
      return;
    }
    const reach = byReach.get(cellKey(x, y));
    const targeting = action !== null;
    const selectedSkill = action?.type === "skill" ? skills[action.id] : undefined;
    const positionOnlySkill = selectedSkill?.effects.some((effect) => effect.type === "spawn");
    const allyTargeting = Boolean(selectedSkill && !positionOnlySkill && (selectedSkill.filter === "allies" || selectedSkill.filter === "all"));
    const selfAreaTargeting = Boolean(selectedSkill?.category === "self" && (selectedSkill.radius ?? 0) > 0);
    if (selfAreaTargeting && action?.type === "skill") {
      useSelfSkill(action.id);
      return;
    }
    const entity = interactiveEntityAt(snapshot.entities, x, y, Boolean(reach) && !targeting);
    if (entity?.owner === viewOwner && entity.coverType === 0 && entity.maxAp > 0 && !allyTargeting) {
      // Обучение: выбор иного бойца запрещён — действует только исполнитель
      // текущего указания (строгий сценарий, 0.20.13).
      if (isTraining && trainingActorId !== null && entity.id !== trainingActorId) {
        setLog(t("training.locked.actor"));
        return;
      }
      setSelectedId(entity.id);
      setAction(null);
      setSkillTargetPos(null);
      setAimId(null);
      setPreview(null);
      return;
    }

    const automaticAttack = primaryAttackForEnemy(selected, entity, viewOwner, targeting);
    // Обучение: авто-включение оружия по врагу допустимо, только когда враг —
    // цель текущего указания, а основное оружие — предписанное.
    if (automaticAttack) {
      if (!isTraining) {
        setAction(automaticAttack);
        setAimId(entity?.id ?? null);
        setPreview(null);
        return;
      }
      const directive = trainingDirective;
      if (directive?.kind === "attack" && entity?.id === directive.targetId && automaticAttack.id === directive.weaponId) {
        setAction(automaticAttack);
        setAimId(entity?.id ?? null);
        setPreview(null);
        return;
      }
      trainingDeny("attack");
      return;
    }

    if (entity && selectedId !== null && targeting) {
      // Обучение: прицеливание допустимо только по цели текущего указания.
      if (isTraining) {
        const directive = trainingDirective;
        const isWeapon = action.type === "weapon";
        const allowed =
          directive !== null &&
          ((isWeapon && directive.kind === "attack" && directive.targetId === entity.id) ||
            (!isWeapon && directive.kind === "skill" && directive.targetId === entity.id));
        if (!allowed) {
          trainingDeny(isWeapon ? "attack" : "skill");
          return;
        }
      }
      if (aimId === entity.id && hit?.available) {
        tryAttack(entity.id);
        return;
      }
      setAimId(entity.id);
      if (!selectedSkill?.effects.some((effect) => effect.type === "displace")) setSkillTargetPos(null);
      setPreview(null);
      return;
    }

    const needsPosition = selectedSkill?.effects.some((effect) => effect.type === "spawn" || effect.type === "displace");
    if (needsPosition && action?.type === "skill") {
      const tile = snapshot.grid.tiles.find((candidate) => candidate.x === x && candidate.y === y);
      if (tile) tryPositionSkill({ x, y, z: tile.z });
      return;
    }

    // В режиме перемещения проходимая клетка всегда означает движение.
    // Граневое укрытие в ней не перехватывает выбор как цель атаки.
    if (reach && !targeting) {
      const id = cellKey(x, y);
      // Обучение: шаг принимает только подсвеченную клетку указания —
      // точную проверку выполняет tryMove (строгий сценарий, 0.20.13).
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      if (coarse && preview !== id) {
        const directive = trainingDirective;
        if (
          isTraining &&
          (!directive || directive.kind !== "move" || directive.cell.x !== x || directive.cell.y !== y)
        ) {
          trainingDeny("move");
          return;
        }
        setPreview(id);
        setAimId(null);
        return;
      }
      tryMove({ x, y, z: reach.z });
      return;
    }

    setPreview(null);
    setAimId(null);
  };

  const onHover = (x: number, y: number): void => {
    if (paused || busy) return;
    const id = cellKey(x, y);
    if (hoverRef.current === id) return;
    hoverRef.current = id;
    if (byReach.has(id) && !window.matchMedia("(pointer: coarse)").matches) {
      setPreview(id);
    }
  };

  inputRef.current = { onCell, onHover };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = createFieldRenderer();
    renderer.setOnActivate((x, y) => inputRef.current.onCell(x, y));
    renderer.setOnHover((x, y) => inputRef.current.onHover(x, y));
    let gone = false;
    void renderer.mount(host).then(() => {
      if (gone) {
        renderer.destroy();
        return;
      }
      rendererRef.current = renderer;
      setTick((value) => value + 1);
    });
    return () => {
      gone = true;
      rendererRef.current = null;
      renderer.destroy();
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.setPlaybackSpeed(playbackSpeed);
  }, [playbackSpeed]);

  const aimBreakCell = useMemo(() => {
    if (!hit || !selected || !aimed) return null;
    // breakCell теперь вычисляется ядром в previewAttack (§7, §9.3).
    if (hit.breakCell) return hit.breakCell;
    return null;
  }, [hit, selected, aimed]);

  const hoverCell = useMemo(() => {
    if (skillTargetPos) return skillTargetPos;
    if (!preview) return null;
    const [xs, ys] = preview.split(",");
    const x = Number(xs);
    const y = Number(ys);
    const tile = snapshot.grid.tiles.find((t) => t.x === x && t.y === y);
    return { x, y, z: tile?.z ?? 0 };
  }, [preview, skillTargetPos, snapshot.grid]);

  const aimStatus = aimId === null
    ? undefined
    : hit === null
      ? "selected" as const
      : hit.available
        ? "ready" as const
        : "blocked" as const;

  useEffect(() => {
    rendererRef.current?.update({
      matchSeed,
      snapshot,
      selectedId,
      aimId,
      reachable,
      path: previewPath,
      aimOk: Boolean(hit?.available),
      aimStatus,
      heightMod: hit?.heightMod ?? 0,
      reducedMotion,
      debugMovement,
      visibleCells,
      exploredCells,
      aimBreakCell,
      hoverCell,
      trainingHighlight,
      trainingFocus,
      areaPreview,
      flanked: Boolean(hit?.flanked),
      combatLabels: { miss: t("combat.miss") },
    });
  }, [matchSeed, snapshot, selectedId, aimId, reachable, previewPath, hit?.available, hit?.heightMod, hit?.flanked, aimStatus, reducedMotion, paused, debugMovement, visibleCells, exploredCells, aimBreakCell, hoverCell, trainingHighlight, trainingFocus, areaPreview, t]);

  const centerOnEntity = (entity: EntityState): void => {
    rendererRef.current?.centerOn(entity.x, entity.y, entity.z);
  };

  const handlePortraitPointerUp = (event: ReactPointerEvent, entity: EntityState): void => {
    if (event.pointerType !== "touch" || entity.dead) return;
    const now = performance.now();
    const previous = portraitTapRef.current;
    if (previous && previous.id === entity.id && now - previous.at < 360) {
      portraitTapRef.current = null;
      centerOnEntity(entity);
    } else {
      portraitTapRef.current = { id: entity.id, at: now };
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        session.setPaused(!paused);
        return;
      }
      if (paused || busy) return;
      if (event.key === "f" || event.key === "F") {
        setFastMode((value) => !value);
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        // Обучение: перебор бойцов запрещён — действует исполнитель указания.
        if (isTraining && trainingActorId !== null) return;
        const living = snapshot.entities.filter(isOwn);
        if (living.length === 0) return;
        const withAp = living.filter((entity) => entity.ap > 0);
        const pool = withAp.length > 0 ? withAp : living;
        const index = pool.findIndex((entity) => entity.id === selectedId);
        const next = pool[(index + 1) % pool.length];
        if (next) {
          setSelectedId(next.id);
          setAction(null);
          setSkillTargetPos(null);
          setAimId(null);
        }
        return;
      }
      if (event.key === "9" && selectedId !== null && selected && selected.ap > 0 && snapshot.activeOwner === viewOwner && trainingAllows("defend") && (!isTraining || trainingActorId === selectedId)) {
        applyCommand({ type: "DEFEND", actorId: selectedId });
        setAction(null);
        setSkillTargetPos(null);
        setAimId(null);
        setPreview(null);
        return;
      }
      if (event.key === "0" && selectedId !== null && selected && selected.ap > 0 && snapshot.activeOwner === viewOwner && trainingAllows("overwatch") && (!isTraining || trainingActorId === selectedId)) {
        applyCommand({ type: "OVERWATCH", actorId: selectedId });
        setAction(null);
        setSkillTargetPos(null);
        setAimId(null);
        setPreview(null);
        return;
      }
      if (ACTION_SHORTCUTS.includes(event.key as (typeof ACTION_SHORTCUTS)[number]) && selected) {
        const index = Number(event.key) - 1;
        const chosen = selectableActions(selected)[index];
        // Обучение: клавиша допустима, только если её действие предписано
        // указанием — точное совпадение оружия/умения (строгий сценарий).
        if (isTraining) {
          const directive = trainingDirective;
          const allowed =
            directive !== null &&
            ((chosen?.type === "weapon" && directive.kind === "attack" && directive.actorId === selectedId && directive.weaponId === chosen.id) ||
              (chosen?.type === "skill" && directive.kind === "skill" && directive.actorId === selectedId && directive.skillId === chosen.id));
          if (!allowed) return;
        }
        if (!chosen) return;
        if (chosen.type === "skill") {
          const skill = skills[chosen.id];
          const cooldown = selected.skillCooldowns?.[chosen.id] ?? 0;
          const uses = selected.skillUses?.[chosen.id] ?? 0;
          if (cooldown > 0 || (skill?.maxUsesPerBattle !== undefined && uses >= skill.maxUsesPerBattle)) return;
        }
        if (chosen.type === "skill" && skills[chosen.id]?.category === "self" && (skills[chosen.id]?.radius ?? 0) <= 0) {
          useSelfSkill(chosen.id);
        } else {
          const active = action?.type === chosen.type && action.id === chosen.id;
          setAction(active ? null : chosen);
          setSkillTargetPos(null);
          setAimId(null);
          setPreview(null);
        }
        return;
      }
      const step = 28;
      if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") rendererRef.current?.pan(step, 0);
      if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") rendererRef.current?.pan(-step, 0);
      if (event.key === "ArrowUp" || event.key === "w" || event.key === "W") rendererRef.current?.pan(0, step);
      if (event.key === "ArrowDown" || event.key === "s" || event.key === "S") rendererRef.current?.pan(0, -step);
    };
    const onContext = (event: MouseEvent): void => {
      event.preventDefault();
      setAction(null);
      setSkillTargetPos(null);
      setAimId(null);
      setPreview(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("contextmenu", onContext);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("contextmenu", onContext);
    };
  }, [paused, busy, snapshot, selectedId, aimId, hit, action, skills, session, viewOwner]);

  const roster = snapshot.entities.filter((entity) =>
    (isSpectator ? (entity.owner === 1 || entity.owner === 2) : entity.owner === viewOwner) && entity.coverType === 0,
  );
  const sideKey = isSpectator
    ? "net.spectator"
    : battleKind === "pvp" || battleKind === "pvpNet"
      ? (viewOwner === 1 ? "pvp.side1" : "pvp.side2")
    : snapshot.activeOwner === ENEMY_OWNER
      ? "field.sideEnemy"
      : "field.sidePlayer";

  // Показывать портреты противников только если они в зоне видимости
  // (или уже мертвы и были видны). В поочерёдной игре — противники активной
  // стороны; у наблюдателя — все бойцы обеих сторон.
  const knownEnemies = snapshot.entities.filter((entity) => {
    if (entity.owner !== enemyOwner || entity.coverType !== 0) return false;
    if (isSpectator && entity.owner !== 1 && entity.owner !== 2) return false;
    // Снимок стороны содержит только видимых чужих юнитов (math §8.3):
    // погибший противник остаётся в полосе, пока его клетка наблюдаема.
    return visibleCells.has(cellKey(entity.x, entity.y));
  });

  return (
    <div
      className={`battle-screen${battleKind === "pvp" ? (viewOwner === 1 ? " is-pvp-side1" : " is-pvp-side2") : ""}${trainingFocus ? " is-training-focus" : ""}`}
    >
      <div ref={hostRef} className="battle-stage" />
      <div className="battle-hud">
        {isTraining && trainingMission ? (
          // Единая обучающая панель «наставник»: портрет, шаг и инструкция
          // собраны в одну компактную карточку у верхнего края, чтобы не
          // перекрывать центр поля (доработка вёрстки обучения).
          <div className="training-coach" role="status" aria-live="polite">
            {unitPortrait("chronicler") ? (
              <img className="training-coach-face" src={unitPortrait("chronicler")} alt="" draggable={false} />
            ) : null}
            <div className="training-coach-body">
              <div className="training-coach-head">
                <span className="training-coach-name">{t("training.mentor")}</span>
                {activeHint ? (
                  <span className="training-hint-step">{t("training.step", { current: hintStep + 1, total: trainingHints.length })}</span>
                ) : null}
              </div>
              <p className="training-coach-line">
                {activeHint ? t(activeHint.textKey) : t(`training.${trainingMission.id}.intro`)}
              </p>
              {activeHint && activeHint.until === "noop" ? (
                <button type="button" className="training-continue" onClick={() => setHintStep((value) => value + 1)}>
                  {t("training.continue")}
                </button>
              ) : null}
            </div>
            {/* Пропуск шага — только при повторном прохождении уже
                пройденной миссии (0.20.2): первое прохождение ведётся
                по шагам без пропуска (доводка обучения). */}
            {activeHint && (trainingDoneMissions ?? []).includes(trainingMission.id) ? (
              <button type="button" className="training-skip" onClick={() => setHintStep((value) => value + 1)}>
                {t("training.skip")}
              </button>
            ) : null}
            {activeHint ? (
              <span className="training-step-dots" aria-hidden="true">
                {trainingHints.map((item, index) => (
                  <i
                    key={item.step}
                    className={`training-step-dot${index < hintStep ? " is-done" : index === hintStep ? " is-current" : ""}`}
                  />
                ))}
              </span>
            ) : null}
          </div>
        ) : null}
        {trainingNote ? (
          // Реактивные плашки (яд, воскрешение, призыв) — у нижнего края,
          // над панелью действий, чтобы не перекрывать центр поля.
          <div className="training-note" role="status" aria-live="polite">
            <span className="training-note-mark" aria-hidden="true">✦</span>
            {t(trainingNote)}
          </div>
        ) : null}
        {activeBattleHint ? (
          <CampaignHint
            key={activeBattleHint}
            hintId={activeBattleHint}
            variant={activeBattleHint === "first_battle" ? "modal" : "banner"}
            onClose={closeBattleHint}
            action={
              // Туториал «первый бой» предлагает режим обучения игроку,
              // который его ещё не прошёл (0.20.2, доводка онбординга).
              activeBattleHint === "first_battle" &&
              !content.training.missions.every((mission) => (trainingDoneMissions ?? []).includes(mission.id))
                ? {
                    label: t("training.offerOpen"),
                    run: () => {
                      closeBattleHint();
                      session.goTo("training");
                    },
                  }
                : undefined
            }
          />
        ) : null}
        {isReplay ? (
          <div className="replay-bar" role="status">
            <span className="replay-label">{t("replay.watching")}</span>
            <span className="replay-progress">
              <i style={{ width: `${replayJournal ? Math.min(100, (replayIndex / Math.max(1, replayJournal.commands.length)) * 100) : 0}%` }} />
            </span>
            <span className="muted">
              {replayIndex}/{replayJournal?.commands.length ?? 0}
            </span>
            {replayDone ? <span className="replay-done">{t("replay.done")}</span> : null}
          </div>
        ) : null}
        <header className="battle-top">
          <div className="top-controls">
            <button type="button" className="hud-btn" onClick={() => session.setPaused(true)}>
              {t("battle.pause")}
            </button>
            <button
              type="button"
              className={`hud-btn speed-toggle${fastMode ? " is-on" : ""}`}
              onClick={() => setFastMode((value) => !value)}
              aria-pressed={fastMode}
              aria-keyshortcuts="F"
              aria-label={t(fastMode ? "battle.speedFast" : "battle.speedNormal")}
              title={t("battle.speedHint")}
            >
              <span aria-hidden="true">»</span> {fastMode ? "2×" : "1×"}
            </button>
            {isTraining ? (
              <button
                type="button"
                className="hud-btn hud-icon-btn training-exit"
                onClick={() => session.goTo("training")}
                title={t("training.exitHint")}
                aria-label={t("training.exit")}
              >
                <ExitIcon />
              </button>
            ) : null}
            {debug ? (
              <>
                <button
                  type="button"
                  className={`hud-btn hud-icon-btn debug-toggle${debugMovement ? " is-on" : ""}`}
                  onClick={() => setDebugMovement((value) => !value)}
                  title={t(debugMovement ? "battle.debugMovementHint" : "battle.debugMovement")}
                  aria-pressed={debugMovement}
                  aria-label={t("battle.debugMovement")}
                >
                  <DebugIcon />
                </button>
                <button
                  type="button"
                  className="hud-btn hud-icon-btn debug-win"
                  onClick={() => debugAutoWin()}
                  title={t("battle.debugAutoWinHint")}
                  aria-label={t("battle.debugAutoWin")}
                >
                  <AutoWinIcon />
                </button>
              </>
            ) : null}
          </div>
          <div className="battle-objective">
            <p className="eyebrow">
              {battleKind === "campaign" ? (
                <>
                  <span className="mission-badge">{t("campaign.mission")}</span>
                  {activeMissionId ?? ""}
                </>
              ) : battleKind === "pvp" ? (
                t("menu.pvp")
              ) : isTraining ? (
                t("training.battleLabel")
              ) : (
                t("menu.quickMatch")
              )}
            </p>
            <p>
              {battleKind === "campaign" && mission
                ? t(`battle.objective.${mission.type}`)
                : isTraining && trainingMission
                  ? t(`training.objective.${trainingMission.id}`)
                  : t("battle.objectiveQuick")}
            </p>
            <p className="muted">
              {t("field.turn", { turn: snapshot.turnNumber })}
              {" · "}
              {t(sideKey)}
            </p>
            {snapshot.apple ? (
              <div className="apple-hud" aria-label={t("pvp.appleLabel")}>
                <span className="apple-hud-icon" aria-hidden="true">●</span>
                <span className="apple-hud-text">
                  {snapshot.apple.carrierId !== null
                    ? (() => {
                        const carrier = snapshot.entities.find((entity) => entity.id === snapshot.apple?.carrierId);
                        const side = carrier?.owner === 1 ? t("pvp.side1") : t("pvp.side2");
                        return t("pvp.appleCarrier", { side });
                      })()
                    : t("pvp.appleLying")}
                </span>
              </div>
            ) : null}
            {objectiveEntity ? (
              <div className="objective-hud" aria-label={t("campaign.objective")}>
                {unitPortrait(objectiveEntity.configId) ? (
                  <img
                    className={`objective-face${objectiveEntity.dead ? " is-dead" : ""}`}
                    src={unitPortrait(objectiveEntity.configId)}
                    alt=""
                    draggable={false}
                  />
                ) : null}
                <span className="objective-meta">
                  <span className="objective-name">{t(unitNameKey(objectiveEntity.configId))}</span>
                  <span className="objective-hp" aria-label={t("battle.hp", { current: objectiveEntity.hp, max: objectiveEntity.maxHp })}>
                    <i style={{ width: `${Math.max(0, Math.min(100, (objectiveEntity.hp / objectiveEntity.maxHp) * 100))}%` }} />
                  </span>
                </span>
              </div>
            ) : null}
            {knownEnemies.length > 0 ? (
              <div className="enemies-strip" aria-label={t("field.sideEnemy")}>
                {knownEnemies.map((entity) => {
                  const face = unitPortrait(entity.configId);
                  return face ? (
                    <img
                      key={entity.id}
                      className={`enemy-face${entity.dead ? " is-dead" : ""}`}
                      src={face}
                      alt={t(unitNameKey(entity.configId))}
                      title={t(unitNameKey(entity.configId))}
                      draggable={false}
                    />
                  ) : null;
                })}
              </div>
            ) : null}
          </div>
          {battleKind === "pvp" ? (
            <div className="pvp-sides-strip" aria-label={t("pvp.objective")}>
              <span className={`pvp-side-emblem is-side1${viewOwner === 1 ? " is-active" : ""}`} aria-hidden="true">
                1
              </span>
              <span className="pvp-side-emblem-sep" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <path d="M3.5 3.5 8 8M3.5 3.5l2.6-1 3 3-1 2.6L3.5 3.5Z" />
                  <path d="M16.5 16.5 12 12M16.5 16.5l-2.6 1-3-3 1-2.6 4.6 4.6Z" />
                </svg>
              </span>
              <span className={`pvp-side-emblem is-side2${viewOwner === 2 ? " is-active" : ""}`} aria-hidden="true">
                2
              </span>
            </div>
          ) : null}
          <div className="roster" aria-label={t("field.sidePlayer")}>
            {roster.map((entity) => {
              const face = unitPortrait(entity.configId);
              return (
                <button
                  key={entity.id}
                  type="button"
                  className={`roster-card${entity.id === selectedId ? " is-on" : ""}${entity.dead ? " is-dead" : ""}`}
                  onDoubleClick={() => {
                    if (!entity.dead) centerOnEntity(entity);
                  }}
                  onPointerUp={(event) => handlePortraitPointerUp(event, entity)}
                  onClick={() => {
                    if (entity.dead) return;
                    // Обучение: выбор иного бойца запрещён — действует только
                    // исполнитель текущего указания (строгий сценарий, 0.20.13).
                    if (isTraining && trainingActorId !== null && entity.id !== trainingActorId) {
                      setLog(t("training.locked.actor"));
                      return;
                    }
                    setSelectedId(entity.id);
                    setAction(null);
                    setSkillTargetPos(null);
                    setAimId(null);
                  }}
                >
                  {face ? <img className="roster-face" src={face} alt="" draggable={false} /> : null}
                  <span className="roster-meta">
                    <span className="name">{t(unitNameKey(entity.configId))}</span>
                    <span className="diamonds" aria-label={t("field.ap", { current: entity.ap, max: entity.maxAp })}>
                      {Array.from({ length: entity.maxAp }, (_, index) => (
                        <i key={index} className={index < entity.ap ? "diamond is-on" : "diamond"} />
                      ))}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </header>

        <div className="battle-mid">
          {saveNotice ? (
            <p className="save-toast" role="status" aria-live="polite">
              <span className="save-toast-mark" aria-hidden="true">✓</span>
              {t("battle.saved")}
            </p>
          ) : null}
          {log ? (
            <p className="battle-log" role="status">
              {log}
            </p>
          ) : null}
          {hit ? (
            <div className="aim-card">
              <div className="aim-header">
                <span className={`aim-chance${hit.available ? "" : " blocked"}`}>
                  {hit.available
                    ? hit.chance === undefined ? t("combat.available") : `${hit.chance}%`
                    : t("combat.unavailable")}
                </span>
                {hit.available && hit.coverTarget ? (
                  // Атака по сущности укрытия: попадание не испытывается,
                  // укрытие разрушается (§10.4 math) — числа урона не показываются.
                  <span className="aim-dmg cover-destroy">{t("combat.destroyCover")}</span>
                ) : hit.available && hit.dmgMin !== undefined && hit.dmgMax !== undefined ? (
                  <span className="aim-dmg">
                    {t("combat.dmg", { dmg: `${hit.dmgMin}-${hit.dmgMax}` })}
                  </span>
                ) : null}
                {hit.breakdown ? (
                  <button
                    type="button"
                    className="aim-copy-btn"
                    title={t("combat.copyBreakdown")}
                    onClick={() => {
                      const b = hit.breakdown!;
                      const lines = [
                        `═══ ${t("combat.bdTotal")}: ${b.finalChance}% ═══`,
                        `${t("combat.bdBaseAim")}: +${b.baseAim}`,
                        b.weaponMod !== 0 ? `${t("combat.bdWeaponMod")}: ${b.weaponMod > 0 ? "+" : ""}${b.weaponMod}` : null,
                        b.heightAim !== 0 ? `${t("combat.bdHeight")}: ${b.heightAim > 0 ? "+" : ""}${b.heightAim}` : null,
                        b.targetDefense > 0 ? `${t("combat.bdDefense")}: −${b.targetDefense}` : null,
                        b.stanceDefense > 0 ? `${t("combat.bdDefend")}: −${b.stanceDefense}` : null,
                        b.coverPenalty > 0 ? `${t("combat.bdCover")}: −${b.coverPenalty}` : null,
                        b.rangePenalty > 0 ? `${t("combat.bdRange")}: −${b.rangePenalty}` : null,
                        b.coverDetails.length > 0 ? "" : null,
                        b.coverDetails.length > 0 ? t("combat.bdObstacleList") : null,
                        ...b.coverDetails.map((d) => `  ${t(d.label)}`),
                      ].filter(Boolean);
                      navigator.clipboard.writeText(lines.join("\n")).catch(() => {});
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                  </button>
                ) : null}
              </div>
              {hit.breakdown ? (
                <div className="breakdown-detail">
                  <span className="bd-item pos">
                    {t("combat.bdBaseAim")}: +{hit.breakdown.baseAim}
                  </span>
                  {hit.breakdown.weaponMod !== 0 ? (
                    <span className={`bd-item${hit.breakdown.weaponMod > 0 ? " pos" : " neg"}`}>
                      {t("combat.bdWeaponMod")}: {hit.breakdown.weaponMod > 0 ? "+" : ""}{hit.breakdown.weaponMod}
                    </span>
                  ) : null}
                  {hit.breakdown.heightAim !== 0 ? (
                    <span className={`bd-item${hit.breakdown.heightAim > 0 ? " pos" : " neg"}`}>
                      {t("combat.bdHeight")}: {hit.breakdown.heightAim > 0 ? "+" : ""}{hit.breakdown.heightAim}
                    </span>
                  ) : null}
                  {hit.breakdown.targetDefense > 0 ? (
                    <span className="bd-item neg">
                      {t("combat.bdDefense")}: −{hit.breakdown.targetDefense}
                    </span>
                  ) : null}
                  {hit.breakdown.stanceDefense > 0 ? (
                    <span className="bd-item neg">
                      {t("combat.bdDefend")}: −{hit.breakdown.stanceDefense}
                    </span>
                  ) : null}
                  {hit.breakdown.coverPenalty > 0 ? (
                    <span className="bd-item neg">
                      {t("combat.bdCover")}: −{hit.breakdown.coverPenalty}
                    </span>
                  ) : null}
                  {hit.breakdown.rangePenalty > 0 ? (
                    <span className="bd-item neg">
                      {t("combat.bdRange")}: −{hit.breakdown.rangePenalty}
                    </span>
                  ) : null}
                  {hit.breakdown.coverDetails.length > 0 ? (
                    <div className="bd-details">
                      <span className="bd-details-title">{t("combat.bdObstacleList")}</span>
                      {hit.breakdown.coverDetails.map((d, i) => (
                        <span key={i} className="bd-obs">
                          {t(d.label)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {!hit.available && hit.reason === "NO_LOS" && hit.breakCell ? (
                <div className="bd-details">
                  <span className="bd-obs">
                    {t("combat.blocked.NO_LOS")}: ({hit.breakCell.x},{hit.breakCell.y}) z={hit.breakCell.z}
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {isSpectator ? (
          <footer className="battle-bottom spectator-bar">
            <div className="spectator-note" role="status">
              <span className="spectator-eye" aria-hidden="true">◉</span>
              {t("net.spectator")}
              <span className="muted"> — {t("net.spectatorBody")}</span>
            </div>
          </footer>
        ) : (
        <footer className="battle-bottom">
          <div className="battle-selected">
            {selected ? (
              <div className="sel-row">
                {unitPortrait(selected.configId) ? (
                  <img
                    className="sel-face"
                    src={unitPortrait(selected.configId)}
                    alt=""
                    draggable={false}
                    onDoubleClick={() => centerOnEntity(selected)}
                    onPointerUp={(event) => handlePortraitPointerUp(event, selected)}
                  />
                ) : null}
                <div className="sel-info">
                  <p className="eyebrow">{t(unitNameKey(selected.configId))}</p>
                  <p>{t("battle.hp", { current: selected.hp, max: selected.maxHp })}</p>
                  <div className="hp-segs" aria-hidden="true">
                    {Array.from({ length: selected.maxHp }, (_, index) => (
                      <i key={index} className={index < selected.hp ? "on" : ""} />
                    ))}
                  </div>
                  <div className={`diamonds${hintPanelKey === "ap" ? " hint-pulse" : ""}`} aria-label={t("field.ap", { current: selected.ap, max: selected.maxAp })}>
                    {Array.from({ length: selected.maxAp }, (_, index) => (
                      <span key={index} className={index < selected.ap ? "diamond is-on" : "diamond"} />
                    ))}
                  </div>
                  <div className="status-list" aria-label={t("battle.statuses")}>
                    {selected.poison ? <span className="status-chip poison">{t("status.poison", { turns: selected.poison.turnsLeft })}</span> : null}
                    {selected.panic ? <span className="status-chip panic">{t("status.panic")}</span> : null}
                    {selected.immobileTurns ? <span className="status-chip immobile">{t("status.immobile")}</span> : null}
                    {selected.hidden ? <span className="status-chip hidden">{t("status.hidden")}</span> : null}
                    {selected.flying ? <span className="status-chip flying">{t("status.flying")}</span> : null}
                    {selected.timedLife !== undefined ? <span className="status-chip timed">{t("status.timed", { turns: selected.timedLife })}</span> : null}
                    {selected.defending ? <span className="status-chip defending">{t("status.defending")}</span> : null}
                    {selected.overwatch ? <span className="status-chip overwatch">{t("status.overwatch")}</span> : null}
                  </div>
                </div>
              </div>
            ) : (
              <p>{t("battle.empty")}</p>
            )}
          </div>
          <div className="skill-row">
            {(selected?.weaponIds ?? (selected?.weaponId ? [selected.weaponId] : [])).map((weaponId, index) => (
              <button
                key={`weapon-${weaponId}`}
                type="button"
                className={`hud-btn skill-slot${action?.type === "weapon" && action.id === weaponId ? " is-active" : ""}${hintPanelKey === "weapon" && trainingWeaponAllowed(weaponId) ? " hint-pulse" : ""}`}
                aria-pressed={action?.type === "weapon" && action.id === weaponId}
                data-action-state={action?.type === "weapon" && action.id === weaponId ? "active" : "inactive"}
                disabled={!selected || selected.ap <= 0 || busy || snapshot.activeOwner !== viewOwner || !trainingWeaponAllowed(weaponId)}
                onClick={() => {
                  const active = action?.type === "weapon" && action.id === weaponId;
                  setAction(active ? null : { type: "weapon", id: weaponId });
                  setSkillTargetPos(null);
                  setAimId(null);
                  setPreview(null);
                }}
              >
                {ACTION_SHORTCUTS[index] ? <kbd>{ACTION_SHORTCUTS[index]}</kbd> : null}
                {t(`weapon.${weaponId}.name`)}
              </button>
            ))}
            {(selected?.skillIds ?? []).map((skillId) => {
              const skill = skills[skillId];
              const active = action?.type === "skill" && action.id === skillId;
              const shortcut = selected ? shortcutForAction(selected, "skill", skillId) : undefined;
              const cooldown = selected?.skillCooldowns?.[skillId] ?? 0;
              const uses = selected?.skillUses?.[skillId] ?? 0;
              const usesLeft = skill?.maxUsesPerBattle === undefined ? undefined : Math.max(0, skill.maxUsesPerBattle - uses);
              const exhausted = usesLeft === 0;
              return (
                <button
                  key={`skill-${skillId}`}
                  type="button"
                  className={`hud-btn skill-slot${active ? " is-active" : ""}${cooldown > 0 ? " is-cooldown" : ""}${exhausted ? " is-exhausted" : ""}${hintPanelKey === "skill" && trainingSkillAllowed(skillId) ? " hint-pulse" : ""}`}
                  aria-pressed={active}
                  data-action-state={exhausted ? "exhausted" : cooldown > 0 ? "cooldown" : active ? "active" : "inactive"}
                  title={cooldown > 0 ? t("battle.cooldownHint", { turns: cooldown }) : exhausted ? t("battle.noUsesHint") : undefined}
                  disabled={!selected || selected.ap < (skill?.apCost ?? 1) || cooldown > 0 || exhausted || busy || snapshot.activeOwner !== viewOwner || !trainingSkillAllowed(skillId)}
                  onClick={() => {
                    if (skill?.category === "self" && (skill.radius ?? 0) <= 0) useSelfSkill(skillId);
                    else {
                      setAction(active ? null : { type: "skill", id: skillId });
                      setSkillTargetPos(null);
                      setAimId(null);
                      setPreview(null);
                    }
                  }}
                >
                  {shortcut ? <kbd>{shortcut}</kbd> : null}
                  {t(`skill.${skillId}.name`)}
                  {cooldown > 0 ? <span className="skill-resource cooldown">{t("battle.cooldownShort", { turns: cooldown })}</span> : null}
                  {usesLeft !== undefined ? <span className="skill-resource uses">{t("battle.usesShort", { uses: usesLeft })}</span> : null}
                </button>
              );
            })}
            <button
              type="button"
              className={`hud-btn skill-slot${selected?.defending ? " is-active" : ""}${hintPanelKey === "defend" ? " hint-pulse" : ""}`}
              aria-pressed={Boolean(selected?.defending)}
              data-action-state={selected?.defending ? "active" : "inactive"}
              disabled={!selected || selected.ap <= 0 || busy || snapshot.activeOwner !== viewOwner || !trainingAllows("defend")}
              title={t("battle.defendHint")}
              onClick={() => {
                if (selectedId === null) return;
                // Единый путь команд (0.19.2): как и клавиша 9 — через
                // applyCommand (транспорт в состязательном режиме, анимация
                // и продвижение подсказки в обучении).
                applyCommand({ type: "DEFEND", actorId: selectedId });
                setAction(null);
                setSkillTargetPos(null);
                setAimId(null);
                setPreview(null);
              }}
            >
              <kbd>9</kbd>
              {t("battle.defend")}
            </button>
            <button
              type="button"
              className={`hud-btn skill-slot${selected?.overwatch ? " is-active" : ""}${hintPanelKey === "overwatch" ? " hint-pulse" : ""}`}
              aria-pressed={Boolean(selected?.overwatch)}
              data-action-state={selected?.overwatch ? "active" : "inactive"}
              disabled={!selected || selected.ap <= 0 || busy || snapshot.activeOwner !== viewOwner || !trainingAllows("overwatch")}
              title={t("battle.overwatchHint")}
              onClick={() => {
                if (selectedId === null) return;
                // Единый путь команд (0.19.2): как и клавиша 0 — через
                // applyCommand (транспорт в состязательном режиме, анимация
                // и продвижение подсказки в обучении).
                applyCommand({ type: "OVERWATCH", actorId: selectedId });
                setAction(null);
                setSkillTargetPos(null);
                setAimId(null);
                setPreview(null);
              }}
            >
              <kbd>0</kbd>
              {t("battle.overwatch")}
            </button>
          </div>
          <button
            type="button"
            className={`hud-btn hud-btn-primary end-turn-btn${noActionPoints && snapshot.activeOwner === viewOwner ? " is-ready" : ""}${hintPanelKey === "end_turn" ? " hint-pulse" : ""}`}
            disabled={busy || snapshot.activeOwner !== viewOwner || !trainingAllows("endTurn")}
            onClick={() => endTurn()}
          >
            {t("field.endTurn")}
          </button>
        </footer>
        )}
      </div>

      {enemyPhase ? (
        <div className="phase-banner" role="status">
          {t("battle.enemyTurn")}
        </div>
      ) : null}

      {battleKind === "pvp" && !passReady ? (
        <div className="pass-device-root" role="presentation">
          <div className="pass-device-card" role="dialog" aria-modal="true" aria-labelledby="pass-title">
            <p className="eyebrow">{t("pvp.passHint")}</p>
            <h2 id="pass-title" className="pass-side-title">
              {viewOwner === 1 ? t("pvp.side1") : t("pvp.side2")}
            </h2>
            <p className="muted">{t("pvp.passBody")}</p>
            <button type="button" className="hud-btn hud-btn-primary pass-ready-btn" onClick={() => setPassReady(true)}>
              {t("pvp.ready")}
            </button>
          </div>
        </div>
      ) : null}

      {battleKind === "pvpNet" && isNetGuest && !session.getNetSnapshot() ? (
        <div className="pass-device-root" role="presentation">
          <div className="pass-device-card" role="dialog" aria-modal="true" aria-labelledby="net-sync-title">
            <p className="eyebrow">{t("net.waitHint")}</p>
            <h2 id="net-sync-title" className="pass-side-title">{t("net.syncing")}</h2>
            <p className="muted">{t("net.syncingBody")}</p>
            <span className="net-sync-spinner" aria-hidden="true" />
          </div>
        </div>
      ) : null}

      {battleKind === "pvpNet" && isNetGuest && session.getNetSnapshot() && snapshot.activeOwner !== viewOwner ? (
        <div className="pass-device-root" role="presentation">
          <div className="pass-device-card" role="dialog" aria-modal="true" aria-labelledby="net-wait-title">
            <p className="eyebrow">{t("net.waitHint")}</p>
            <h2 id="net-wait-title" className="pass-side-title">
              {t("net.opponentTurn")}
            </h2>
            <p className="muted">{t("net.waitBody")}</p>
          </div>
        </div>
      ) : null}

      {netDisconnected ? (
        <div className="pass-device-root" role="presentation">
          <div className="pass-device-card" role="dialog" aria-modal="true" aria-labelledby="net-lost-title">
            <p className="eyebrow">{t("net.waitHint")}</p>
            <h2 id="net-lost-title" className="pass-side-title">{t("net.connectionLost")}</h2>
            <p className="muted">
              {disconnectLeft > 0
                ? t("net.reconnectIn", { seconds: disconnectLeft })
                : t("net.reconnectExpired")}
            </p>
            <div className="net-lost-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  // Сохранение повтора выполняется слоем приложения (persistRef).
                  session.finishReplayDraft(null);
                  session.setNetDisconnected(false);
                  session.goTo("menu");
                }}
              >
                {t("net.saveReplay")}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  session.setNetDisconnected(false);
                  session.goTo("menu");
                }}
              >
                {t("net.leaveRoom")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isTraining && trainingOver ? (
        <div className="pause-root" role="presentation">
          <div className="pause-card training-over-card" role="dialog" aria-modal="true" aria-labelledby="training-over-title">
            <p className="eyebrow">{trainingMission ? t(trainingMission.titleKey) : t("training.title")}</p>
            <h2 id="training-over-title">
              {trainingOver === "victory" ? t("training.over.victory") : t("training.over.defeat")}
            </h2>
            <p className="muted">
              {trainingOver === "victory" ? t("training.over.victoryBody") : t("training.over.defeatBody")}
            </p>
            <button type="button" className="hud-btn hud-btn-primary" onClick={() => session.goTo("training")}>
              {t("training.over.back")}
            </button>
          </div>
        </div>
      ) : null}

      {paused ? (
        <div className="pause-root" role="presentation">
          <div className="pause-card" role="dialog" aria-modal="true" aria-labelledby="pause-title">
            <h2 id="pause-title">{t("battle.pause")}</h2>
            <details className="controls-help">
              <summary>{t("battle.controlsTitle")}</summary>
              <ul>
                <li><kbd>1–8</kbd> {t("battle.controls.weapons")}</li>
                <li><kbd>9</kbd> {t("battle.controls.defend")}</li>
                <li><kbd>0</kbd> {t("battle.controls.overwatch")}</li>
                <li><kbd>Tab</kbd> {t("battle.controls.next")}</li>
                <li><kbd>Esc</kbd> {t("battle.controls.pause")}</li>
                <li>{t("battle.controls.touch")}</li>
              </ul>
            </details>
            <button type="button" className="hud-btn hud-btn-primary" onClick={() => session.setPaused(false)}>
              {t("battle.resume")}
            </button>
            {battleKind === "campaign" ? (
              // «К карте корабля» приостанавливает миссию, не покидая её
              // (0.20.18): на карте можно вернуться в миссию или осознанно
              // покинуть её; «Продолжить» меню тоже возвращает в бой.
              <button type="button" className="hud-btn" onClick={() => session.suspendCampaignMission()}>
                {t("battle.toCampaignMap")}
              </button>
            ) : null}
            <button
              type="button"
              className="hud-btn"
              onClick={() => {
                // Выход в меню из боя кампании ПРИОСТАНАВЛИВАЕТ миссию
                // (0.20.17): suspendCampaignBattle сам переводит в меню,
                // сохраняя снимок партии в сессии — «Продолжить» главного
                // меню возвращает в бой. Покинуть миссию можно осознанно —
                // кнопкой «К карте корабля». Иные бои выходят в меню как
                // прежде (их партия эфемерна).
                if (battleKind === "campaign") session.suspendCampaignBattle();
                else session.goTo("menu");
              }}
            >
              {t("battle.toMenu")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
