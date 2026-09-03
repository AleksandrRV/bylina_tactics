import { useMemo, useRef, useState } from "react";
import { ENEMY_OWNER } from "@bylina/core";
import type { ReachableCell } from "@bylina/core";

import { useBattleScreenBase } from "./useBattleScreenBase.js";
import { useBattleKinds } from "./useBattleKinds.js";
import { useBattleKernel } from "./useBattleKernel.js";
import { useBattleSnapshot } from "./useBattleSnapshot.js";
import { useBattleIntentState } from "./useBattleIntentState.js";
import { useBattleAimPreview } from "./useBattleAimPreview.js";
import { useBattleTrainingState } from "./useBattleTrainingState.js";
import { useBattlePrologueState } from "./useBattlePrologueState.js";
import { useBattleOutcomeGate } from "./useBattleOutcomeGate.js";
import { useBattleCommandCenter } from "./useBattleCommandCenter.js";
import { useBattleRendererSync } from "./useBattleRendererSync.js";
import { useBattleReplayPlayback } from "./useBattleReplayPlayback.js";
import { useBattleRosterState } from "./useBattleRosterState.js";
import { useBattleCampaignHints } from "./useBattleCampaignHints.js";
import { useBattleKeyboardControl } from "./useBattleKeyboardControl.js";

export function useBattleScreenModel() {
  const base = useBattleScreenBase();
  const kinds = useBattleKinds(base);
  const kernelModel = useBattleKernel(base, kinds);
  const snapshotModel = useBattleSnapshot(base, kinds);
  const intentModel = useBattleIntentState(snapshotModel);
  const training = useBattleTrainingState(base, kinds, snapshotModel, intentModel, kernelModel.skills);

  // debugMovement — локальное состояние экрана, не выносится в отдельный хук
  const [debugMovement, setDebugMovement] = useState(false);

  // Биом карты — из конфигурации режима, который создал матч.
  const battleBiome = useMemo(() => {
    const { isTraining, isPrologue, battleKind, trainingMission, prologueMission, replayJournal } = kinds;
    const { session, content, activeMissionId } = base;
    if (isTraining && trainingMission) return trainingMission.map.biome;
    if (isPrologue && prologueMission) return prologueMission.map.biome;
    if (battleKind === "campaign" && activeMissionId) {
      return session.getCampaign().getMission(activeMissionId)?.map.biome;
    }
    if (battleKind === "pvp" || battleKind === "pvpNet") {
      return content.pvp.map?.biome ?? content.quickMatch.map.biome;
    }
    if (battleKind === "replay") return replayJournal?.options.map.biome;
    return content.quickMatch.map.biome;
  }, [
    kinds.isTraining,
    kinds.trainingMission,
    kinds.isPrologue,
    kinds.prologueMission,
    kinds.battleKind,
    base.activeMissionId,
    base.session,
    base.content,
    kinds.replayJournal,
  ]);

  // Доля счётчика Тьмы кампании — холодный слой поверх сцены.
  const darknessRatio = useMemo(() => {
    if (kinds.battleKind !== "campaign") return 0;
    const state = base.session.getCampaign().getState();
    if (!state || state.darknessMax <= 0) return 0;
    return Math.min(1, Math.max(0, state.darkness / state.darknessMax));
  }, [kinds.battleKind, base.session]);

  // Достижимые клетки для рендерера (вычисляются в командном центре и нужны
  // здесь для рендерера, поэтому создаём placeholder до вызова commands)
  const reachablePlaceholder: ReachableCell[] = [];

  // Пролог требует handOffTurn и announce — создаём временные ссылки,
  // которые будут заполнены через командный центр после его создания.
  // Используем технику двойного прохода через ref.
  const commandsRef = useRef<ReturnType<typeof useBattleCommandCenter> | null>(null);

  const prologue = useBattlePrologueState(
    base,
    kinds,
    kernelModel.kernel,
    snapshotModel,
    async () => {
      if (commandsRef.current) await commandsRef.current.handOffTurnToEnemy();
    },
    (events) => {
      commandsRef.current?.announce(events);
    },
    (event) => intentModel.setIntent(event),
  );

  const outcome = useBattleOutcomeGate(base, kinds, snapshotModel, prologue);

  const aim = useBattleAimPreview(base, kinds, snapshotModel, intentModel, kernelModel.skills);

  const commands = useBattleCommandCenter({
    base,
    kinds,
    kernelModel,
    snapshotModel,
    intentModel,
    training,
    prologue,
    outcome,
    aim,
  });

  // Заполняем ref для использования в замыканиях пролога
  commandsRef.current = commands;

  // Достижимые клетки для рендерера: берём из командного центра
  const reachableForRenderer = useMemo(() => {
    const cells: ReachableCell[] = [];
    for (const [, value] of commands.byReach) {
      cells.push(value as ReachableCell);
    }
    return cells;
  }, [commands.byReach]);

  const renderer = useBattleRendererSync({
    base,
    kinds,
    snapshotModel,
    intentModel,
    aim,
    training,
    commands,
    biome: battleBiome,
    darknessRatio,
    debugMovement,
    reachable: reachableForRenderer,
  });

  const replay = useBattleReplayPlayback(base, kinds, kernelModel.kernel);
  const roster = useBattleRosterState(base, kinds, snapshotModel);
  const hints = useBattleCampaignHints(base, kinds, snapshotModel, kernelModel.kernel);

  useBattleKeyboardControl({
    base,
    kinds,
    snapshotModel,
    intentModel,
    training,
    prologue,
    commands,
    skills: kernelModel.skills,
    rendererRef: base.rendererRef,
  });

  // Пульсация панели: указание обучения либо принудительная стойка М2
  // (0.20.45) — единственное место пролога, где интерфейс сам называет
  // единственно возможное действие.
  const hintPanelKey = training.directiveView?.panelKey ?? (base.prologueStanceLock ? "defend" : null);

  const screenClassName = useMemo(() => {
    return [
      "battle-screen",
      kinds.battleKind === "pvp" ? (kinds.viewOwner === 1 ? "is-pvp-side1" : "is-pvp-side2") : "",
      training.trainingFocus ? "is-training-focus" : "",
    ]
      .filter(Boolean)
      .join(" ");
  }, [kinds.battleKind, kinds.viewOwner, training.trainingFocus]);

  // Разъединение сетевого боя: обратный отсчёт 30 секунд
  const netDisconnected = base.session.get().netDisconnected === true;
  const [disconnectLeft, setDisconnectLeft] = useState(30);

  // Подсветка акцентного оружия пролога (0.20.40): кнопка оружия пульсирует,
  // пока жив противник, которому оно предназначено.
  const accentWeaponId = (() => {
    const { prologueMission } = kinds;
    const accent = prologueMission?.actionAccent;
    if (!accent) return null;
    if (!accent.whileAlive) return accent.weaponId;
    return snapshotModel.snapshot.entities.some((entity) => entity.configId === accent.whileAlive && !entity.dead)
      ? accent.weaponId
      : null;
  })();

  // Сторона экрана у наблюдателя — всегда сторона 1
  const viewOwner = kinds.viewOwner;
  const enemyOwner = viewOwner === 1 ? 2 : 1;
  void enemyOwner;
  void ENEMY_OWNER;

  return {
    // Base
    ...base,
    // Kinds
    ...kinds,
    // Kernel
    ...kernelModel,
    // Snapshot
    ...snapshotModel,
    // Intent
    ...intentModel,
    // Aim
    ...aim,
    // Training
    ...training,
    // Prologue
    ...prologue,
    // Outcome
    ...outcome,
    // Commands
    ...commands,
    // Renderer
    ...renderer,
    // Replay
    ...replay,
    // Roster
    ...roster,
    // Hints
    ...hints,
    // Extra
    screenClassName,
    debugMovement,
    setDebugMovement,
    battleBiome,
    darknessRatio,
    netDisconnected,
    disconnectLeft,
    setDisconnectLeft,
    accentWeaponId,
    reachable: reachableForRenderer,
    reachablePlaceholder,
    hintPanelKey,
  };
}

export type BattleScreenModel = ReturnType<typeof useBattleScreenModel>;
