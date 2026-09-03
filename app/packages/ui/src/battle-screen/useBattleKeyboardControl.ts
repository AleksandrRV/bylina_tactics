import { useCallback, useEffect } from "react";
import { resolveBattleKey, type BattleKeyContext, type BattleKeyIntent } from "../battle-keyboard.js";
import { useLatest } from "../hooks.js";
import type { BattleScreenBase } from "./useBattleScreenBase.js";
import type { BattleKinds } from "./useBattleKinds.js";
import type { BattleSnapshotModel } from "./useBattleSnapshot.js";
import type { BattleIntentModel } from "./useBattleIntentState.js";
import type { BattleTrainingModel } from "./useBattleTrainingState.js";
import type { BattlePrologueModel } from "./useBattlePrologueState.js";
import type { BattleCommandCenterModel } from "./useBattleCommandCenter.js";

export interface BattleKeyboardControlDeps {
  base: BattleScreenBase;
  kinds: BattleKinds;
  snapshotModel: BattleSnapshotModel;
  intentModel: BattleIntentModel;
  training: BattleTrainingModel;
  prologue: BattlePrologueModel;
  commands: BattleCommandCenterModel;
  skills: Record<string, import("@bylina/core").SkillStats>;
  rendererRef: BattleScreenBase["rendererRef"];
}

export function useBattleKeyboardControl(deps: BattleKeyboardControlDeps) {
  const { base, kinds, snapshotModel, intentModel, training, prologue, commands, skills } = deps;

  // Снятие прицеливания с клавиатуры (0.20.59): прицел и предпросмотр
  // сбрасываются событием cancel, выбранный боец остаётся.
  const cancelKeyboardAim = useCallback((): void => {
    intentModel.setIntent({ type: "cancel" });
  }, [intentModel]);

  // Клавиатура: решения — в модуле battle-keyboard, здесь только проводка к
  // состоянию экрана (0.20.59). Прежде карта клавиш жила внутри эффекта и
  // занимала сто тридцать строк посреди компонента.
  //
  // Контекст и действия складываются в ссылку и обновляются после каждого
  // кадра. Замыкания команд (applyCommand, applySelfSkill) пересоздаются
  // каждый рендер; будь они в зависимостях, окно переподписывалось бы на
  // каждом кадре, а без них в обработчике осталась бы устаревшая команда.
  // Ссылка даёт свежие замыкания при одной подписке на время экрана.
  const keyboard = useLatest<{ ctx: BattleKeyContext; apply: (intent: BattleKeyIntent) => void }>({
    ctx: {
      paused: base.paused,
      busy: base.busy,
      outcomePending: base.outcomePending,
      cutscenePlaying: base.cutscenePlaying,
      isTraining: kinds.isTraining,
      trainingActorId: training.trainingActorId,
      trainingDirective: training.trainingDirective,
      trainingAllows: training.trainingAllows,
      selectedId: intentModel.selectedId,
      selected: intentModel.selected ?? null,
      action: intentModel.action,
      skills,
      snapshot: snapshotModel.snapshot,
      viewOwner: kinds.viewOwner,
      side: kinds.side,
    },
    apply: (intent) => {
      switch (intent.kind) {
        case "none":
          return;
        case "skipCutscene":
          prologue.director.skip();
          return;
        case "togglePause":
          base.session.setPaused(!base.paused);
          return;
        case "select":
          // Обзор клетки не снимаем: перебор бойцов клавишами не отменяет
          // подсветку уже осмотренной клетки (select сохраняет placing).
          intentModel.setIntent({ type: "select", actorId: intent.id });
          return;
        case "defend":
          commands.applyCommand({ type: "DEFEND", actorId: intent.actorId });
          cancelKeyboardAim();
          return;
        case "overwatch":
          commands.applyCommand({ type: "OVERWATCH", actorId: intent.actorId });
          cancelKeyboardAim();
          return;
        case "applySelfSkill":
          commands.applySelfSkill(intent.skillId);
          return;
        case "armSkill":
          if (intentModel.selectedId !== null)
            intentModel.setIntent({ type: "toggleAction", actorId: intentModel.selectedId, action: intent.entry });
          return;
        case "toggleAction":
          intentModel.setIntent({
            type: "toggleAction",
            actorId: intentModel.selectedId ?? 0,
            action:
              intentModel.action?.type === intent.entry.type && intentModel.action.id === intent.entry.id
                ? null
                : intent.entry,
          });
          return;
        case "pan":
          deps.rendererRef.current?.pan(intent.dx, intent.dy);
          return;
      }
    },
  });

  // Подписка одна на время экрана: состояние читается из ссылки.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // Решение принимает battle-keyboard, исполнение — экран: замыкания
      // команд свежие, потому что исполнитель обновляется каждый кадр.
      keyboard.current.apply(resolveBattleKey(event, keyboard.current.ctx));
    };
    const onContext = (event: MouseEvent): void => {
      event.preventDefault();
      cancelKeyboardAim();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("contextmenu", onContext);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("contextmenu", onContext);
    };
    // Ссылка неизменна, поэтому подписка одна на время экрана;
    // cancelKeyboardAim стабилен (useCallback поверх стабильного setIntent).
  }, [keyboard, cancelKeyboardAim]);

  // Назначаем обработчики ввода в inputRef для рендерера (onCell/onHover).
  base.inputRef.current = {
    onCell: commands.onCell,
    onHover: commands.onHover,
  };

  return {};
}

export type BattleKeyboardControlModel = ReturnType<typeof useBattleKeyboardControl>;
