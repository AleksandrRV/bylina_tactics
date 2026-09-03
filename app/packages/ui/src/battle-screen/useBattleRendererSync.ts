import { useCallback, useEffect } from "react";
import { createFieldRenderer } from "@bylina/render";
import type { BattleScreenBase } from "./useBattleScreenBase.js";
import type { BattleKinds } from "./useBattleKinds.js";
import type { BattleSnapshotModel } from "./useBattleSnapshot.js";
import type { BattleIntentModel } from "./useBattleIntentState.js";
import type { BattleAimPreviewModel } from "./useBattleAimPreview.js";
import type { BattleTrainingModel } from "./useBattleTrainingState.js";
import type { BattleCommandCenterModel } from "./useBattleCommandCenter.js";

export interface BattleRendererSyncDeps {
  base: BattleScreenBase;
  kinds: BattleKinds;
  snapshotModel: BattleSnapshotModel;
  intentModel: BattleIntentModel;
  aim: BattleAimPreviewModel;
  training: BattleTrainingModel;
  commands: BattleCommandCenterModel;
  biome: string | undefined;
  darknessRatio: number;
  debugMovement: boolean;
  reachable: import("@bylina/core").ReachableCell[];
}

export function useBattleRendererSync(deps: BattleRendererSyncDeps) {
  const { base, kinds, snapshotModel, intentModel, aim, training, commands } = deps;
  const { hostRef, rendererRef, inputRef, setRendererReady, matchSeed, t } = base;
  const { snapshot, visibleCells, exploredCells } = snapshotModel;
  const { viewOwner } = kinds;

  // Монтирование средства отображения (0.20.67): подписка одна на время экрана,
  // а обратные вызовы средства отображения берут из неё при каждом событии.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = createFieldRenderer();
    renderer.setOnActivate((x, y) => inputRef.current?.onCell(x, y));
    renderer.setOnHover((x, y) => inputRef.current?.onHover(x, y));
    let gone = false;
    void renderer.mount(host).then(() => {
      if (gone) {
        renderer.destroy();
        return;
      }
      rendererRef.current = renderer;
      // Средство отображения смонтировано: один перерендер, чтобы эффекты,
      // читающие rendererRef, увидели готовый рендер. К ревизии боя не
      // относится — это событие монтирования представления.
      setRendererReady(true);
    });
    return () => {
      gone = true;
      rendererRef.current = null;
      renderer.destroy();
    };
    // Ссылка ввода неизменна: подписка одна на время экрана, а обратные
    // вызовы средства отображения берут из неё при каждом событии.
  }, [inputRef, hostRef, rendererRef, setRendererReady]);

  // Обновление кадра рендерера: единственный поставщик состояния для WebGL.
  useEffect(() => {
    rendererRef.current?.update({
      matchSeed,
      snapshot,
      selectedId: intentModel.selectedId,
      aimId: intentModel.aimId,
      reachable: deps.reachable as never,
      // Рывок (0.20.50): маршрут ведёт в клетку подхода, а луч
      // прицеливания начинается там же — игрок видит, откуда ударит.
      path: intentModel.charge ? intentModel.charge.path : commands.previewPath,
      aimFrom: intentModel.charge ? intentModel.charge.step : null,
      aimOk: Boolean(aim.hit?.available) || Boolean(intentModel.charge),
      // Этап 1.4: состояние кольца цели — белое (предварительно выбрана),
      // янтарное (атака готова), красное (невозможно).
      aimState:
        intentModel.aimId === null
          ? undefined
          : intentModel.charge
            ? "ready"
            : !aim.hit
              ? "preselect"
              : aim.hit.available
                ? "ready"
                : "blocked",
      // Этап 2.7: цель открыта с фланга — красные уголки-скобки.
      aimFlanked: Boolean(aim.hit?.available && aim.hit.flanked),
      // Этап 2.6 (правка): областной прицел — центр и радиус из определения
      // умения; для умений «на себя» центр — сам боец (круговой взмах).
      areaPreview: aim.areaPreview,
      // Этап 2.1: локализованная строка «Промах» для всплывающего числа.
      missLabel: t("combat.miss"),
      // Этап 3.1: биом карты (палитра поверхности, стиль укрытий, декор).
      biome: deps.biome,
      // Этап 3.6: доля Тьмы кампании для холодного слоя атмосферы.
      darkness: deps.darknessRatio,
      heightMod: aim.hit?.heightMod ?? 0,
      debugMovement: deps.debugMovement,
      visibleCells,
      exploredCells,
      // Базовый кадр держит своих бойцов: поле крупнее окна больше не
      // влезает целиком, и середина карты оставила бы отряд за кадром (0.20.42).
      homeOwner: viewOwner,
      aimBreakCell: aim.aimBreakCell,
      hoverCell: aim.hoverCell,
      trainingHighlight: training.trainingHighlight,
      trainingFocus: training.trainingFocus,
    } as never);
    // rendererReady: после асинхронного монтажа средства отображения эффект
    // обязан отработать ещё раз и отправить первый кадр (раньше это делал
    // setTick). snapshot/visibleCells обновляются по ревизии боя.
  }, [
    base.rendererReady,
    matchSeed,
    snapshot,
    intentModel.selectedId,
    intentModel.aimId,
    deps.reachable,
    commands.previewPath,
    aim.hit,
    aim.hit?.heightMod,
    aim.areaPreview,
    aim.aimBreakCell,
    aim.hoverCell,
    visibleCells,
    exploredCells,
    training.trainingHighlight,
    training.trainingFocus,
    viewOwner,
    intentModel.charge,
    intentModel.preview,
    t,
    deps.biome,
    deps.darknessRatio,
    deps.debugMovement,
    rendererRef,
  ]);

  // Жесты холста закрыты, пока исход боя ещё не показан (0.20.40): пауза
  // принадлежит проигрыванию боя, а не игроку. Сцена держит замок сама,
  // поэтому снятие замка считается по обоим источникам — иначе экран
  // разблокировал бы поле в хвосте ещё идущей сцены.
  useEffect(() => {
    rendererRef.current?.setInputLocked?.(base.outcomePending || base.cutscenePlaying);
  }, [base.outcomePending, base.cutscenePlaying, rendererRef]);

  // Этап 2.10: переключатель темпа боя — обычная и двойная скорость для всех пауз,
  // перемещений и эффектов поля, а также автоматического проигрывания
  // повторов (повторы идут через тот же конвейер play() рендерера).
  useEffect(() => {
    rendererRef.current?.setSpeed(base.fastPace ? 2 : 1);
  }, [base.fastPace, rendererRef]);

  // Этап 1.7: системная настройка «уменьшить движение» распространяется на
  // боевой экран — тряска камеры, «дыхание» фишек и дрейф тумана отключаются.
  useEffect(() => {
    // jsdom (автотесты) не реализует matchMedia — считаем настройку выключенной.
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = (): void => rendererRef.current?.setReducedMotion(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [rendererRef]);

  const focusEntity = useCallback(
    (entityId: number): void => {
      rendererRef.current?.focusEntity?.(entityId);
    },
    [rendererRef],
  );

  return {
    focusEntity,
  };
}

export type BattleRendererSyncModel = ReturnType<typeof useBattleRendererSync>;
