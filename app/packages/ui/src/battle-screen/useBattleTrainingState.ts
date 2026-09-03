import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameEvent } from "@bylina/core";
import {
  directiveAllowsAction,
  resolveTrainingDirective,
  trainingActionKindOfCommand,
  trainingCommandAllowed,
  trainingDenialKey,
  trainingStepCompleted,
  type TrainingActionKind,
  type TrainingDirectiveView,
} from "../training-scenario.js";
import { shouldAutoEndTurn, trainingHintsSorted, trainingOutcome } from "../training-progress.js";
import type { BattleScreenBase } from "./useBattleScreenBase.js";
import type { BattleKinds } from "./useBattleKinds.js";
import type { BattleSnapshotModel } from "./useBattleSnapshot.js";
import type { BattleIntentModel } from "./useBattleIntentState.js";

export function useBattleTrainingState(
  base: BattleScreenBase,
  kinds: BattleKinds,
  snapshotModel: BattleSnapshotModel,
  intentModel: BattleIntentModel,
  kernelSkills: Record<string, import("@bylina/core").SkillStats>,
) {
  const { session, t, setLog, outcomeGate, hintSettings, prologueStanceLock } = base;
  const { isTraining, isPrologue, trainingMission } = kinds;
  const { battleRevision, snapshot } = snapshotModel;
  const { selectedId } = intentModel;
  const skills: Record<string, import("@bylina/core").SkillStats> = kernelSkills;

  // Режим обучения (0.19.0): активный шаг подсказки; отслеживание событий
  // для перехода к следующему шагу. Шаги выполняются по порядку поля step
  // конфигурации (0.19.1): порядок массива hints значения не имеет.
  const [hintStep, setHintStep] = useState(0);
  // Завершение миссии обучения: итоговая плашка вместо мгновенного возврата
  // (ui-design §3: «… → итог → экран обучения»). Пройденной считается только
  // победа (0.19.1).
  const [trainingOver, setTrainingOver] = useState<"victory" | "defeat" | null>(null);
  // Реактивные плашки обучения (0.20.1): отравление, воскрешение, призыв.
  // Показываются событиями любой стороны (яд накладывает кикимора в свой ход).
  const [trainingNote, setTrainingNote] = useState<string | null>(null);
  const noteTimerRef = useRef<number | undefined>(undefined);

  const trainingHints = useMemo(() => {
    if (!isTraining || !trainingMission) return [];
    return trainingHintsSorted(trainingMission.hints);
  }, [isTraining, trainingMission]);

  const activeHint = trainingHints[hintStep] ?? null;

  // Строгий сценарий (0.20.13): активный шаг превращается в точное указание
  // (клетка, оружие, умение, цель, исполнитель). Всё остальное интерфейс не
  // исполняет; подсветка указания — единственный яркий элемент поля.
  const directiveView = useMemo<TrainingDirectiveView | null>(() => {
    // Ревизия боя — намеренный триггер пересчёта указания (зависит от
    // достижимости, предпросмотров и состояния цели).
    void battleRevision;
    if (!isTraining || !activeHint || trainingOver) return null;
    const full = session.getBattleFullSnapshot();
    if (!full) return null;
    return resolveTrainingDirective(activeHint, {
      snapshot: full,
      reachable: (actorId) => session.getBattleReachable(actorId),
      hitPreview: (actorId, targetId, weaponId) => session.getBattleHitPreview(actorId, targetId, weaponId),
      skillPreview: (actorId, skillId, targetId, pos) =>
        session.getBattleSkillPreview(actorId, skillId, targetId, pos),
      skills,
    });
    // Пересчёт на каждое изменение боя (ревизия): указание зависит от
    // достижимости, предпросмотров и состояния цели. Полный снимок ведущего
    // читается внутри. Тело ссылается только на сервисы/неизменные аргументы.
  }, [isTraining, activeHint, trainingOver, skills, battleRevision, session]);

  // Указание, оказавшееся невыполнимым (исполнитель погиб, цель уже мертва,
  // умение исчерпано), пропускается — сценарий самовосстанавливается.
  useEffect(() => {
    if (!isTraining || !activeHint || trainingOver) return;
    if (directiveView === null) setHintStep((value) => value + 1);
  }, [isTraining, activeHint, directiveView, trainingOver]);

  const trainingHighlight = directiveView?.highlight ?? null;
  const trainingFocus = isTraining && directiveView !== null;
  const trainingDirective = directiveView?.directive ?? null;
  const trainingActorId =
    trainingDirective && trainingDirective.kind !== "noop" && trainingDirective.kind !== "endTurn"
      ? trainingDirective.actorId
      : null;

  const trainingDone = isTraining && trainingHints.length > 0 && hintStep >= trainingHints.length;

  // Обновление шага по событиям действия ИГРОКА (0.19.1): подсказка
  // завершается только действием игрока — события хода Нави подсказки
  // не продвигают. Шаги с repeatUntil (0.20.13) проверяются по снимку:
  // «бить до победы» не завершается единичной атакой.
  const advanceTraining = useCallback(
    (events: GameEvent[]): void => {
      if (!isTraining || !activeHint) return;
      const full = session.getBattleFullSnapshot();
      if (trainingStepCompleted(activeHint, events, full ?? snapshot)) setHintStep((value) => value + 1);
    },
    [isTraining, activeHint, session, snapshot],
  );

  // Реактивные плашки (0.20.1): отравление, воскрешение, призыв.
  // Показываются любыми событиями (яд накладывает кикимора в свой ход).
  const showTrainingNote = useCallback(
    (events: GameEvent[]): void => {
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
    },
    [isTraining, trainingMission],
  );

  useEffect(
    () => () => {
      if (noteTimerRef.current !== undefined) window.clearTimeout(noteTimerRef.current);
    },
    [],
  );

  // Завершение миссии обучения (0.19.0; строгий сценарий 0.20.13). Пути к победе:
  // - миссия без противника («Первые шаги») завершается выполнением ВСЕХ
  //   шагов подсказки: по правилам ядра такая партия «выиграна» с самого
  //   начала, поэтому исход ядра здесь неприменим;
  // - миссия с противником («Бой», «Умения и состояния») играется до итога
  //   боя — уничтожения всех противников: последний шаг сценария
  //   (repeatUntil victory) ведёт игрока указаниями до самой победы, поэтому
  //   реактивные плашки (яд, воскрешение) успевают сработать.
  // Поражение — гибель всех бойцов игрока: Навь в обучении действует.
  // Итог обучения — так же после анимаций и паузы (0.20.39).
  useEffect(() => {
    if (!isTraining || base.busy || trainingOver) return;
    // Путь к победе (шаги подсказки или исход ядра) выбирает training-progress.
    const outcome = trainingOutcome({
      outcome: session.getBattleOutcome(),
      missionHasEnemies: (trainingMission?.enemies.length ?? 0) > 0,
      trainingDone,
    });
    if (outcome === null) return;
    if (outcome === "victory" && trainingMission) session.completeTrainingMission(trainingMission.id);
    // Итог обучения — так же после анимаций и паузы (0.20.39).
    outcomeGate.report(() => setTrainingOver(outcome));
  }, [
    snapshot.turnNumber,
    snapshot.entities,
    base.busy,
    isTraining,
    trainingDone,
    trainingHints.length,
    hintStep,
    trainingOver,
    trainingMission,
    outcomeGate,
    session,
  ]);

  // Ограничение действий в обучении (строгий сценарий, 0.20.13): игрок может
  // совершать только то действие, которое предписывает активное указание, —
  // и только указанным исполнителем, оружием, умением и целью. Пауза и выход
  // из обучения остаются доступны всегда. Отклонённое действие объясняется
  // строкой лога (ключи training.locked.*, ui-design §4.5).
  const trainingAllows = useCallback(
    (action: TrainingActionKind): boolean => {
      if (isPrologue && prologueStanceLock) return action === "defend";
      return directiveAllowsAction(directiveView, action);
    },
    [isPrologue, prologueStanceLock, directiveView],
  );

  const trainingDeny = useCallback(
    (action: TrainingActionKind): void => {
      if (directiveView) setLog(t(trainingDenialKey(directiveView, action)));
    },
    [directiveView, setLog, t],
  );

  /** Разрешено ли текущее указание этому исполнителю с этим оружием. */
  const trainingWeaponAllowed = useCallback(
    (weaponId: string): boolean => {
      if (isPrologue && prologueStanceLock) return false;
      return !isTraining || (trainingDirective?.kind === "attack" && trainingDirective.weaponId === weaponId);
    },
    [isPrologue, prologueStanceLock, isTraining, trainingDirective],
  );

  /** Разрешено ли текущее указание этому умению. */
  const trainingSkillAllowed = useCallback(
    (skillId: string): boolean => {
      if (isPrologue && prologueStanceLock) return false;
      return !isTraining || (trainingDirective?.kind === "skill" && trainingDirective.skillId === skillId);
    },
    [isPrologue, prologueStanceLock, isTraining, trainingDirective],
  );

  // Конец хода стороны наступает сам, когда ни один боец стороны не имеет
  // допустимых действий (math §16.7): при нулевых запасах ОД всех живых
  // бойцов активной стороны ход передаётся следующей стороне без команды.
  // В обучении автозавершение отключается на шаге «завершите ход» —
  // этот шаг учит нажимать кнопку. Повторы и наблюдатель ход не завершают.
  // Этап 1.5: вне обучения автозавершение включается настройкой игры.
  // Состав живых бойцов и активный владелец меняются только с боем — ревизия
  // служит триггером проверки автозавершения (0.21.11); endTurn и
  // battleOutcome читают свежее состояние через замыкание монтирования.
  const autoEndTurnDeps = {
    isTraining,
    isReplay: kinds.isReplay,
    isSpectator: kinds.isSpectator,
    isNetGuest: Boolean(kinds.isNetGuest),
    hintSettings,
    activeHint,
    prologueStanceLock,
    isPrologue,
  };

  return {
    hintStep,
    setHintStep,
    trainingHints,
    activeHint,
    directiveView,
    trainingHighlight,
    trainingFocus,
    trainingDirective,
    trainingActorId,
    trainingDone,
    trainingOver,
    setTrainingOver,
    trainingNote,
    setTrainingNote,
    advanceTraining,
    showTrainingNote,
    trainingAllows,
    trainingDeny,
    trainingWeaponAllowed,
    trainingSkillAllowed,
    trainingCommandAllowed: (issued: unknown) => trainingCommandAllowed(directiveView, issued as never),
    trainingActionKindOfCommand,
    autoEndTurnDeps,
    shouldAutoEndTurn,
  };
}

export type BattleTrainingModel = ReturnType<typeof useBattleTrainingState>;
