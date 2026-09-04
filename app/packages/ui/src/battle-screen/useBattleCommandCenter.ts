import { useCallback, useEffect } from "react";
import {
  ENEMY_OWNER,
  PLAYER_OWNER,
  distH,
  isCaptive,
  pickEnemyCommand,
  pickScriptedEnemyCommand,
  type CellPos,
  type Command,
  type EntityState,
  type GameEvent,
  type TacticsKernel,
} from "@bylina/core";
import { prologueAftermath, routeCommand } from "../battle-command.js";
import { gatePrologueCommand, clampPrologueCommand } from "../prologue-battle.js";
import { resolveCellClick } from "../battle-cell-click.js";
import { meleeStrikeOf, planCharge, type ChargePlan, type MeleeStrike } from "../charge-attack.js";
import { cellKey } from "../cell-interaction.js";
import { firstFighterId } from "../battle-selection.js";
import { enemyPhaseActive, enemyPhaseContinues, type EnemyPhaseState } from "../battle-enemy-phase.js";
import { useLatest } from "../hooks.js";
import type { BattleScreenBase } from "./useBattleScreenBase.js";
import type { BattleKinds } from "./useBattleKinds.js";
import type { BattleSnapshotModel } from "./useBattleSnapshot.js";
import type { BattleIntentModel } from "./useBattleIntentState.js";
import type { BattleTrainingModel } from "./useBattleTrainingState.js";
import type { BattlePrologueModel } from "./useBattlePrologueState.js";
import type { BattleOutcomeModel } from "./useBattleOutcomeGate.js";
import type { BattleKernelModel } from "./useBattleKernel.js";
import type { BattleAimPreviewModel } from "./useBattleAimPreview.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function allOwnApSpent(entities: readonly EntityState[], owner: number): boolean {
  let fighters = 0;
  for (const entity of entities) {
    if (entity.dead || entity.coverType !== 0 || entity.owner !== owner || entity.maxAp === 0) continue;
    fighters += 1;
    if (entity.ap > 0) return false;
  }
  return fighters > 0;
}

// Используется в JSX: аргументы (configId) ← сущность
function unitNameKey(configId: string): string {
  return `unit.${configId}.name`;
}

export interface BattleCommandCenterDeps {
  base: BattleScreenBase;
  kinds: BattleKinds;
  kernelModel: BattleKernelModel;
  snapshotModel: BattleSnapshotModel;
  intentModel: BattleIntentModel;
  training: BattleTrainingModel;
  prologue: BattlePrologueModel;
  outcome: BattleOutcomeModel;
  aim: BattleAimPreviewModel;
}

export function useBattleCommandCenter(deps: BattleCommandCenterDeps) {
  const { base, kinds, kernelModel, snapshotModel, intentModel, training, prologue, outcome, aim } = deps;
  const {
    session,
    t,
    setLog,
    setBusy,
    outcomeGate,
    rendererRef,
    hintSettings,
    content,
    debug,
    paused,
    setPrologueStanceLock,
  } = base;
  const { kernel, weapons, skills } = kernelModel;
  const { snapshot } = snapshotModel;
  const {
    isTraining,
    isPrologue,
    isReplay,
    isSpectator,
    isNetGuest,
    battleKind,
    viewOwner,
    usesNetSnapshot,
    trainingMission,
    prologueMission,
  } = kinds;
  const { selectedId, selected, action, aimId, skillTargetPos, charge, chargeArmed, setIntent, clearAim } = intentModel;
  const {
    trainingDirective,
    trainingActorId,
    trainingAllows,
    trainingDeny,
    trainingCommandAllowed: trainingCmdAllowed,
    trainingActionKindOfCommand,
    advanceTraining,
    showTrainingNote,
    setHintStep,
    trainingHints,
    directiveView,
  } = training;
  const {
    prologueRunRef,
    prologueTelemetryRef,
    prologueCard,
    prologueHintKey,
    setPrologueCard,
    setPrologueHintKey,
    setPrologueObjectiveKey,
    battleOutcome,
    showPrologueHint,
    currentPrologueHintKey,
    director,
    afterPrologueApply: applyPrologueAfter,
    buildPrologueContext: buildContext,
    recordTelemetry: recTelemetry,
  } = prologue;
  const { finishFromEvents } = outcome;

  const announce = useCallback(
    (events: GameEvent[]): void => {
      const combat = events.find((event) => event.type === "COMBAT_RESOLVED");
      if (combat && combat.type === "COMBAT_RESOLVED") {
        if (combat.result === "MISS") setLog(t("combat.miss"));
        else if (combat.result === "CRIT") setLog(t("combat.crit", { dmg: combat.damageDealt }));
        else setLog(t("combat.hit", { dmg: combat.damageDealt }));
      }
      if (events.some((event) => event.type === "ENTITY_DIED")) setLog(t("combat.died"));
    },
    [setLog, t],
  );

  const playThen = useCallback(
    (events: GameEvent[], after?: () => void): void => {
      setBusy(true);
      // Пока события играют, итог не показывается (0.20.39): пауза
      // отсчитывается от конца проигрывания, а не от момента команды.
      outcomeGate.playbackStart();
      void (rendererRef.current?.play(events) ?? Promise.resolve()).finally(() => {
        setBusy(false);
        outcomeGate.playbackEnd();
        finishFromEvents(events);
        after?.();
      });
    },
    [rendererRef, outcomeGate, setBusy, finishFromEvents],
  );

  // Единственный канал команд: маршрут — куда уходит команда и пропускают
  // ли её сценарии — решает battle-command, здесь исполнение и последствия.
  const applyCommand = useCallback(
    (command: Command, after?: () => void): void => {
      const route = routeCommand(command, {
        isSpectator,
        isReplay,
        outcomePending: base.outcomePending,
        isPvp: battleKind === "pvp",
        isNetGuest,
        isTraining,
        trainingAllows: (issued) => trainingCmdAllowed(issued),
        trainingDenial: trainingActionKindOfCommand,
        isPrologue,
        // Сцена М2 обрывает рывок на полпути (0.20.45): пока засада впереди,
        // герою оставляют одно ОД на защитную стойку.
        clampPrologue:
          isPrologue && kernel && prologueRunRef.current
            ? (issued) => clampPrologueCommand(kernel, prologueRunRef.current!, issued, prologueMission?.playerSlots)
            : null,
        prologueAllows:
          isPrologue && prologueRunRef.current
            ? (issued) => gatePrologueCommand(prologueRunRef.current!, issued)
            : null,
      } as Parameters<typeof routeCommand>[1]);
      switch (route.kind) {
        case "drop":
          return;
        case "sendPvp":
          session.sendPvpCommand(command);
          return;
        case "sendNet":
          session.sendNetCommand(command);
          return;
        case "denyTraining":
          trainingDeny(route.action as Parameters<typeof trainingDeny>[0]);
          return;
        case "denyPrologue":
          // Иное действие, кроме стойки, вновь открывает реплику засады
          // (0.21.21): сообщение остаётся доступным, пока игрок не примет стойку
          // по условию сцены.
          showPrologueHint(currentPrologueHintKey() ?? "m2.noise");
          return;
        case "apply":
          break;
      }
      const issued = route.command;
      const result = session.applyBattleCommand(issued);
      if (!result.ok) {
        // Отклонённая команда объясняется игроку (0.20.2): в обучении шаги
        // ограничены, и без отклика неясно, почему действие не сработало.
        // Ключ `battle.reject.<причина>`; неизвестная причина — общий текст.
        const key = `battle.reject.${result.reason}`;
        setLog(t(key) === key ? t("battle.reject.generic") : t(key));
        return;
      }
      announce(result.events);
      let prologueAfter: (() => void) | null = null;
      // Итог миссии: показывается после анимаций и паузы (0.20.39).
      let prologueFinished = false;
      if (isPrologue && kernel && prologueMission && prologueRunRef.current) {
        const ctx = buildContext(prologueMission, content, hintSettings.showHints);
        const next = applyPrologueAfter(kernel, issued, result.events, prologueRunRef.current, ctx);
        // Принудительная стойка (0.20.45): пульсация кнопки и закрытые
        // прочие действия живут ровно до команды «DEFEND».
        setPrologueStanceLock(next.forceDefend);
        // Что делать с итогами команды — решает battle-command: откат к
        // контрольной точке, честное поражение или выход стаи сценой.
        const aftermath = prologueAftermath({
          next,
          events: result.events,
          snapshot: kernel.getSnapshot(),
          hasCheckpoint: session.hasBattleCheckpoint(),
        });
        prologueRunRef.current = aftermath.state;
        // Контрольная точка миссии: вход в миссию уже её обеспечен, дальше —
        // ключевые сюжетные вехи, включая выход крысы М1. Вместе со снимком
        // ядра сохраняется и состояние сцены — откат возвращает миссию целиком.
        const armed = next.fedotFreed || next.firstWave || next.vasilisaJoined || next.ratSpawned;
        if (armed && !session.hasBattleCheckpoint()) {
          session.saveBattleCheckpoint(aftermath.state);
        }
        switch (aftermath.kind) {
          case "restore":
            prologueTelemetryRef.current = recTelemetry(prologueTelemetryRef.current, {
              type: "death_by",
              cause: "checkpoint",
            });
            prologueAfter = () => void director.restoreScene();
            break;
          case "defeat":
            prologueTelemetryRef.current = recTelemetry(prologueTelemetryRef.current, {
              type: "death_by",
              cause: "checkpoint",
            });
            prologueFinished = true;
            break;
          case "spawnBeats":
            // Сущность уже создана ядром, но на поле её не показываем до
            // вбегания по сцене (0.20.39): иначе она возникает в клетке,
            // пропадает и выбегает заново.
            director.hideSpawns(aftermath.events);
            // Сначала стая выбегает, потом загорается выход (0.20.45).
            prologueAfter = () =>
              void director.runSpawnBeats(aftermath.events).then(() => director.revealExtractBeat());
            break;
          case "none":
            break;
        }
        const hint = next.hints.forcedKey ?? next.hints.queue[0] ?? null;
        if (hint && hint !== prologueHintKey) {
          prologueTelemetryRef.current = recTelemetry(prologueTelemetryRef.current, {
            type: "hint_shown",
            key: hint,
          });
        }
        setPrologueHintKey(hint);
        setPrologueObjectiveKey(next.objectiveKey);
        if (next.outcome !== "ongoing") prologueFinished = true;
      }
      // Подсказка обучения продвигается событиями действия самого игрока (0.19.1);
      // реактивные плашки (яд, воскрешение) показываются любыми событиями (0.20.1).
      advanceTraining(result.events);
      showTrainingNote(result.events);
      clearAim();
      // Рывок: удар подаётся после того, как боец дошёл (0.20.50).
      playThen(
        result.events,
        after || prologueAfter
          ? () => {
              prologueAfter?.();
              after?.();
            }
          : undefined,
      );
      // После playThen: проигрывание уже началось, и гейт выдержит паузу
      // от его конца, а не от момента команды.
      if (prologueFinished) outcomeGate.report(() => setPrologueCard("outro"));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, kinds, kernel, intentModel, training, prologue, outcome, announce, playThen, session, setLog, t],
  );

  // Вспомогательная ссылка на свежий applyCommand для замыкания PvP-подписки
  const applyCommandRef = useLatest(applyCommand);
  const announceRef = useLatest(announce);
  const clearAimRef = useLatest(clearAim);
  const playThenRef = useLatest(playThen);

  // События поочерёдного боя приходят через транспорт (0.14.0/0.15.0):
  // локальный — на одном устройстве, сетевой — ведомому от ведущего.
  useEffect(() => {
    if (battleKind !== "pvp" && battleKind !== "pvpNet") return;
    const unlisten = session.subscribePvpEvents((events) => {
      announceRef.current(events);
      clearAimRef.current();
      playThenRef.current(events);
    });
    return unlisten;
    // Подписка на транспорт живёт весь экран: announce/clearAim/playThen —
    // функции компонента, читающие свежее состояние через замыкание каждого
    // рендера, но добавлять их в зависимости нельзя (пересоздавались бы на
    // каждом рендере и рвали подписку). kernel/session/battleKind стабильны.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kernel, battleKind, session]);

  // Передача устройства в поочерёдной игре: при смене хода экран ждёт
  // подтверждения нового игрока, прежде чем показать его панель.
  useEffect(() => {
    base.setPassReady(false);
  }, [snapshot.turnNumber, kinds.pvpActive]);

  const tryMove = useCallback(
    (to: CellPos): void => {
      if (selectedId === null || paused || base.busy || base.outcomePending) return;
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
    },
    [
      applyCommand,
      selectedId,
      paused,
      base.busy,
      base.outcomePending,
      snapshot.activeOwner,
      viewOwner,
      isTraining,
      trainingDirective,
      trainingDeny,
    ],
  );

  const tryAttack = useCallback(
    (targetId: number): void => {
      if (selectedId === null || !action || paused || base.busy) return;
      if (snapshot.activeOwner !== viewOwner) return;
      // Обучение: только предписанное оружие/умение, исполнитель и цель
      // (строгий сценарий, 0.20.13). tryAttack обслуживает и оружейную атаку,
      // и умение по существу.
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
      const cmd: Command =
        action.type === "weapon"
          ? { type: "ATTACK", actorId: selectedId, targetId, weaponId: action.id }
          : {
              type: "USE_SKILL",
              actorId: selectedId,
              targetId,
              targetPos: skillTargetPos ?? undefined,
              skillId: action.id,
            };
      applyCommand(cmd);
    },
    [
      applyCommand,
      selectedId,
      action,
      paused,
      base.busy,
      snapshot.activeOwner,
      viewOwner,
      isTraining,
      trainingDirective,
      trainingDeny,
      skillTargetPos,
    ],
  );

  /** Применить умение «на себя» — одно ОД, ход не завершается. */
  const applySelfSkill = useCallback(
    (skillId: string): void => {
      if (selectedId === null || paused || base.busy || snapshot.activeOwner !== viewOwner) return;
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
    },
    [
      applyCommand,
      selectedId,
      paused,
      base.busy,
      snapshot.activeOwner,
      viewOwner,
      isTraining,
      trainingDirective,
      trainingDeny,
    ],
  );

  /** «Освобождение»: особое действие рядом с захваченным лицом — одно ОД,
   * ход не завершается. Доступно только игроку в его ход и вне стойки (§7.2). */
  const applyLiberate = useCallback((): void => {
    if (!selected || selected.dead || selected.owner !== viewOwner) return;
    const captive = snapshot.entities.find(
      (entity) =>
        !entity.dead &&
        entity.id !== selected.id &&
        isCaptive(entity, snapshot.objective) &&
        distH(selected.x, selected.y, entity.x, entity.y) <= 1,
    );
    if (!captive || paused || base.busy || snapshot.activeOwner !== viewOwner || base.prologueStanceLock) return;
    applyCommand({ type: "INTERACT", actorId: selected.id, targetId: captive.id });
    setIntent({ type: "cancel" });
  }, [applyCommand, selected, viewOwner, snapshot, paused, base.busy, base.prologueStanceLock, setIntent]);

  /** Позиционное умение: первое нажатие выставляет цель, второе по той же позиции — применяет. */
  const tryPositionSkill = useCallback(
    (pos: CellPos): void => {
      if (selectedId === null || action?.type !== "skill" || paused || base.busy) return;
      // Обучение: позиционное умение применяется только в подсвеченную клетку указания
      // (строгий сценарий, 0.20.13).
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
        setIntent({ type: "positionSkill", pos });
        return;
      }
      applyCommand({
        type: "USE_SKILL",
        actorId: selectedId,
        skillId: action.id,
        targetId: aimId ?? undefined,
        targetPos: pos,
      });
    },
    [
      applyCommand,
      selectedId,
      action,
      paused,
      base.busy,
      isTraining,
      trainingDirective,
      trainingDeny,
      skillTargetPos,
      aimId,
      setIntent,
    ],
  );

  /**
   * План рывка к цели (0.20.50): `null`, если подойти нечем или режим
   * не позволяет соединить две команды в один замысел. В поочерёдной и
   * сетевой игре команды уходят транспортом, дождаться подхода здесь
   * нельзя; в обучении шаги предписаны сценарием.
   */
  const chargeFor = useCallback(
    (target: EntityState): ChargePlan | null => {
      if (isTraining || isReplay || isSpectator || usesNetSnapshot) return null;
      if (!kernel || selectedId === null) return null;
      const actor = snapshot.entities.find((entity) => entity.id === selectedId);
      const strike = meleeStrikeOf(action, weapons, skills);
      if (!actor || !strike || actor.dead) return null;
      return planCharge({
        snapshot,
        actor,
        target,
        strike,
        reachable: session.getBattleReachable(actor.id),
        pathOf: (cell) => session.getBattlePath(actor.id, cell),
      });
    },
    [
      isTraining,
      isReplay,
      isSpectator,
      usesNetSnapshot,
      kernel,
      selectedId,
      snapshot,
      action,
      weapons,
      skills,
      session,
    ],
  );

  /**
   * Рывок к цели: подход и удар одним замыслом (0.20.50).
   *
   * Подход исполняется обычной командой перемещения, удар — обычной
   * командой атаки уже после того, как боец дошёл. Если за время подхода
   * удар стал невозможен — дозорный выстрел, гибель, помеха, — он не
   * исполняется: экран сообщает об этом, боец остаётся на клетке подхода.
   */
  const executeCharge = useCallback(
    (plan: ChargePlan): void => {
      if (!action || selectedId === null) return;
      const strike: MeleeStrike | null = meleeStrikeOf(action, weapons, skills);
      if (!strike) return;
      const actorId = selectedId;
      const targetId = plan.targetId;
      setIntent({ type: "cancel" });
      applyCommand({ type: "MOVE", actorId, to: plan.step, path: plan.path }, () => {
        const fresh = session.getBattleSnapshot(viewOwner);
        const actor = fresh.entities.find((entity) => entity.id === actorId);
        if (!actor || actor.dead || fresh.activeOwner !== viewOwner || actor.ap < strike.apCost) {
          setLog(t("battle.chargeBroken"));
          return;
        }
        const available =
          strike.kind === "weapon"
            ? session.getBattleHitPreview(actorId, targetId, strike.id).available
            : session.getBattleSkillPreview(actorId, strike.id, targetId).available;
        if (!available) {
          setLog(t("battle.chargeBroken"));
          return;
        }
        applyCommand(
          strike.kind === "weapon"
            ? { type: "ATTACK", actorId, targetId, weaponId: strike.id }
            : { type: "USE_SKILL", actorId, targetId, skillId: strike.id },
        );
      });
    },
    [applyCommand, action, selectedId, weapons, skills, setIntent, session, viewOwner, setLog, t],
  );

  /**
   * Отладочная автопобеда: мгновенно уничтожает всех противников и открывает
   * итог победы. Доступна только в отладочном режиме (?debug=1) и не действует
   * в повторе (0.20.1). В обучении победа определяется шагами подсказки —
   * автопобеда довершает и их, чтобы итог действительно открылся (0.20.2).
   */
  const debugAutoWin = useCallback((): void => {
    if (paused || base.busy || isReplay || !debug) return;
    const result = session.debugAutoWinBattle();
    if (!result.ok) return;
    if (isTraining) setHintStep(trainingHints.length);
    setIntent({ type: "cancel" });
    playThen(result.events);
  }, [paused, base.busy, isReplay, debug, session, isTraining, setHintStep, trainingHints.length, setIntent, playThen]);

  /**
   * Собственно конец хода: команда, проигрывание событий, ход Нави и
   * возврат управления игроку. Вынесено из `endTurn`, потому что тем же
   * порядком сцена передаёт ход сопернику сама (шаг `handOff`, 0.20.40) —
   * кнопка при этом не нажата и проверок кнопки быть не должно.
   */
  const runEndTurnSequence = useCallback(async (): Promise<void> => {
    const result = session.applyBattleCommand({ type: "END_TURN", playerId: String(viewOwner) });
    if (!result.ok) return;
    setBusy(true);
    // Проигрывание хода: итог показывается после него и паузы (0.20.39).
    outcomeGate.playbackStart();
    try {
      if (isPrologue && kernel && prologueMission && prologueRunRef.current) {
        const ctx = buildContext(prologueMission, content, hintSettings.showHints);
        const next = applyPrologueAfter(
          kernel,
          { type: "END_TURN", playerId: String(viewOwner) },
          result.events,
          prologueRunRef.current,
          ctx,
        );
        prologueRunRef.current = next;
        setPrologueObjectiveKey(next.objectiveKey);
        if (next.outcome !== "ongoing") outcomeGate.report(() => setPrologueCard("outro"));
      }
      advanceTraining(result.events);
      showTrainingNote(result.events);
      await (rendererRef.current?.play(result.events) ?? Promise.resolve());
      outcomeGate.playbackEnd();
      finishFromEvents(result.events);
      if (battleOutcome() === "ongoing" && session.getBattleSnapshot(PLAYER_OWNER).activeOwner === ENEMY_OWNER) {
        await runEnemyPhase();
      } else if (isPrologue && battleOutcome() === "ongoing") {
        await director.runPlayerScript();
      }
    } finally {
      outcomeGate.playbackEnd();
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    session,
    viewOwner,
    setBusy,
    outcomeGate,
    isPrologue,
    kernel,
    prologueMission,
    prologueRunRef,
    buildContext,
    content,
    hintSettings,
    applyPrologueAfter,
    setPrologueObjectiveKey,
    setPrologueCard,
    advanceTraining,
    showTrainingNote,
    rendererRef,
    finishFromEvents,
    battleOutcome,
    director,
  ]);

  /**
   * Весь ход Нави — проигрывание: итог показывается после него (0.20.39).
   */
  const runEnemyPhase = useCallback(async (): Promise<void> => {
    base.setEnemyPhase(true);
    // Отложенные постановочные действия: откат к контрольной точке или выход
    // противника — исполняются после проигрывания событий хода.
    let enemyAfter: (() => void) | null = null;
    // Весь ход Нави — проигрывание: итог показывается после него (0.20.39).
    outcomeGate.playbackStart();
    try {
      // В обучении без противника («Первые шаги») ход Нави отсутствует:
      // завершаем его сразу, возвращая управление игроку. В миссиях с
      // противником («Бой», «Умения и состояния») Навь действует строго по
      // сценарию миссии (0.20.13, game-design §3.5): постоянные правила и
      // линейная очередь действий заданы в training.json5 (enemyScript);
      // когда очередь исчерпана, ход достаётся обычному детерминированному
      // алгоритму как предохранителю.
      if (isTraining && (trainingMission?.enemies.length ?? 0) === 0) {
        session.applyBattleCommand({ type: "END_TURN", playerId: String(ENEMY_OWNER) });
        finishFromEvents([]);
        return;
      }
      await sleep(430);
      // Свежий снимок на каждом круге: сцена идёт асинхронно, состояние
      // рендера могло устареть.
      const phase = (): EnemyPhaseState => ({
        activeOwner: session.getBattleSnapshot(PLAYER_OWNER).activeOwner,
        enemyOwner: ENEMY_OWNER,
        outcome: battleOutcome(),
        hasKernel: Boolean(kernel),
      });
      const { enemyScriptRef } = base;
      for (let guard = 0; guard < 96; guard += 1) {
        // Ядру нужно не только правило хода (оно в предикате), но и типы:
        // ниже по телу цикла оно уже не пусто.
        if (!kernel) break;
        if (!enemyPhaseActive(phase())) break;
        let command: Command | null;
        if (isTraining) {
          const scriptState = enemyScriptRef.current;
          const decision = pickScriptedEnemyCommand(kernel, trainingMission?.enemyScript, scriptState);
          enemyScriptRef.current = decision.state;
          command = decision.command;
        } else if (isPrologue && prologueMission && prologueRunRef.current) {
          const { tickPrologueEnemyTurn } = await import("../prologue-battle.js");
          const ctx = buildContext(prologueMission, content, hintSettings.showHints);
          const decision = tickPrologueEnemyTurn(kernel, prologueRunRef.current, ctx);
          prologueRunRef.current = decision.state;
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
        if (isPrologue && prologueMission && prologueRunRef.current && command) {
          const ctx = buildContext(prologueMission, content, hintSettings.showHints);
          const next = applyPrologueAfter(kernel, command, applied.events, prologueRunRef.current, ctx);
          // Тот же разбор итога, что и в канале команд: откат к контрольной
          // точке, честное поражение или выход стаи сценой.
          const aftermath = prologueAftermath({
            next,
            events: applied.events,
            snapshot: kernel.getSnapshot(),
            hasCheckpoint: session.hasBattleCheckpoint(),
          });
          prologueRunRef.current = aftermath.state;
          switch (aftermath.kind) {
            case "restore":
              prologueTelemetryRef.current = recTelemetry(prologueTelemetryRef.current, {
                type: "death_by",
                cause: "checkpoint",
              });
              // Затемнение и откат — после того, как ход Нави доигран.
              enemyAfter = () => void director.restoreScene();
              break;
            case "defeat":
              prologueTelemetryRef.current = recTelemetry(prologueTelemetryRef.current, {
                type: "death_by",
                cause: "checkpoint",
              });
              outcomeGate.report(() => setPrologueCard("outro"));
              break;
            case "spawnBeats":
              // Появление по сцене: на поле сущности нет до вбегания (0.20.39).
              director.hideSpawns(aftermath.events);
              enemyAfter = () => void director.runSpawnBeats(aftermath.events);
              break;
            case "none":
              break;
          }
          setPrologueObjectiveKey(next.objectiveKey);
          if (next.outcome !== "ongoing") outcomeGate.report(() => setPrologueCard("outro"));
        }
        finishFromEvents(applied.events);
        // Пустая команда — сценарий противника исчерпан: цикл завершён.
        if (!enemyPhaseContinues({ ...phase(), commandIssued: command !== null })) break;
        await sleep(190);
      }
      if (isPrologue && kernel && prologueMission && prologueRunRef.current) {
        await director.runPlayerScript();
      }
      if (enemyAfter) await enemyAfter();
    } finally {
      outcomeGate.playbackEnd();
      base.setEnemyPhase(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    kernel,
    isTraining,
    isPrologue,
    trainingMission,
    prologueMission,
    base,
    kinds,
    prologue,
    announce,
    showTrainingNote,
    finishFromEvents,
    director,
    rendererRef,
    session,
    outcomeGate,
  ]);

  /**
   * Передача хода сопернику сценой (0.20.40). Кнопка игрока не нажата:
   * сцена сама открывает ход Нави, чтобы поставленное появление сразу
   * перешло в действие — крыса М1 кусает героя, едва выбежав из леса.
   */
  const handOffTurnToEnemy = useCallback(async (): Promise<void> => {
    if (paused || isReplay || isSpectator) return;
    // Свежий снимок: сцена идёт асинхронно, состояние рендера могло устареть.
    if (session.getBattleSnapshot(viewOwner).activeOwner !== viewOwner) return;
    await runEndTurnSequence();
  }, [paused, isReplay, isSpectator, session, viewOwner, runEndTurnSequence]);

  /**
   * Конец хода: команда, проигрывание событий, ход Нави и
   * возврат управления игроку. Собственно конец хода — через кнопку.
   */
  const endTurn = useCallback((): void => {
    if (paused || base.busy || base.outcomePending) return;
    if (snapshot.activeOwner !== viewOwner) return;
    // Обучение: завершение хода — само по себе шаг сценария (0.20.13);
    // вне такого шага оно запрещено.
    if (isTraining && directiveView?.directive.kind !== "endTurn") {
      trainingDeny("endTurn");
      return;
    }
    setIntent({ type: "cancel" });
    setLog(null);
    if (battleKind === "pvp") {
      session.sendPvpCommand({ type: "END_TURN", playerId: String(viewOwner) });
      return;
    }
    if (isNetGuest) {
      session.sendNetCommand({ type: "END_TURN", playerId: String(viewOwner) });
      return;
    }
    if (
      isPrologue &&
      prologueRunRef.current &&
      !gatePrologueCommand(prologueRunRef.current, { type: "END_TURN", playerId: String(viewOwner) })
    ) {
      // «Конец хода» — тоже действие: при стойке оно закрыто и повторно
      // открывает реплику засады (0.21.21).
      showPrologueHint(currentPrologueHintKey() ?? "m2.noise");
      return;
    }
    void runEndTurnSequence();
  }, [
    paused,
    base.busy,
    base.outcomePending,
    snapshot.activeOwner,
    viewOwner,
    isTraining,
    directiveView,
    trainingDeny,
    setIntent,
    setLog,
    battleKind,
    isNetGuest,
    isPrologue,
    prologueRunRef,
    deps.prologue,
    showPrologueHint,
    currentPrologueHintKey,
    runEndTurnSequence,
    session,
  ]);

  // Автозавершение хода стороны наступает само, когда ни один боец стороны не имеет
  // допустимых действий (math §16.7): при нулевых запасах ОД всех живых
  // бойцов активной стороны ход передаётся следующей стороне без команды.
  // В обучении автозавершение отключается на шаге «завершите ход» —
  // этот шаг учит нажимать кнопку. Повторы и наблюдатель ход не завершают.
  // Этап 1.5: вне обучения автозавершение включается настройкой игры.
  // Состав живых бойцов и активный владелец меняются только с боем — ревизия
  // служит триггером проверки автозавершения (0.21.11).
  const { shouldAutoEndTurn: autoEndTurnFn, autoEndTurnDeps } = training;
  useEffect(() => {
    if (isPrologue && prologueRunRef.current?.forceDefend) return;
    if (!isTraining && !hintSettings.autoEndTurn) return;
    const ownUnits = snapshot.entities.filter(
      (entity) => !entity.dead && entity.coverType === 0 && entity.owner === viewOwner && entity.maxAp > 0,
    );
    if (
      !autoEndTurnFn({
        paused,
        busy: base.busy,
        enemyPhase: base.enemyPhase,
        isReplay,
        isSpectator,
        isTraining,
        activeHint: autoEndTurnDeps.activeHint,
        activeOwner: snapshot.activeOwner,
        viewOwner,
        ownUnits,
        outcomeOngoing: battleOutcome() === "ongoing",
        isNetGuest: Boolean(isNetGuest),
      })
    )
      return;
    endTurn();
    // endTurn/battleOutcome — функции обработчика экрана: читают свежее
    // состояние через замыкание, но их перечисление пересоздавало бы эффект
    // каждый рендер; isPrologue стабилен за время экрана. Проверка
    // срабатывает на смену боя (ревизия/снимок) и явные флаги ниже.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    snapshotModel.battleRevision,
    viewOwner,
    paused,
    base.busy,
    base.enemyPhase,
    isReplay,
    isSpectator,
    isNetGuest,
    isTraining,
    autoEndTurnDeps.activeHint,
    hintSettings.autoEndTurn,
    snapshot,
  ]);

  // Восстановление партии, сохранённой в ход Нави: алгоритм противника
  // продолжает ход с текущего состояния (иначе сторона осталась бы без хода).
  // В поочерёдной игре алгоритм не применяется — ход принадлежит человеку.
  useEffect(() => {
    if (battleKind === "pvp" || battleKind === "pvpNet") return;
    if (battleOutcome() !== "ongoing") return;
    if (session.getBattleSnapshot(PLAYER_OWNER).activeOwner !== ENEMY_OWNER) return;
    void runEnemyPhase();
    // Намеренно срабатывает один раз при создании ядра (монтаж экрана,
    // включая восстановление партии в ход Нави): последующие смены хода
    // обрабатывает конвейер событий, а повторный запуск на каждом рендере
    // удвоил бы ход противника. runEnemyPhase читает свежее состояние
    // через замыкание монтирования; это осознанное исключение.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kernel]);

  /**
   * Нажатие по полю (0.20.63): что оно значит, решает battle-cell-click,
   * здесь только исполнение намерения состоянием и командами.
   */
  const entitiesRef = useLatest(snapshot.entities);

  // Кого выбрать — решает battle-selection: в обучении исполнитель
  // указания (строгий сценарий, 0.20.13), иначе первый свой боец.
  useEffect(() => {
    const fighterId = firstFighterId(entitiesRef.current, {
      ...kinds.side,
      isTraining,
      trainingActorId,
    });
    if (fighterId === null) {
      setIntent({ type: "clearSelection" });
    } else {
      setIntent({ type: "select", actorId: fighterId });
    }
  }, [snapshot.turnNumber, kinds.side, isTraining, trainingActorId, entitiesRef, setIntent]);

  const byReach = (() => {
    // Достижимость поля зависит от боя, а не от кадра: ревизия —
    // намеренный триггер пересчёта (тело читает только сервис), поэтому
    // упоминается в теле, чтобы отношение «зависимость → пересчёт» было явным.
    if (selectedId === null || action !== null || paused || base.busy) return new Map<string, unknown>();
    // Гость запрашивает достижимость у ведущего; наблюдатель и повтор не
    // вычисляют её вовсе (нет ядра / просмотр).
    if (isNetGuest) {
      const cells = session.requestNetReachable(selectedId);
      const map = new Map<string, unknown>();
      for (const cell of cells) map.set(cellKey(cell.x, cell.y), cell);
      return map;
    }
    if (usesNetSnapshot || isReplay) return new Map<string, unknown>();
    const cells = session.getBattleReachable(selectedId);
    const map = new Map<string, unknown>();
    for (const cell of cells) map.set(cellKey(cell.x, cell.y), cell);
    return map;
  })();

  const previewPath = (() => {
    if (!intentModel.preview) return [];
    // Повторы и гость не хранят достижимость локально.
    if (usesNetSnapshot || isReplay || selectedId === null) return [];
    const [xs, ys] = intentModel.preview.split(",");
    const x = Number(xs);
    const y = Number(ys);
    const result = session.getBattlePath(selectedId, { x, y, z: 0 });
    return result?.path ?? [];
  })();

  const onCell = useCallback(
    (x: number, y: number): void => {
      const result = resolveCellClick(x, y, {
        paused,
        busy: base.busy,
        outcomePending: base.outcomePending,
        ownTurn: snapshot.activeOwner === viewOwner,
        isTraining,
        trainingNoopStep: training.activeHint?.until === "noop",
        trainingActorId,
        trainingDirective,
        selectedId,
        selected: selected ?? null,
        action,
        skills: skills as never,
        entities: snapshot.entities,
        tiles: snapshot.grid.tiles,
        viewOwner,
        reach: byReach.get(cellKey(x, y)),
        aimId,
        hitAvailable: Boolean(aim.hit?.available),
        charge,
        chargeArmed,
        preview: intentModel.preview,
        coarse: window.matchMedia("(pointer: coarse)").matches,
      } as never);
      switch (result.kind) {
        case "ignore":
          return;
        case "advanceNoopStep":
          training.setHintStep((value) => value + 1);
          return;
        case "selfArea":
          applySelfSkill(result.skillId);
          return;
        case "select":
          setIntent({ type: "select", actorId: result.id });
          return;
        case "denyActor":
          setLog(t("training.locked.actor"));
          return;
        case "armAttack":
          setIntent({ type: "armAction", action: result.entry, targetId: result.targetId });
          return;
        case "denyTarget":
          trainingDeny(result.action as Parameters<typeof trainingDeny>[0]);
          return;
        case "aim": {
          const target = snapshot.entities.find((entity) => entity.id === result.id);
          // Рывок показывается сразу: первое нажатие вооружает подход, второе
          // по той же цели его исполняет (0.20.50).
          const plan = target ? chargeFor(target) : null;
          if (plan) setLog(t("battle.chargeHint"));
          const skill =
            action?.type === "skill"
              ? (skills as Record<string, { effects?: Array<{ type: string }> }>)[action.id]
              : undefined;
          // Клетка постановки сохраняется только у умения с переносом.
          const targetPos = skill?.effects?.some((effect) => effect.type === "displace") ? skillTargetPos : null;
          setIntent({ type: "aim", targetId: result.id, chargePlan: plan, armed: plan !== null, targetPos });
          return;
        }
        case "attack":
          tryAttack(result.id);
          return;
        case "charge":
          if (charge) executeCharge(charge);
          return;
        case "positionSkill":
          tryPositionSkill(result.cell);
          return;
        case "previewMove":
          setIntent({ type: "previewMove", key: result.key });
          return;
        case "move":
          tryMove(result.cell);
          return;
        case "cancel":
          setIntent({ type: "cancel" });
          return;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      base,
      kinds,
      snapshotModel,
      intentModel,
      training,
      tryAttack,
      tryMove,
      tryPositionSkill,
      applySelfSkill,
      executeCharge,
      chargeFor,
      setIntent,
      trainingDeny,
      setLog,
      t,
      action,
      aimId,
      charge,
      chargeArmed,
      selectedId,
      selected,
      skills,
      byReach,
    ],
  );

  const onHover = useCallback(
    (x: number, y: number): void => {
      if (paused || base.busy) return;
      const id = cellKey(x, y);
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      if (byReach.has(id) && !coarse) {
        setIntent({ type: "previewMove", key: id });
      }
      // Рывок (0.20.50): наведение мышью показывает подход и линию удара
      // до нажатия. Сенсорный экран наведения не имеет — там тот же
      // предпросмотр даёт первое нажатие.
      if (coarse || action === null) return;
      const hovered = snapshot.entities.find(
        (candidate) => !candidate.dead && candidate.coverType === 0 && candidate.x === x && candidate.y === y,
      );
      // Цель, выбранную нажатием, наведение не отнимает: увод мыши снимает
      // только неподтверждённый рывок, показанный самим наведением.
      if (!hovered || hovered.owner === viewOwner) {
        setIntent({ type: "hoverLeave" });
        return;
      }
      const plan = chargeFor(hovered);
      if (!plan) {
        setIntent({ type: "hoverLeave" });
        return;
      }
      setIntent({ type: "aim", targetId: hovered.id, chargePlan: plan, armed: false, targetPos: null });
    },
    [paused, base.busy, byReach, setIntent, action, snapshot.entities, viewOwner, chargeFor],
  );

  // Обновляем inputRef каждый рендер, чтобы setOnActivate/setOnHover
  // (зарегистрированные в useBattleRendererSync один раз) всегда вызывали
  // актуальную версию обработчика (0.20.13). Это зеркало строки оригинала:
  // `inputRef.current = { onCell, onHover }`.
  base.inputRef.current = { onCell, onHover };

  // liberatable — захваченное лицо рядом с выбранным бойцом: рядом с ним
  // доступно особое действие «освобождение» (§7.2). Захват — объект миссии
  // rescue либо обездвиженное лицо (immobile, maxAp 0).
  const liberatable = (() => {
    if (!selected || selected.dead || selected.owner !== viewOwner) return null;
    return (
      snapshot.entities.find(
        (entity) =>
          !entity.dead &&
          entity.id !== selected.id &&
          isCaptive(entity, snapshot.objective) &&
          distH(selected.x, selected.y, entity.x, entity.y) <= 1,
      ) ?? null
    );
  })();

  return {
    announce,
    playThen,
    applyCommand,
    tryMove,
    tryAttack,
    tryPositionSkill,
    applySelfSkill,
    applyLiberate,
    executeCharge,
    chargeFor,
    debugAutoWin,
    endTurn,
    runEndTurnSequence,
    runEnemyPhase,
    handOffTurnToEnemy,
    onCell,
    onHover,
    byReach,
    previewPath,
    liberatable,
    unitNameKey,
    allOwnApSpent,
  };
}

export type BattleCommandCenterModel = ReturnType<typeof useBattleCommandCenter>;
